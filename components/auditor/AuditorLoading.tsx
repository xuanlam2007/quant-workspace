import { LoadingControl, LoadingImage, LoadingNumber, LoadingText, Skeleton } from "../ui/Loading";
import AuditorMetrics from "./AuditorMetrics";
import { AuditorSelect, Icon, TerminalSelect } from "./AuditorUi";
import AuditorToggleGroup from "./AuditorToggleGroup";
import AuditorStrategy from "./AuditorStrategy";
import AuditorConnection from "./AuditorConnection";
import AuditorAudio from "./AuditorAudio";
import { FeedLoading, PairsLoading } from "./AuditorLoadingParts";
import styles from "../../app/auditor/auditor.module.css";

export default function AuditorLoading() {
  return <main className={styles.workspace} lang="vi" aria-label="Không gian phân tích Quant">
    <div className={styles.container}>
      <header className={styles.sessionBar}>
        <div className={styles.sessionInfo}><div className={styles.sessionIdentity}><h1>Phiên hiện tại</h1><strong className={styles.mono}><LoadingText width="22ch" /></strong></div><div className={styles.sessionButtons}><button type="button" disabled className={styles.button}><Icon name="history" />Các phiên</button><button type="button" disabled className={`${styles.button} ${styles.primary}`}><Icon name="plus" />Tạo phiên</button></div></div>
        <div className={styles.terminalControls}><TerminalSelect value="ORCA" disabled loading onChange={() => {}} /><button type="button" disabled className={`${styles.button} ${styles.terminalButton}`}>Mở Terminal</button></div>
      </header>
      <AuditorMetrics loading />
      <div className={styles.layout}>
        <aside className={styles.controls}>
          <section className={`${styles.panel} ${styles.capturePanel}`}>
            <div className={styles.sectionHeading}><h2>Nguồn ghi hình</h2></div>
            <AuditorToggleGroup loading disabled label="Nguồn ghi hình" variant="capture" value={undefined} options={[{ value: "DESKTOP", label: "Desktop" }, { value: "IN_APP", label: "Trình duyệt" }]} onChange={() => {}} />
            <div className={styles.captureSources}><div className={`${styles.field} ${styles.capturePane}`} data-active="true"><label>Cửa sổ ghi hình</label><div className={styles.inputAction}><AuditorSelect id="auditor-window-loading" label="Cửa sổ ghi hình" icon="capture" value={0} options={[]} disabled loading onChange={() => {}} /><button type="button" disabled className={styles.iconButton} aria-label="Làm mới danh sách cửa sổ"><Icon name="refresh" /></button></div><p className={styles.help}>Chỉ ghi hình cửa sổ đã chọn. Sự kiện được ghi tự động khi bạn tương tác với cửa sổ đó.</p><div className={styles.capturePreview}><LoadingImage label="Đang tải nguồn ghi hình" /></div></div></div>
            <div className={styles.recordingPanel}><div className={styles.sectionHeading}><strong>Ghi hình</strong><span className={styles.recordingStatus}><LoadingText width="11ch" /></span></div><div className={styles.recordingActions}><LoadingControl /><LoadingControl /></div><label className={styles.autoStart}><Skeleton width={16} height={16} /><span>Tự bắt đầu ghi khi chọn nguồn</span></label><p className={`${styles.help} ${styles.captureHint}`}><LoadingText width="80%" /></p></div>
          </section>
          <AuditorAudio audio={{ status: "off", error: "", savedClips: 0, saving: false, mediaStream: null, deviceId: "", setDeviceId: () => {}, retry: () => {}, saveClip: () => {}, unsavedClips: [], dismissClip: () => {} }} enabled loading disabled canRecord={false} hasSource={false} canHear={false} onToggle={() => {}} />
          <AuditorStrategy enabled={false} available={false} documents={[]} disabled loading toggling={false} onToggle={() => {}} />
          <AuditorConnection status={null} loading pending="" disabled onSave={() => {}} onCheck={() => {}} onOpenTerminal={() => {}} />
        </aside>
        <div className={styles.auditArea}>
          <section className={styles.panel}><div className={styles.sectionHeading}><h2>Nhật ký quan sát</h2><span className={styles.muted}><LoadingNumber loading digits={3} /> sự kiện</span></div><div className={styles.feedControls}><LoadingControl width="35ch" height={34} /><LoadingControl width="18ch" height={34} /></div><FeedLoading /></section>
          <section className={styles.panel}><div className={styles.sectionHeading}><h2>Cặp lệnh đã đóng</h2><LoadingNumber loading digits={3} /></div><PairsLoading /></section>
        </div>
      </div>
    </div>
  </main>;
}

