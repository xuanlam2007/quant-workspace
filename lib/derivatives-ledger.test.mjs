import assert from "node:assert/strict";
import test from "node:test";
import { emptyLedger, parseReplayData, paperOrderMarkers, replayFrame } from "./backtest.ts";
import { advanceDerivativeLedger, availableContracts, cancelDerivativeOrders, replaceDerivativeOrder, submitDerivativeOrder } from "./derivatives-ledger.ts";
import { parseReplayMarket, replayMarketAt, volumeByPrice } from "./derivatives-market.ts";
import { emptyTicket, ticketFromOrder, ticketOrder } from "./derivatives-ticket.ts";

const replay = (prices) => parseReplayData({ symbol: "VN30F1M", granularity: "1s", bars: prices.map((close, index) => ({ time: 60 + index, open: close, high: close, low: close, close, volume: 1 })) });
const ticket = (side = "BUY", quantity = 3, price = 100) => ({ side, quantity, price, kind: "normal", market: true });
const fill = (ledger, data, after, cutoff) => advanceDerivativeLedger(ledger, data, after, cutoff, .45);

test("ticket conversion uses side-specific trailing triggers and exact OCO point formulas", () => {
  const draft = { ...emptyTicket(60), kind: "trailing", price: "100", quantity: "2", amount: "2", spread: "1" };
  const buy = submitDerivativeOrder(emptyLedger(), ticketOrder(draft, "BUY"), 60).orders[0];
  const sell = submitDerivativeOrder(emptyLedger(), ticketOrder(draft, "SELL"), 60).orders[0];
  assert.equal(buy.relation, undefined);
  assert.equal(buy.stop, 102);
  assert.equal(sell.stop, 98);
  const oco = { ...draft, kind: "oco", bracketMode: "points", stopTrigger: "5", stopLimit: "1", takeTrigger: "5", takeLimit: "1" };
  assert.deepEqual(ticketOrder(oco, "BUY").bracket, { stopTrigger: 95, stopLimit: 94, takeTrigger: 105, takeLimit: 106 });
  assert.deepEqual(ticketOrder(oco, "SELL").bracket, { stopTrigger: 105, stopLimit: 106, takeTrigger: 95, takeLimit: 94 });
  const stop = submitDerivativeOrder(emptyLedger(), ticketOrder({ ...draft, kind: "stop", trigger: "101" }, "BUY"), 60).orders[0];
  assert.equal(ticketFromOrder(stop).expiry, draft.expiry);
});

test("quantity netting preserves average entry, partial closes and reversal", () => {
  const data = replay([100, 104, 110, 90]);
  let ledger = fill(submitDerivativeOrder(emptyLedger(), ticket("BUY", 2), 60), data, 60, 61);
  ledger = fill(submitDerivativeOrder(ledger, ticket("BUY", 2), 61), data, 61, 62);
  assert.equal(ledger.position.quantity, 4);
  assert.equal(ledger.position.price, 102);
  ledger = fill(submitDerivativeOrder(ledger, ticket("SELL", 1), 62), data, 62, 63);
  assert.equal(ledger.position.quantity, 3);
  assert.equal(ledger.pairs[0].gross, 8);
  assert.equal(ledger.pairs[0].fee, .45);
  ledger = fill(submitDerivativeOrder(ledger, ticket("SELL", 5), 63), data, 63, 64);
  assert.deepEqual(ledger.position, { side: "SHORT", quantity: 2, price: 90, time: 64 });
  assert.equal(ledger.pairs[1].quantity, 3);
  assert.equal(ledger.pairs[1].gross, -36);
  assert.equal(ledger.pairs[1].fee, .45 * 3);
});

test("pending capacity prevents a position over 1000 contracts", () => {
  let ledger = submitDerivativeOrder(emptyLedger(), ticket("BUY", 800), 60);
  assert.equal(availableContracts(ledger, "BUY"), 200);
  assert.throws(() => submitDerivativeOrder(ledger, ticket("BUY", 201), 60));
  ledger = fill(ledger, replay([100]), 60, 61);
  assert.throws(() => submitDerivativeOrder(ledger, ticket("BUY", 201), 61));
  assert.throws(() => submitDerivativeOrder(ledger, { ...ticket("SELL", 801), reduceOnly: true }, 61));
});

