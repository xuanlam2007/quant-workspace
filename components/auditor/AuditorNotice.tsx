"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./AuditorUi";
import styles from "../../app/auditor/auditor.module.css";

export default function AuditorNotice({ message, kind = "error", dismissible = true, children }: {
  message: string; kind?: "error" | "warning" | "info"; dismissible?: boolean; children?: ReactNode;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { setDismissed(false); setLeaving(false); }, [message]);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setDismissed(true), 140);
    return () => window.clearTimeout(timer);
  }, [leaving, message]);
  if (dismissed) return null;
  return <div className={styles.inlineNotice} data-kind={kind} data-leaving={leaving} role={kind === "info" ? "status" : "alert"} aria-atomic="true">
    <span className={styles.noticeIcon}><Icon name={kind === "info" ? "activity" : "warning"} /></span>
    <span className={styles.noticeText}>{message}{children}</span>
    {dismissible && <button type="button" className={styles.noticeDismiss} aria-label="Đóng thông báo" disabled={leaving} onClick={() => setLeaving(true)}><Icon name="close" /></button>}
  </div>;
}
