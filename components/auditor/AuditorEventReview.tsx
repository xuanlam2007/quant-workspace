import { useState } from "react";
import { auditorAnalysisError, auditorRequest, type AuditEvent } from "../../lib/auditor-client";
import { LoadingIndicator } from "../ui/Loading";
import AuditorNotice from "./AuditorNotice";
import styles from "../../app/auditor/auditor.module.css";

export default function AuditorEventReview({ event, onUpdate, canAnalyze }: { event: AuditEvent; onUpdate: (event: AuditEvent) => void; canAnalyze: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const analyze = async () => {
    if (pending || event.ai_pending || !canAnalyze) return;
    setPending(true); setError("");
    try {
      const result = await auditorRequest<{ event: AuditEvent }>(`/events/${encodeURIComponent(event.id)}/analyze`, { date: event.date, session_id: event.session_id });
      onUpdate(result.event);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setPending(false); }
  };
  if (!canAnalyze && !event.ai_question && !event.teaching?.length && !event.analysis_history?.length && !error) return null;
  return <div className={styles.aiNote}>
    {event.ai_question && <><strong>Cần xác minh</strong><p>{event.ai_question}</p></>}
    {!!event.teaching?.length && <details className={styles.evidence}><summary>Lời giải thích đã lưu</summary>{event.teaching.map((item, index) => <div key={index}><p>{item.question}</p><p>{item.answer}</p></div>)}</details>}
    {canAnalyze && <button type="button" className={styles.button} disabled={pending || event.ai_pending} onClick={() => void analyze()}>{pending ? <LoadingIndicator label="Đang yêu cầu phân tích" /> : "Yêu cầu AI phân tích"}</button>}
    {!!event.analysis_history?.length && <details className={styles.evidence}><summary>Lịch sử phân tích AI</summary>{event.analysis_history.map((item, index) => <div key={index}><time className={styles.help}>{item.timestamp}</time>{item.observation ? <p>{item.observation}</p> : item.error && <p className={styles.help}>{auditorAnalysisError(item.error)}</p>}{item.question && <p>{item.question}</p>}</div>)}</details>}
    {error && <AuditorNotice message={error} />}
  </div>;
}
