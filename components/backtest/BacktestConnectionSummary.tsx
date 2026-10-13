import { LoadingText } from "../ui/Loading";
import ConnectionLatency from "../ui/ConnectionLatency";
import { Icon } from "../auditor/AuditorUi";
import styles from "./BacktestWorkspace.module.css";

export default function BacktestConnectionSummary({ loading, ready, status, checking = false, validating = false, connectionDirty = false, refreshing = false, refreshDisabled = false, onRefresh }: {
  loading: boolean; ready: boolean;
  status?: { model: string; effort: string; adapter_ready: boolean; strategy_available: boolean; strategy_documents?: string[]; latency_ms?: number } | null;
  checking?: boolean; validating?: boolean; connectionDirty?: boolean;
  refreshing?: boolean; refreshDisabled?: boolean; onRefresh?: () => void;
}) {
  const model = `${status?.model || "Mặc định CLI"}${status?.effort ? ` · ${status.effort}` : ""}`;
  const pending = loading || checking || validating;
  const label = checking ? "Đang kiểm tra" : validating ? "Đang xác nhận" : ready ? "Sẵn sàng" : "Chưa sẵn sàng";
  return <div className={styles.connectionSummary} aria-busy={loading}>
    <div className={styles.connectionHeader}>
      <div className={styles.connectionTitle}>
        <h2>AI Backtest</h2>
        <span className={`${styles.badge} ${!pending && !ready ? styles.warning : ""}`} role="status" aria-live="polite" aria-atomic="true" aria-busy={pending}><LoadingText loading={loading} width="auto">{label}</LoadingText></span>
      </div>
      <button type="button" tabIndex={-1} className={`${styles.iconButton} ${styles.connectionRefresh}`} disabled={refreshDisabled || refreshing || loading || !onRefresh} aria-label="Làm mới trạng thái AI" aria-busy={refreshing} title="Làm mới trạng thái AI" onClick={onRefresh}><span className={styles.connectionRefreshIcon} aria-hidden="true"><Icon name="refresh" /></span></button>
    </div>
    <dl className={styles.connectionDetails}>
      <div className={styles.connectionRow}><dt>Model</dt><dd title={model}><LoadingText loading={loading} width="100%">{model}</LoadingText></dd></div>
      <div className={styles.connectionRow}><dt>Bộ kết nối</dt><dd><LoadingText loading={loading} width="100%">{status?.adapter_ready ? "Khả dụng" : "Chưa khả dụng"}</LoadingText></dd></div>
      <div className={styles.connectionRow}><dt>Chiến lược</dt><dd><LoadingText loading={loading} width="100%">{status?.strategy_available ? `${status.strategy_documents?.length || 1} tài liệu` : "AI tự xây dựng"}</LoadingText></dd></div>
      <div className={styles.connectionRow} aria-live="polite"><dt>Độ trễ</dt><dd><ConnectionLatency loading={loading || checking} value={connectionDirty ? undefined : status?.latency_ms} /></dd></div>
    </dl>
  </div>;
}
