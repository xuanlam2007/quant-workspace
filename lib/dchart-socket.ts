import io from "socket.io-client";

const SOCKET_NAMESPACE_URL = "https://socket.example.com";

export interface PriceTick {
  symbol: string;
  price: number;
  volume: number;
  time: number;
}

export type ConnStatus = "connected" | "disconnected" | "reconnecting";

export function connectionStatusLabel(connectionStatus: ConnStatus) {
  if (connectionStatus === "connected") return "Đã kết nối VNDIRECT";
  if (connectionStatus === "reconnecting") return "Đang kết nối VNDIRECT";
  return "Mất kết nối VNDIRECT";
}

interface RawPriceTick {
  symbol?: unknown;
  price?: unknown;
  volume?: unknown;
  time?: unknown;
}

interface SocketClient {
  connected: boolean;
  on(event: string, listener: (...args: unknown[]) => void): SocketClient;
  emit(event: string, ...args: unknown[]): SocketClient;
}

interface Subscriber {
  symbol: string;
  onTick: (tick: PriceTick) => void;
  onStatus: (status: ConnStatus) => void;
}

let socket: SocketClient | undefined;
let status: ConnStatus = "disconnected";
let nextSubscriberId = 1;
const subscribers = new Map<number, Subscriber>();
const symbolSubscribers = new Map<string, number>();

export function normalizePriceTick(data: RawPriceTick): PriceTick | undefined {
  const symbol = typeof data.symbol === "string" ? data.symbol : "";
  const price = Number(data.price);
  const volume = Number(data.volume) || 0;
  const rawTime = Number(data.time);
  if (!symbol || !Number.isFinite(price) || !Number.isFinite(rawTime) || rawTime <= 0) {
    return undefined;
  }
  const time = rawTime < 1e12 ? rawTime * 1000 : rawTime;
  return { symbol, price, volume, time };
}

function updateStatus(nextStatus: ConnStatus) {
  status = nextStatus;
  subscribers.forEach((subscriber) => subscriber.onStatus(nextStatus));
}

function subscribeSymbol(symbol: string) {
  const count = symbolSubscribers.get(symbol) ?? 0;
  symbolSubscribers.set(symbol, count + 1);
  if (count === 0 && socket?.connected) socket.emit("addsymbol", symbol);
}

function unsubscribeSymbol(symbol: string) {
  const count = symbolSubscribers.get(symbol) ?? 0;
  if (count <= 1) {
    symbolSubscribers.delete(symbol);
    if (socket?.connected) socket.emit("removesymbol", symbol);
    return;
  }
  symbolSubscribers.set(symbol, count - 1);
}

function ensureSocket() {
  if (socket) return socket;
  socket = io(SOCKET_NAMESPACE_URL, {
    query: { symbol: "VND" },
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  }) as SocketClient;
  socket.on("connect", () => {
    updateStatus("connected");
    symbolSubscribers.forEach((_count, symbol) => socket?.emit("addsymbol", symbol));
  });
  socket.on("disconnect", () => updateStatus("disconnected"));
  socket.on("connect_error", () => updateStatus("reconnecting"));
  socket.on("reconnect_attempt", () => updateStatus("reconnecting"));
  socket.on("price", (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const tick = normalizePriceTick(payload as RawPriceTick);
    if (!tick) return;
    subscribers.forEach((subscriber) => {
      if (subscriber.symbol === tick.symbol) subscriber.onTick(tick);
    });
  });
  updateStatus("reconnecting");
  return socket;
}

export function connectPriceFeed(
  initialSymbol: string,
  onTick: (tick: PriceTick) => void,
  onStatus: (nextStatus: ConnStatus) => void,
) {
  let symbol = initialSymbol;
  let closed = false;
  const subscriberId = nextSubscriberId++;
  subscribers.set(subscriberId, { symbol, onTick, onStatus });
  subscribeSymbol(symbol);
  ensureSocket();
  onStatus(status);

  return {
    changeSymbol(nextSymbol: string) {
      if (closed || nextSymbol === symbol) return;
      unsubscribeSymbol(symbol);
      symbol = nextSymbol;
      subscribers.set(subscriberId, { symbol, onTick, onStatus });
      subscribeSymbol(symbol);
    },
    close() {
      if (closed) return;
      closed = true;
      subscribers.delete(subscriberId);
      unsubscribeSymbol(symbol);
      onStatus("disconnected");
    },
  };
}
