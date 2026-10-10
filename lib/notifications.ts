import type { ReactNode } from "react";

export type NoticeKind = "success" | "error" | "warning" | "info";
export type Notice = { id: number; message: string; kind: NoticeKind; detail?: ReactNode; onDismiss?: () => void; duration: number };
let sequence = 0;
let notices: Notice[] = [];
const empty: Notice[] = [];
const listeners = new Set<() => void>();
const publish = () => listeners.forEach(listener => listener());
export const getNotices = () => notices;
export const getServerNotices = () => empty;
export function subscribeNotices(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notify(message: string, kind: NoticeKind = "info", options: Partial<Pick<Notice, "detail" | "onDismiss" | "duration">> = {}) {
  if (!message.trim()) return 0;
  const existing = notices.find(notice => notice.message === message);
  if (existing) {
    const prior = existing.onDismiss;
    const callback = options.onDismiss;
    if (callback) existing.onDismiss = () => { prior?.(); callback(); };
    return existing.id;
  }
  const id = ++sequence;
  notices = [...notices, { id, message, kind, duration: kind === "error" ? 10000 : 6000, ...options }];
  publish();
  return id;
}
export function dismissNotice(id: number) {
  const notice = notices.find(item => item.id === id);
  if (!notice) return;
  notices = notices.filter(item => item.id !== id);
  publish();
  notice.onDismiss?.();
}
