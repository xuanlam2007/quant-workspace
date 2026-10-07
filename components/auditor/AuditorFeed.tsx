"use client";

import { auditEventLabel, evidenceUrl, type AuditEvent, type Snapshot } from "../../lib/auditor-client";
import { Icon, points } from "./AuditorUi";
import AuditorToggleGroup from "./AuditorToggleGroup";
import styles from "../../app/auditor/auditor.module.css";

const filters = [
  { value: "all", label: "Tất cả" },
  { value: "tests", label: "Lệnh" },
  { value: "warnings", label: "Cảnh báo" },
  { value: "rejects", label: "Từ chối" },
];

export default function AuditorFeed({ snapshot, events, total, ready, filter, query, onFilter, onQuery }: {
  snapshot: Snapshot | null; events: AuditEvent[]; total: number; ready: boolean;
  filter: string; query: string; onFilter: (value: string) => void; onQuery: (value: string) => void;
}) {
  const summary = snapshot?.summary;
  return <div className={styles.auditArea}>
    <section className={styles.panel}>
      <div className={styles.sectionHeading}><div><h2>Nhật ký giao dịch</h2><p className={styles.help}>Lệnh giả lập, minh chứng và đánh giá chiến lược.</p></div><span className={styles.muted}>{total} sự kiện</span></div>
      <div className={styles.feedControls}>
        <AuditorToggleGroup label="Bộ lọc sự kiện" variant="filters" value={filter} options={filters} onChange={onFilter} />
        <input type="search" aria-label="Tìm sự kiện trong nhật ký" placeholder="Tìm sự kiện..." value={query} onChange={event => onQuery(event.target.value)} />
      </div>
      <div className={styles.feed}>
        {!events.length ? <div className={styles.empty}><Icon name="activity" /><h3>{!ready && !snapshot ? "Đang chờ dữ liệu phiên" : total ? "Không có sự kiện phù hợp" : "Nhật ký của bạn bắt đầu tại đây"}</h3><p>{total ? "Thử bộ lọc khác hoặc xóa nội dung tìm kiếm." : snapshot?.session_id ? "Lưu lệnh giả lập để xem luận điểm, cảnh báo và minh chứng." : "Tạo hoặc chọn một phiên để bắt đầu ghi."}</p>{total > 0 && <button type="button" className={styles.button} onClick={() => { onQuery(""); onFilter("all"); }}>Xóa bộ lọc</button>}</div> : events.map(event => <article className={styles.event} key={event.id}>
          <div className={styles.eventMeta}><time className={styles.mono}>{event.timestamp}</time><span className={`${styles.badge} ${["BUY", "LONG"].includes(event.action || "") ? styles.positive : ["SELL", "SHORT"].includes(event.action || "") ? styles.negative : styles.muted}`}>{auditEventLabel(event)}</span>{event.price !== undefined && <strong className={styles.mono}>{event.price.toLocaleString("en-US")} <small>điểm</small></strong>}{event.contracts && <small className={styles.muted}>{event.contracts} hợp đồng</small>}</div>
          {(event.voice_transcript || event.reason) && <p className={styles.rationale}>{event.voice_transcript || event.reason}</p>}
          {!!event.warnings?.length && <div className={styles.warnings}>{event.warnings.map((warning, index) => <p key={`${warning.type}-${index}`}><Icon name="warning" /><span>{warning.message}</span></p>)}</div>}
          {event.ai_pending ? <p className={styles.aiNote}>Đang chờ AGY phân tích...</p> : event.ai_error ? <p className={`${styles.aiNote} ${styles.warning}`}>Không thể phân tích: {event.ai_error}</p> : event.ai_thesis ? <div className={styles.aiNote}><span>AGY</span><p>{event.ai_thesis}</p></div> : null}
          {(event.frame_path || event.drawing_data) && <details className={styles.evidence}><summary>Xem minh chứng</summary>{event.frame_path && <a href={evidenceUrl(event, snapshot!.current_date, snapshot!.session_id)} target="_blank" rel="noreferrer"><img src={evidenceUrl(event, snapshot!.current_date, snapshot!.session_id)} alt={`Ảnh chụp biểu đồ lúc ${event.timestamp}`} loading="lazy" /></a>}{event.drawing_data && <pre>{JSON.stringify(event.drawing_data, null, 2)}</pre>}</details>}
        </article>)}
      </div>
      <p className={styles.feedFooter}>{events.length} / {total} sự kiện gần đây · Mới nhất trước</p>
    </section>
    <section className={styles.panel}>
      <div className={styles.sectionHeading}><h2 title="Mỗi cặp tương ứng một hợp đồng có đủ lệnh mở và đóng.">Cặp lệnh đã đóng</h2><span className={styles.muted}>{summary?.total_closed_pairs || 0} đã hoàn tất</span></div>
      {summary?.pairs?.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Mở lệnh</th><th>Đóng lệnh</th><th>Giá BUY</th><th>Giá SELL</th><th>Lãi/lỗ gộp (điểm)</th><th>Lãi/lỗ ròng (điểm)</th></tr></thead><tbody>{summary.pairs.map((pair, index) => <tr key={`${pair.open_time}-${pair.close_time}-${index}`}><td>{pair.open_time}</td><td>{pair.close_time}</td><td>{points(pair.p_green)}</td><td>{points(pair.p_red)}</td><td>{points(pair.gross_points, true)}</td><td className={pair.net_points < 0 ? styles.negative : styles.positive}>{points(pair.net_points, true)}</td></tr>)}</tbody></table></div> : <div className={styles.tableEmpty}>Cặp lệnh BUY/SELL đã đóng sẽ hiển thị tại đây cùng kết quả sau phí.</div>}
    </section>
  </div>;
}

