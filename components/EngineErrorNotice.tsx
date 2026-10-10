import { useEffect, useRef } from "react";
import { activateAuditor, dismissAuditorError } from "@/lib/auditor-status";
import { notify } from "@/lib/notifications";

export default function EngineErrorNotice({ error, id, expires, dismissed, onRetry = activateAuditor, onDismiss = dismissAuditorError }: { error: string; id: number; expires: number; dismissed: boolean; onRetry?: (retry: boolean) => void; onDismiss?: (id: number) => void }) {
  const callbacks = useRef({ onRetry, onDismiss });
  callbacks.current = { onRetry, onDismiss };
  useEffect(() => {
    if (!error || dismissed) return;
    const duration = expires - Date.now();
    if (duration <= 0) { callbacks.current.onDismiss(id); return; }
    notify(error, "error", { duration, onDismiss: () => callbacks.current.onDismiss(id), detail: <button type="button" tabIndex={-1} onClick={() => { callbacks.current.onDismiss(id); callbacks.current.onRetry(true); }}>Retry</button> });
  }, [error, id, expires, dismissed]);
  return null;
}
