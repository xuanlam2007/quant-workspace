// socket.io-client v2.x không có khai báo kiểu riêng
// Gói @types/socket.io-client trỏ đến kiểu v3+ không tương thích
// Chỉ khai báo phần API cần dùng để tránh lệch phiên bản
declare module "socket.io-client" {
  export interface Socket {
    on(event: string, cb: (...args: any[]) => void): this;
    emit(event: string, ...args: any[]): this;
    close(): void;
  }
  export interface SocketOptions {
    path?: string;
    transports?: string[];
    upgrade?: boolean;
    forceNew?: boolean;
    timeout?: number;
    reconnection?: boolean;
    reconnectionDelay?: number;
    reconnectionDelayMax?: number;
    query?: Record<string, string>;
  }
  export default function io(url: string, opts?: SocketOptions): Socket;
}
