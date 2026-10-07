import io from "socket.io-client";
import { sampleTick } from "./sample-market-data.ts";

export interface PriceTick {
  symbol: string;
  price: number;
  volume: number;
  time: number;
}

export type ConnStatus = "idle" | "connected" | "disconnected" | "reconnecting";

export function connectionStatusLabel(connectionStatus: ConnStatus, name = "Market data") {
  if (connectionStatus === "idle") return `Chưa kết nối ${name}`;
  if (connectionStatus === "connected") return `Đã kết nối ${name}`;
  if (connectionStatus === "reconnecting") return `Đang kết nối ${name}`;
  return `Mất kết nối ${name}`;
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
let status: ConnStatus = "idle";
let nextSubscriberId = 1;
let providerName = "Market data";
let sampleMode = false;
let sampleTimer: ReturnType<typeof setInterval> | undefined;
let pendingConnection: Promise<void> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let configurationAttempt = 0;
const nameListeners = new Set<() => void>();
const subscribers = new Map<number, Subscriber>();
const statusListeners = new Set<(status: ConnStatus) => void>();
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
  statusListeners.forEach((listener) => listener(nextStatus));
  subscribers.forEach((subscriber) => subscriber.onStatus(nextStatus));
}

export const getConnectionStatus = () => status;
export const getServerConnectionStatus = (): ConnStatus => "idle";
export const getPriceFeedName = () => providerName;
export const getServerPriceFeedName = () => "Market data";
export function subscribePriceFeedName(listener: () => void) {
  nameListeners.add(listener);
  return () => { nameListeners.delete(listener); };
}

function updateProviderName(name: string) {
  if (name === providerName) return;
  providerName = name;
  nameListeners.forEach((listener) => listener());
}

export function subscribeConnectionStatus(listener: (status: ConnStatus) => void) {
  statusListeners.add(listener);
  listener(status);
  return () => { statusListeners.delete(listener); };
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

function deliverTick(tick: PriceTick) {
  subscribers.forEach((subscriber) => {
    if (subscriber.symbol === tick.symbol) subscriber.onTick(tick);
  });
}

function startSampleFeed() {
  if (sampleTimer || !subscribers.size) return;
  sampleTimer = setInterval(() => {
    symbolSubscribers.forEach((_count, symbol) => deliverTick(sampleTick(symbol)));
  }, 1_000);
  updateStatus("connected");
}

function openSocket(url: string) {
  socket = io(url, {
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
    deliverTick(tick);
  });
  updateStatus("reconnecting");
}

function ensureSocket() {
  if (socket) return;
  if (sampleMode) { startSampleFeed(); return; }
  if (pendingConnection || retryTimer) return;
  updateStatus("reconnecting");
  pendingConnection = (async () => {
    try {
      const response = await fetch("/api/dchart/provider", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("provider unavailable");
      const config: { mode?: string; name?: string; socketUrl?: string } = await response.json();
      if (config.mode !== "sample" && (config.mode !== "live" || typeof config.socketUrl !== "string" || !config.socketUrl)) {
        throw new Error("invalid provider configuration");
      }
      if (!subscribers.size) { updateStatus("idle"); return; }
      configurationAttempt = 0;
      updateProviderName(config.mode === "sample" ? "Sample data" : config.name || "Market data");
      if (config.mode === "sample") { sampleMode = true; startSampleFeed(); }
      else if (config.socketUrl) openSocket(config.socketUrl);
    } catch {
      updateStatus(subscribers.size ? "disconnected" : "idle");
      if (subscribers.size) {
        const delay = Math.min(10_000, 1_000 * 2 ** configurationAttempt++);
        retryTimer = setTimeout(() => { retryTimer = undefined; ensureSocket(); }, delay);
      }
    } finally { pendingConnection = undefined; }
  })();
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
      if (!subscribers.size) {
        if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = undefined; updateStatus("idle"); }
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; updateStatus("idle"); }
      }
      onStatus("disconnected");
    },
  };
}
