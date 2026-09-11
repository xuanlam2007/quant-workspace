// socket.io-client v2 dùng Engine.IO v3, tương thích với máy chủ hiện tại
const SOCKET_URL = "wss://socket.example.com/socket.io/";
const NAMESPACE = "/socket.io";

export interface PriceTick {
  symbol: string;
  price: number;
  volume: number;
  time: number; // thời gian Unix tính bằng mili giây
}

export type ConnStatus = "connected" | "disconnected" | "reconnecting";

export function connectPriceFeed(
  symbol: string,
  onTick: (tick: PriceTick) => void,
  onStatus: (status: ConnStatus) => void
) {
  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: number | undefined;
  let keepaliveTimer: number | undefined;
  let subscribed = false;
  const clearTimers = () => {
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    if (keepaliveTimer !== undefined) window.clearInterval(keepaliveTimer);
    reconnectTimer = undefined;
    keepaliveTimer = undefined;
  };
  const subscribe = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN || subscribed) return;
    subscribed = true;
    socket.send(`42${NAMESPACE},${JSON.stringify(["addsymbol", symbol])}`);
  };
  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== undefined) return;
    subscribed = false;
    onStatus("reconnecting");
    reconnectTimer = window.setTimeout(() => { reconnectTimer = undefined; open(); }, 1500);
  };
  const open = () => {
    if (closed) return;
    clearTimers();
    subscribed = false;
    onStatus("reconnecting");
    socket = new WebSocket(`${SOCKET_URL}?symbol=${encodeURIComponent(symbol)}&EIO=3&transport=websocket`);
    socket.onopen = () => { /* chờ gói mở của Engine.IO */ };
    socket.onmessage = (event) => {
      const message = String(event.data);
      if (message === "2") { socket?.send("3"); return; }
      if (message.startsWith("0")) {
        onStatus("connected");
        try {
          const meta = JSON.parse(message.slice(1));
          const interval = Number(meta.pingInterval) || 25000;
          keepaliveTimer = window.setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send("2"); }, interval);
        } catch { /* giữ chu kỳ mặc định */ }
        socket?.send("40");
        socket?.send(`40${NAMESPACE}`);
        return;
      }
      if (message.startsWith(`40${NAMESPACE}`)) { subscribe(); return; }
      if (!message.startsWith("42")) return;
      let payload = message.slice(2);
      if (payload.startsWith(`${NAMESPACE},`)) payload = payload.slice(NAMESPACE.length + 1);
      try {
        const [eventName, data] = JSON.parse(payload);
        if (eventName !== "price" || !data || data.symbol !== symbol) return;
        const price = Number(data.price);
        if (Number.isFinite(price)) onTick({ symbol, price, volume: Number(data.volume) || 0, time: Number(data.time) || Date.now() });
      } catch { /* bỏ qua gói không phải giá */ }
    };
    socket.onerror = () => scheduleReconnect();
    socket.onclose = () => { clearTimers(); if (!closed) scheduleReconnect(); else onStatus("disconnected"); };
  };
  open();
  return {
    changeSymbol(newSymbol: string) { if (newSymbol !== symbol) socket?.close(); },
    close() { closed = true; clearTimers(); socket?.close(); socket = null; onStatus("disconnected"); },
  };
}
