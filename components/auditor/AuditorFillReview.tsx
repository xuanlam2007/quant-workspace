import { useState } from "react";
import { auditorRequest, type AuditEvent, type ObservedFill, type Summary } from "../../lib/auditor-client";
import { LoadingIndicator } from "../ui/Loading";
import AuditorNotice from "./AuditorNotice";
import styles from "../../app/auditor/auditor.module.css";

const labels: Record<ObservedFill["status"], string> = { intent: "Ý định", submitted: "Đã gửi lệnh", filled: "Phát hiện khớp lệnh", cancelled: "Đã hủy", unknown: "Chưa rõ", confirmed: "Đã tính", excluded: "Đã loại khỏi kết quả" };

function FillEditor({ fill, event, onUpdate, enabled }: { fill: ObservedFill; event: AuditEvent; onUpdate: (event: AuditEvent, summary?: Summary) => void; enabled: boolean }) {
  const [action, setAction] = useState(fill.action || "");
  const [price, setPrice] = useState(fill.price?.toString() || "");
  const [contracts, setContracts] = useState(fill.contracts?.toString() || "");
  const [time, setTime] = useState(fill.timestamp || "");
  const [executionId, setExecutionId] = useState(fill.execution_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (decision: "confirm" | "exclude") => {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const result = await auditorRequest<{ event: AuditEvent; summary: Summary }>(`/events/${encodeURIComponent(event.id)}/fill`, {
        date: event.date, session_id: event.session_id, candidate_id: fill.id, decision,
        ...(decision === "confirm" ? { action, price: Number(price), contracts: Number(contracts), timestamp: time, instrument: "VN30F1M", execution_id: executionId.trim() } : {}),
      });
      onUpdate(result.event, result.summary);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setSaving(false); }
  };
  const valid = !!action && Number(price) > 0 && Number.isInteger(Number(contracts)) && Number(contracts) >= 1 && Number(contracts) <= 1000 && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time);
  return <details className={styles.fillReview}>
    <summary>{labels[fill.status]} · {fill.instrument || "Chưa rõ mã"} · {fill.action || "Chưa rõ chiều"} {fill.contracts ?? "?"} @ {fill.price ?? "?"}{fill.reviewed_by && ` · ${fill.reviewed_by === "AI" ? "AI ghi nhận" : "Trader xác nhận"}`}</summary>
    <p className={styles.help}>{fill.evidence}</p>
    <div className={styles.fillFields}>
      <label className={styles.field}>Chiều khớp<select value={action} disabled={saving} onChange={change => setAction(change.target.value)}><option value="">Chọn chiều đã khớp</option><option value="BUY">BUY</option><option value="SELL">SELL</option></select></label>
      <label className={styles.field}>Giá khớp<input type="number" min="0.01" step="any" value={price} disabled={saving} onChange={change => setPrice(change.target.value)} /></label>
      <label className={styles.field}>Hợp đồng đã khớp<input type="number" min="1" max="1000" step="1" value={contracts} disabled={saving} onChange={change => setContracts(change.target.value)} /></label>
      <label className={styles.field}>Giờ khớp<input type="time" step="1" value={time} disabled={saving} onChange={change => setTime(change.target.value)} /></label>
      <label className={styles.field}>Mã khớp riêng biệt<input value={executionId} maxLength={120} disabled={saving} onChange={change => setExecutionId(change.target.value)} /></label>
    </div>
    <div className={styles.recordingActions}><button type="button" className={styles.button} disabled={!enabled || saving || event.ai_pending || !valid} onClick={() => void save("confirm")}>{saving ? <LoadingIndicator label="Đang cập nhật lệnh ghi nhận" /> : fill.status === "confirmed" ? "Sửa kết quả ghi nhận" : "Xác nhận đã khớp VN30F1M"}</button><button type="button" className={styles.button} disabled={!enabled || saving || event.ai_pending || fill.status === "excluded"} onClick={() => void save("exclude")}>Loại khỏi kết quả</button></div>
    <p className={styles.help}>Chỉ sửa bản ghi quan sát. BUY mở LONG hoặc đóng SHORT; SELL mở SHORT hoặc đóng LONG. Không gửi lệnh đến tài khoản.</p>
    {error && <AuditorNotice message={error} />}
  </details>;
}

export default function AuditorFillReview({ event, onUpdate, enabled }: { event: AuditEvent; onUpdate: (event: AuditEvent, summary?: Summary) => void; enabled: boolean }) {
  const records = event.observed_fills || [];
  const fills = [...records, ...(event.ai_trade_observations || []).filter(fill => !records.some(record => record.id === fill.id || (!!fill.execution_id && record.execution_id === fill.execution_id)))];
  return <>{fills.map(fill => <FillEditor key={`${fill.id}-${fill.status}-${fill.price}-${fill.contracts}-${fill.timestamp}-${fill.execution_id}`} fill={fill} event={event} onUpdate={onUpdate} enabled={enabled} />)}</>;
}
