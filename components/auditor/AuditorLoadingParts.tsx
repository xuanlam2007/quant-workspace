import { LoadingControl, LoadingNumber, LoadingText } from "../ui/Loading";
import styles from "../../app/auditor/auditor.module.css";

export function FeedLoading() {
  return <div aria-busy="true" aria-label="Đang tải nhật ký giao dịch">{Array.from({ length: 3 }, (_, index) =>
    <article className={styles.event} key={index}>
      <div className={styles.eventMeta}><LoadingNumber loading template="00:00:00" label="Đang tải thời gian sự kiện" /><LoadingText width="9ch" /><LoadingNumber loading decimal label="Đang tải giá lệnh" /></div>
      <div className={styles.loadingLines}><LoadingText width="87%" delay={index * 40} /><LoadingText width="61%" delay={index * 40 + 40} /></div>
    </article>
  )}</div>;
}

const pairColumns = ["Mở lệnh", "Đóng lệnh", "Giá BUY", "Giá SELL", "Lãi/lỗ gộp (điểm)", "Lãi/lỗ ròng (điểm)"];

export function PairsLoading() {
  return <div className={styles.tableScroll} aria-busy="true"><table className={styles.table} aria-label="Đang tải cặp lệnh đã đóng">
    <thead><tr>{pairColumns.map(label => <th key={label}>{label}</th>)}</tr></thead>
    <tbody>{Array.from({ length: 3 }, (_, row) => <tr key={row}>{pairColumns.map((label, column) => <td key={label}>{column < 2 ? <LoadingNumber loading template="00:00:00" label={`Đang tải thời gian ${label}`} /> : <LoadingNumber loading decimal label={`Đang tải ${label}`} />}</td>)}</tr>)}</tbody>
  </table></div>;
}

export function SessionsLoading() {
  return <section className={styles.sessionGroup} aria-busy="true" aria-label="Đang tải lịch sử phiên">
    <h3><LoadingNumber loading template="0000-00-00" label="Đang tải ngày của phiên" /></h3>{Array.from({ length: 3 }, (_, index) => <div className={styles.sessionItem} key={index}>
      <div className={styles.sessionTitle}><LoadingText width="18ch" delay={index * 40} /></div>
      <p className={styles.help}><LoadingNumber loading digits={3} label="Đang tải số sự kiện của phiên" /> sự kiện đã ghi</p>
      <div className={styles.sessionActions}><LoadingControl width="7ch" height={34} /><LoadingControl width="5ch" height={34} /></div>
    </div>)}
  </section>;
}
