import { LoadingText } from "../ui/Loading";
import { Icon } from "../auditor/AuditorUi";
import styles from "./BacktestWorkspace.module.css";

export default function BacktestConnectionSummary({ loading, ready, status, refreshing = false, refreshDisabled = false, onRefresh }: {
  loading: boolean; ready: boolean;
  status?: { model: string; effort: string; adapter_ready: boolean; strategy_available: boolean } | null;
  refreshing?: boolean; refreshDisabled?: boolean; onRefresh?: () => void;
}) {
  const model = `${status?.model || "Mặc định CLI"}${status?.effort ? ` · ${status.effort}` : ""}`;
  return <div className={styles.connectionSummary} aria-busy={loading}>
    <div className={styles.connectionHeader}>
      <div className={styles.connectionTitle}>
        <h2>AI Backtest</h2>
        <span className={`${styles.badge} ${!loading && !ready ? styles.warning : ""}`} role="status" aria-live="polite" aria-atomic="true"><LoadingText loading={loading} width="auto">{ready ? "Sẵn sàng" : "Chưa sẵn sàng"}</LoadingText></span>
      </div>
      <button type="button" tabIndex={-1} className={`${styles.iconButton} ${styles.connectionRefresh}`} disabled={refreshDisabled || refreshing || loading || !onRefresh} aria-label="Làm mới trạng thái AI" aria-busy={refreshing} title="Làm mới trạng thái AI" onClick={onRefresh}><Icon name="refresh" /></button>
    </div>
    <dl className={styles.connectionDetails}>
      <div className={styles.connectionRow}><dt>Model</dt><dd title={model}><LoadingText loading={loading} width="100%">{model}</LoadingText></dd></div>
      <div className={styles.connectionRow}><dt>Bộ kết nối</dt><dd><LoadingText loading={loading} width="100%">{status?.adapter_ready ? "Khả dụng" : "Chưa khả dụng"}</LoadingText></dd></div>
      <div className={styles.connectionRow}><dt>Chiến lược</dt><dd><LoadingText loading={loading} width="100%">{status?.strategy_available ? "Đã có tài liệu" : "Chưa có tài liệu"}</LoadingText></dd></div>
    </dl>
  </div>;
}