test("stop relation and expiry use only revealed sample closes", () => {
  const data = replay([99, 98, 97]);
  const order = { ...ticket(), market: false, kind: "stop", trigger: 99, relation: "lte", expires: 62 };
  const ledger = submitDerivativeOrder(emptyLedger(), order, 60);
  const triggered = fill(ledger, data, 60, 61);
  assert.equal(triggered.orders[0].status, "triggered");
  assert.equal(triggered.position, null);
  assert.equal(fill(triggered, data, 61, 62).position.price, 98);
  const expired = fill(submitDerivativeOrder(emptyLedger(), { ...order, trigger: 80 }, 60), data, 60, 63);
  assert.equal(expired.orders[0].status, "cancelled");
});

test("trailing buy follows a falling anchor then triggers and fills on separate samples", () => {
  const data = replay([97, 99, 98]);
  const order = { ...ticket(), market: false, kind: "trailing", amount: 2, spread: 1 };
  let ledger = fill(submitDerivativeOrder(emptyLedger(), order, 60), data, 60, 61);
  assert.equal(ledger.orders[0].stop, 99);
  assert.equal(ledger.orders[0].status, "waiting");
  ledger = fill(ledger, data, 61, 62);
  assert.equal(ledger.orders[0].status, "triggered");
  assert.equal(ledger.position, null);
  ledger = fill(ledger, data, 62, 63);
  assert.equal(ledger.position.price, 98);
});

test("OCO creates exit siblings only after entry and cancels the other exit on fill", () => {
  const data = replay([100, 105, 106]);
  const order = { ...ticket(), market: false, kind: "oco", bracket: { stopTrigger: 95, stopLimit: 94, takeTrigger: 105, takeLimit: 106 } };
  let ledger = submitDerivativeOrder(emptyLedger(), order, 60);
  assert.equal(ledger.orders.length, 1);
  ledger = fill(ledger, data, 60, 61);
  assert.equal(ledger.orders.length, 3);
  assert.ok(ledger.orders.slice(1).every(child => child.status === "waiting"));
  ledger = fill(ledger, data, 61, 62);
  assert.equal(ledger.orders[2].status, "triggered");
  ledger = fill(ledger, data, 62, 63);
  assert.equal(ledger.position, null);
  assert.equal(ledger.orders[1].status, "cancelled");
  assert.equal(ledger.orders[2].status, "filled");
  assert.equal(ledger.pairs[0].gross, 18);
});

test("cancel and replace are immutable and failed replacements retain the original", () => {
  const ledger = submitDerivativeOrder(emptyLedger(), { ...ticket(), market: false }, 60);
  assert.throws(() => replaceDerivativeOrder(ledger, "order-1", ticket("BUY", 0), 61));
  assert.equal(ledger.orders[0].status, "waiting");
  const replaced = replaceDerivativeOrder(ledger, "order-1", ticket("BUY", 2), 61);
  assert.equal(replaced.orders[0].status, "cancelled");
  assert.equal(replaced.orders[1].submitted, 61);
  assert.equal(cancelDerivativeOrders(replaced, ["order-2"]).orders[1].status, "cancelled");
  assert.equal(replaced.orders[1].status, "waiting");
});

