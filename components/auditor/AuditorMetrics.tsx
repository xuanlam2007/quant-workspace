import type { Snapshot } from "../../lib/auditor-client";
import { LoadingNumber } from "../ui/Loading";
import AuditorFormula from "./AuditorFormula";
import { points } from "./AuditorUi";
import styles from "../../app/auditor/auditor.module.css";

export default function AuditorMetrics({ snapshot, loading, active = true, connected = false }: {
  snapshot: Snapshot | null; loading: boolean; active?: boolean; connected?: boolean;
}) {
  const summary = snapshot?.summary;
  const waiting = (value: number | undefined) => loading || (connected && value === undefined);
  return <section className={styles.metrics} aria-label="Kết quả phiên">
    <div><div className={styles.metricHeading}><span title="Mỗi cặp tương ứng một hợp đồng có đủ lệnh mở và đóng.">Cặp lệnh đã đóng</span>{active && !loading && snapshot && <AuditorFormula feePerPair={snapshot.config?.strategy_guardrails?.fee_per_closed_pair} />}</div>
      <strong><LoadingNumber loading={waiting(summary?.total_closed_pairs)} digits={3} label="Đang tải số cặp lệnh đã đóng">{summary?.total_closed_pairs}</LoadingNumber></strong>
      <small><LoadingNumber loading={waiting(summary?.open_longs_count)} digits={2} label="Đang tải số lệnh LONG">{summary?.open_longs_count}</LoadingNumber> LONG / <LoadingNumber loading={waiting(summary?.open_shorts_count)} digits={2} label="Đang tải số lệnh SHORT">{summary?.open_shorts_count}</LoadingNumber> SHORT đang mở</small>
    </div>
    <div><span>Lãi/lỗ gộp</span><strong className={styles.mono}><LoadingNumber loading={waiting(summary?.total_gross_points)} decimal label="Đang tải lãi/lỗ gộp">{points(summary?.total_gross_points, true)}</LoadingNumber> <small>điểm</small></strong><small>Trước phí giao dịch</small></div>
    <div><span>Phí</span><strong className={styles.mono}><LoadingNumber loading={waiting(summary?.total_fees_points)} decimal label="Đang tải phí giao dịch">{points(summary?.total_fees_points === undefined ? undefined : -summary.total_fees_points)}</LoadingNumber> <small>điểm</small></strong><small>Áp dụng cho cặp lệnh đã đóng</small></div>
    <div><span>Lãi/lỗ ròng</span><strong className={`${styles.mono} ${loading || !summary ? styles.muted : summary.total_net_points < 0 ? styles.negative : styles.positive}`}><LoadingNumber loading={waiting(summary?.total_net_points)} decimal label="Đang tải lãi/lỗ ròng">{points(summary?.total_net_points, true)}</LoadingNumber> <small>điểm</small></strong><small>Sau phí giao dịch</small></div>
  </section>;
}
