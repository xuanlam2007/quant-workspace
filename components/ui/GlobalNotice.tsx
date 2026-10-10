"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { notify, type NoticeKind } from "../../lib/notifications";

export default function GlobalNotice({ message, kind = "error", children, onDismiss }: {
  message: string; kind?: NoticeKind; children?: ReactNode; dismissible?: boolean; onDismiss?: () => void;
}) {
  const options = useRef({ message, detail: children, onDismiss });
  options.current = { message, detail: children, onDismiss };
  useEffect(() => { notify(message, kind, { detail: options.current.detail, onDismiss: () => { if (options.current.message === message) options.current.onDismiss?.(); } }); }, [message, kind]);
  return null;
}