test("partial close resizes both OCO siblings and the remaining position stays protected", () => {
  const data = replay([100, 101, 105, 106]);
  const entry = { ...ticket(), market: false, kind: "oco", bracket: { stopTrigger: 95, stopLimit: 94, takeTrigger: 105, takeLimit: 105 } };
  let ledger = fill(submitDerivativeOrder(emptyLedger(), entry, 60), data, 60, 61);
  ledger = fill(submitDerivativeOrder(ledger, ticket("SELL", 1), 61), data, 61, 62);
  assert.equal(ledger.position.quantity, 2);
  assert.ok(ledger.orders.filter(order => order.parent).every(order => order.quantity === 2));
  ledger = fill(ledger, data, 62, 64);
  assert.equal(ledger.position, null);
  assert.equal(ledger.orders[1].status, "cancelled");
  assert.equal(ledger.orders[2].status, "filled");
  assert.equal(ledger.pairs[1].quantity, 2);
  assert.equal(ledger.pairs[1].gross, 12);
});

test("partial close consumes older OCO groups first without leaving oversized exits", () => {
  const data = replay([100, 100, 101]);
  const bracket = { stopTrigger: 95, stopLimit: 94, takeTrigger: 105, takeLimit: 105 };
  let ledger = fill(submitDerivativeOrder(emptyLedger(), { ...ticket("BUY", 2), market: false, kind: "oco", bracket }, 60), data, 60, 61);
  ledger = fill(submitDerivativeOrder(ledger, { ...ticket("BUY", 3), market: false, kind: "oco", bracket }, 61), data, 61, 62);
  ledger = fill(submitDerivativeOrder(ledger, ticket("SELL", 4), 62), data, 62, 63);
  assert.equal(ledger.position.quantity, 1);
  assert.ok(ledger.orders.filter(order => order.parent === "order-1").every(order => order.status === "cancelled"));
  assert.ok(ledger.orders.filter(order => order.parent === "order-4").every(order => order.quantity === 1 && order.status === "waiting"));
});

test("budget reserves future OCO legs, price ticks and all finite values are checked", () => {
  const ledger = { ...emptyLedger(), orders: Array.from({ length: 298 }, (_, index) => ({ id: `old-${index}`, status: "cancelled" })) };
  assert.throws(() => submitDerivativeOrder(ledger, { ...ticket(), market: false, kind: "oco", bracket: { stopTrigger: 95, stopLimit: 94, takeTrigger: 105, takeLimit: 106 } }, 60));
  for (const price of [0, Infinity, NaN, 100.01]) assert.throws(() => submitDerivativeOrder(emptyLedger(), ticket("BUY", 1, price), 60));
  assert.throws(() => submitDerivativeOrder(emptyLedger(), { ...ticket(), kind: "stop", trigger: 101 }, 60));
});

test("no retroactive or future fills, order markers carry actual quantity", () => {
  const data = replay([100, 999]);
  const ledger = submitDerivativeOrder(emptyLedger(), ticket(), 61);
  assert.equal(fill(ledger, data, 60, 61).position, null);
  const filled = fill(ledger, data, 61, 62);
  assert.equal(filled.position.price, 999);
  const markers = paperOrderMarkers(filled.orders, replayFrame(data, 0, 60), "1s");
  assert.match(markers.find(marker => marker.id.endsWith("filled")).text, /BUY 3 @ 999/);
});

test("market panel cutoff excludes future quotes and trades, volume uses recorded trades only", () => {
  const market = parseReplayMarket({ quotes: [{ time: 60, bids: [{ price: 99, quantity: 2 }], asks: [{ price: 101, quantity: 3 }] }, { time: 62, bids: [{ price: 900, quantity: 10 }], asks: [] }], trades: [{ time: 60, price: 100, quantity: 2 }, { time: 61, price: 100, quantity: 3 }, { time: 62, price: 900, quantity: 20 }] });
  const visible = replayMarketAt(market, 61);
  assert.equal(visible.quote.bids[0].price, 99);
  assert.deepEqual(volumeByPrice(visible.trades), [{ price: 100, quantity: 5 }]);
  assert.deepEqual(replayMarketAt(undefined, 100), { quote: null, trades: [] });
  assert.throws(() => parseReplayMarket({ trades: [{ time: 62, price: 100, quantity: 1 }, { time: 60, price: 100, quantity: 1 }] }));
  assert.throws(() => parseReplayMarket({ trades: [{ time: 60, price: 100, quantity: -1 }] }));
});
