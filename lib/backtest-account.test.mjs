import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { paperAccountMatches } from "./backtest-account.ts";
import { advancePaperLedger, emptyLedger, paperLedgerContext, submitTimedPaperOrder } from "./backtest.ts";

function pythonAccount(account) {
  const script = `import json,sys
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'tools/quant-strategy-auditor'))
from engine.backtest_bridge import ReplayPosition,ReplayOrder
data=json.load(sys.stdin)
position=ReplayPosition.model_validate(data['position']).model_dump() if data['position'] is not None else None
print(json.dumps({'position':position,'orders':[ReplayOrder.model_validate(order).model_dump() for order in data['orders']]}))`;
  const result = spawnSync("python", ["-c", script], { input: JSON.stringify(account), encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || String(result.error || "Python account serialization failed"));
  return JSON.parse(result.stdout);
}

const filled = { id: "order-1", side: "BUY", purpose: "OPEN", type: "MARKET", stop: null, limit: null, submitted: 60, triggered: null, status: "filled", filled: 120, price: 100 };
const account = { position: { side: "LONG", price: 100, time: 120 }, orders: [filled] };
const wire = pythonAccount(account);

test("unchanged account survives actual Python null defaults and JSON key order", () => {
  assert.notEqual(JSON.stringify(wire.position), JSON.stringify(account.position));
  assert.notEqual(JSON.stringify(wire.orders), JSON.stringify(account.orders));
  assert.equal(paperAccountMatches(wire, account), true);
  const reordered = JSON.parse(JSON.stringify(account), (key, value) => value && !Array.isArray(value) && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse()) : value);
  assert.equal(paperAccountMatches(wire, reordered), true);
});

test("real position and order changes still reject stale commands", () => {
  for (const update of [{ side: "SHORT" }, { price: 100.1 }, { time: 180 }, { quantity: 2 }]) {
    assert.equal(paperAccountMatches(wire, { ...account, position: { ...account.position, ...update } }), false);
  }
  assert.equal(paperAccountMatches(wire, { ...account, position: null }), false);
  for (const update of [{ status: "cancelled" }, { quantity: 2 }, { filled: 180 }, { stop: 99 }, { limit: 101 }, { strategy: "stop" }, { relation: "lte" }, { expires: 240 }, { parent: "order-parent" }, { group: "group" }, { side: "SELL" }, { submitted: 0 }, { id: "order-2" }]) {
    assert.equal(paperAccountMatches(wire, { ...account, orders: [{ ...filled, ...update }] }), false);
  }
  assert.equal(paperAccountMatches(wire, { ...account, orders: [] }), false);
  assert.equal(paperAccountMatches(wire, { ...account, orders: [filled, { ...filled, id: "order-2" }] }), false);
});

test("conditional fields compare by value and required null fields stay significant", () => {
  const conditional = { position: null, orders: [{ ...filled, strategy: "trailing", quantity: 3, trailing: { amount: 1, spread: 0, anchor: 100 }, bracket: { stopTrigger: 99, stopLimit: 98, takeTrigger: 101, takeLimit: 102 } }] };
  const serialized = pythonAccount(conditional);
  assert.equal(paperAccountMatches(serialized, conditional), true);
  assert.equal(paperAccountMatches(serialized, { ...conditional, orders: [{ ...conditional.orders[0], trailing: { ...conditional.orders[0].trailing, anchor: 101 } }] }), false);
  assert.equal(paperAccountMatches(serialized, { ...conditional, orders: [{ ...conditional.orders[0], bracket: { ...conditional.orders[0].bracket, stopLimit: 97 } }] }), false);
  const missing = structuredClone(account);
  delete missing.orders[0].stop;
  assert.equal(paperAccountMatches(wire, missing), false);
});

test("multiple open-fill-close cycles pass actual backend snapshots without duplicate orders", () => {
  const data = { symbol: "TEST", granularity: "1m", demo: true, bars: Array.from({ length: 20 }, (_, index) => ({ time: index * 60, open: 100, high: 101, low: 99, close: 100, volume: 10 })) };
  const decision = action => ({ action, order_type: "MARKET", stop_price: null, limit_price: null, reason: "Tín hiệu mô phỏng", question: "", drawings: [], indicators: [] });
  let ledger = emptyLedger();
  let cutoff = 60;
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const action of [cycle % 2 ? "OPEN_SHORT" : "OPEN_LONG", "CLOSE"]) {
      const snapshot = pythonAccount(ledger);
      assert.equal(paperAccountMatches(snapshot, ledger), true);
      const count = ledger.orders.length;
      ledger = submitTimedPaperOrder(ledger, decision(action), paperLedgerContext(ledger), cutoff, cutoff);
      assert.equal(ledger.orders.length, count + 1);
      ledger = advancePaperLedger(ledger, data, cutoff, cutoff + 60, 0.45);
      cutoff += 60;
      assert.equal(ledger.orders.at(-1).status, "filled");
      assert.equal(action === "CLOSE" ? ledger.position === null : ledger.position !== null, true);
    }
  }
  assert.equal(ledger.pairs.length, 3);
  assert.equal(ledger.orders.length, 6);
});
