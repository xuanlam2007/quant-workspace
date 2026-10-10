import { useEffect, useState } from "react";
import { activateAuditor, dismissAuditorError } from "@/lib/auditor-status";
import styles from "./AppHeader.module.css";

export default function EngineErrorNotice({ error, id, expires, dismissed, onRetry = activateAuditor, onDismiss = dismissAuditorError }: { error: string; id: number; expires: number; dismissed: boolean; onRetry?: (retry: boolean) => void; onDismiss?: (id: number) => void }) {
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (error && !dismissed) {
      if (expires <= Date.now()) { onDismiss(id); return; }
      setNotice({ text: error, id }); setClosing(false);
      return;
    }
    setClosing(true);
    const timer = setTimeout(() => setNotice(null), 180);
    return () => clearTimeout(timer);
  }, [error, id, dismissed, expires, onDismiss]);
  useEffect(() => {
    if (!error || dismissed || hovered || focused) return;
    const timer = setTimeout(() => onDismiss(id), Math.max(0, expires - Date.now()));
    return () => clearTimeout(timer);
  }, [error, dismissed, id, expires, hovered, focused, onDismiss]);
  if (!notice) return null;
  return <div className={styles.engineError} data-closing={closing} role="alert"
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div><p>{notice.text}</p><button type="button" tabIndex={-1} onClick={() => onRetry(true)}>Retry</button></div>
    <button type="button" tabIndex={-1} className={styles.engineDismiss} aria-label="Dismiss engine notification" onClick={() => onDismiss(notice.id)}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
  </div>;
}
