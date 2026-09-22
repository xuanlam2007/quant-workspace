declare module "socket.io-client/dist/socket.io.js" {
  interface Socket {
    connected: boolean;
    on(event: string, listener: (...args: unknown[]) => void): Socket;
    emit(event: string, ...args: unknown[]): Socket;
  }

  interface SocketOptions {
    query?: Record<string, string>;
    reconnection?: boolean;
    reconnectionDelay?: number;
    reconnectionDelayMax?: number;
  }

  export default function io(url: string, options?: SocketOptions): Socket;
}
