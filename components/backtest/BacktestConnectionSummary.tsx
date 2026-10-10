import { LoadingText } from "../ui/Loading";
import styles from "./BacktestWorkspace.module.css";

export default function BacktestConnectionSummary({ loading, ready, status }: {
  loading: boolean; ready: boolean;
  status?: { model: string; effort: string; adapter_ready: boolean; strategy_available: boolean } | null;
}) {
  return <div className={styles.connectionSummary} aria-busy={loading} aria-live="polite">
    <span className={`${styles.badge} ${!loading && !ready ? styles.warning : ""}`}><LoadingText loading={loading} width="auto">{ready ? "Codex sẵn sàng" : "Chưa sẵn sàng"}</LoadingText></span>
    <p className={styles.connectionValue} title={`${status?.model || "Model theo cấu hình CLI"}${status?.effort ? ` · ${status.effort}` : ""}`}><LoadingText loading={loading} width="28ch">{status?.model || "Model theo cấu hình CLI"}{status?.effort ? ` · ${status.effort}` : ""}</LoadingText></p>
    <p className={styles.connectionValue}><LoadingText loading={loading} width="25ch">{status?.adapter_ready ? "Bộ kết nối AI đã khả dụng" : "Chưa có bộ kết nối AI"}</LoadingText></p>
    <p className={styles.connectionValue}><LoadingText loading={loading} width="25ch">{status?.strategy_available ? "Đã có tài liệu chiến lược" : "Chưa có tài liệu chiến lược"}</LoadingText></p>
  </div>;
}
