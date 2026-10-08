import { LoadingControl, LoadingNumber, LoadingText, Skeleton } from "../ui/Loading";
import AuditorMetrics from "./AuditorMetrics";
import { AuditorSelect, Icon, TerminalSelect } from "./AuditorUi";
import AuditorToggleGroup from "./AuditorToggleGroup";
import AuditorStrategy from "./AuditorStrategy";
import { FeedLoading, PairsLoading } from "./AuditorLoadingParts";
import styles from "../../app/auditor/auditor.module.css";

export default function AuditorLoading() {
  return <main className={styles.workspace} lang="vi" aria-label="Không gian phân tích Quant">
    <div className={styles.container}>
      <header className={styles.sessionBar}>
        <div className={styles.sessionInfo}><div className={styles.sessionIdentity}><h1>Phiên hiện tại</h1><strong className={styles.mono}><LoadingText width="22ch" /></strong></div><div className={styles.sessionButtons}><button type="button" disabled className={styles.button}><Icon name="history" />Các phiên</button><button type="button" disabled className={`${styles.button} ${styles.primary}`}><Icon name="plus" />Tạo phiên</button></div></div>
        <div className={styles.terminalControls}><TerminalSelect value="ORCA" disabled loading onChange={() => {}} /><button type="button" disabled className={`${styles.button} ${styles.terminalButton}`}>Mở Terminal</button></div>
      </header>
      <AuditorMetrics snapshot={null} loading active={false} />
      <div className={styles.layout}>
        <aside className={styles.controls}>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}><h2>Nguồn ghi hình</h2></div>
            <AuditorToggleGroup loading disabled label="Nguồn ghi hình" variant="capture" value={undefined} options={[{ value: "DESKTOP", label: "Desktop" }, { value: "IN_APP", label: "Trình duyệt" }]} onChange={() => {}} />
            <div className={styles.field}><label>Cửa sổ ghi hình</label><div className={styles.inputAction}><AuditorSelect id="auditor-window-loading" label="Cửa sổ ghi hình" icon="capture" value={0} options={[]} disabled loading onChange={() => {}} /><button type="button" disabled className={styles.iconButton} aria-label="Làm mới danh sách cửa sổ"><Icon name="refresh" /></button></div><p className={styles.help}>Chỉ ghi hình cửa sổ đã chọn. Sự kiện được ghi tự động khi bạn tương tác với cửa sổ đó.</p></div>
            <div className={styles.recordingPanel}><div className={styles.sectionHeading}><strong>Ghi hình</strong><LoadingText width="7ch" /></div><div className={styles.recordingActions}><LoadingControl /><LoadingControl /></div><label className={styles.autoStart}><Skeleton width={16} height={16} /><span>Tự bắt đầu ghi khi chọn nguồn</span></label><p className={styles.help}><LoadingText width="80%" /></p></div>
          </section>
          <AuditorStrategy notes="" enabled={false} disabled saving={false} loading toggling={false} onSave={() => {}} onToggle={() => {}} />
          <section className={styles.panel}><h2>Giả lập đặt lệnh</h2><div className={styles.formRow}><div className={styles.field}><label>Giá vào lệnh</label><LoadingControl><LoadingNumber loading decimal /></LoadingControl></div><div className={styles.field}><label>Số hợp đồng</label><LoadingControl><LoadingNumber loading digits={1} /></LoadingControl></div></div></section>
        </aside>
        <div className={styles.auditArea}>
          <section className={styles.panel}><div className={styles.sectionHeading}><h2>Nhật ký giao dịch</h2><span className={styles.muted}><LoadingNumber loading digits={3} /> sự kiện</span></div><div className={styles.feedControls}><LoadingControl width="35ch" height={34} /><LoadingControl width="18ch" height={34} /></div><FeedLoading /></section>
          <section className={styles.panel}><div className={styles.sectionHeading}><h2>Cặp lệnh đã đóng</h2><span className={styles.muted}><LoadingNumber loading digits={3} /> đã hoàn tất</span></div><PairsLoading /></section>
        </div>
      </div>
    </div>
  </main>;
}

