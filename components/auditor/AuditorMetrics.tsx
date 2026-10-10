import type { Snapshot } from "../../lib/auditor-client";
import { LoadingNumber } from "../ui/Loading";
import AuditorFormula from "./AuditorFormula";
import { points } from "./AuditorUi";
import styles from "../../app/auditor/auditor.module.css";

export default function AuditorMetrics({ snapshot = null, loading }: { snapshot?: Snapshot | null; loading: boolean }) {
  const summary = snapshot?.summary;
  const unavailable = !loading && !summary;
  return <section className={styles.metrics} aria-label="Kết quả lệnh được ghi nhận">
      <div><div className={styles.metricHeading}><span>Cặp lệnh đã đóng</span>{summary && <AuditorFormula feePerPair={snapshot?.config.strategy_guardrails?.fee_per_closed_pair} />}</div><strong className={unavailable ? styles.muted : undefined}><LoadingNumber loading={loading} digits={3}>{summary?.total_closed_pairs ?? "…"}</LoadingNumber></strong><small><LoadingNumber loading={loading} digits={2}>{summary?.open_longs_count ?? "…"}</LoadingNumber> LONG / <LoadingNumber loading={loading} digits={2}>{summary?.open_shorts_count ?? "…"}</LoadingNumber> SHORT đang mở</small></div>
      <div><span>Lãi/lỗ gộp</span><strong className={styles.mono}><LoadingNumber loading={loading} decimal>{summary ? points(summary.total_gross_points, true) : "…"}</LoadingNumber> <small>điểm</small></strong><small>Trước phí giao dịch</small></div>
      <div><span>Phí</span><strong className={styles.mono}><LoadingNumber loading={loading} decimal>{summary ? `−${points(summary.total_fees_points)}` : "…"}</LoadingNumber> <small>điểm</small></strong><small>Áp dụng cho cặp lệnh đã đóng</small></div>
      <div><span>Lãi/lỗ ròng</span><strong className={`${styles.mono} ${!summary ? styles.muted : summary.total_net_points < 0 ? styles.negative : styles.positive}`}><LoadingNumber loading={loading} decimal>{summary ? points(summary.total_net_points, true) : "…"}</LoadingNumber> <small>điểm</small></strong><small>Sau phí giao dịch</small></div>
    </section>;
}
