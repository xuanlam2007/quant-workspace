"use client";

import { Icon } from "../auditor/AuditorUi";
import { ChartSelect } from "../chart/ui/ChartSelect";
import { HEADER_SVGS } from "../chart/layout/navigation/ChartHeader";
import { GO_TO_DATE_ICON } from "../chart/layout/navigation/GoToDateDialog";
import { LoadingText } from "../ui/Loading";
import BacktestChart from "./BacktestChart";
import BacktestConnectionSummary from "./BacktestConnectionSummary";
import AuditorConnection from "../auditor/AuditorConnection";
import styles from "./BacktestWorkspace.module.css";

const unchanged = () => {};

export default function BacktestLoading() {
  return <main className={styles.workspace} lang="vi" aria-label="Đang tải Backtest" aria-busy="true"><div className={styles.container}>
    <header className={styles.heading}><div><h1>Backtest trực quan</h1><p>Chart M1, chiến lược của bạn và lệnh mô phỏng.</p></div><span className={styles.badge}>Chế độ học · chưa đánh giá tốc độ live</span></header>
    <section className={styles.source} aria-label="Nguồn dữ liệu Backtest">
      <div className={styles.sourceRow}>
        <div className={styles.sourceField}><label>Mã giao dịch</label><button type="button" tabIndex={-1} className={styles.sourcePicker} disabled>{HEADER_SVGS.search}<span>VN30F1M</span></button></div>
        <div className={styles.sourceField}><label>Ngày lịch sử</label><button type="button" tabIndex={-1} className={styles.sourcePicker} disabled><LoadingText width="10ch" label="Đang tải ngày lịch sử" />{GO_TO_DATE_ICON}</button></div>
        <div className={styles.sourceField}><label>Độ chi tiết dữ liệu</label><ChartSelect id="backtest-loading-granularity" label="Độ chi tiết dữ liệu" value="1m" disabled onChange={unchanged} options={[{ value: "1m", label: "Nến M1" }]} /></div>
        <button type="button" tabIndex={-1} disabled><Icon name="history" />Nạp lịch sử</button>
        <button type="button" tabIndex={-1} disabled>Nhập JSON riêng</button>
        <button type="button" tabIndex={-1} disabled>Dữ liệu minh họa</button>
      </div>
      <p className={styles.help}>Nạp lịch sử từ kết nối chart dùng nến M1. Dữ liệu giây thật: nhập JSON với symbol, granularity: 1s và bars gồm time (Unix giây bắt đầu mẫu), open, high, low, close, volume. Mỗi file là một ngày, một mã; volume là lượng của từng mẫu. Timestamp theo giây không chứng minh độ chi tiết mỗi giây.</p>
    </section>
    <div className={styles.toolbar}>
      <button type="button" tabIndex={-1} className={`${styles.primary} ${styles.replayToggle}`} disabled><Icon name="play" />Chạy replay</button>
      <button type="button" tabIndex={-1} disabled>Phút tiếp theo</button>
      <button type="button" tabIndex={-1} disabled><Icon name="refresh" />Chạy lại từ đầu</button>
      <div className={styles.inline}><label>Tốc độ</label><ChartSelect id="backtest-loading-speed" label="Tốc độ replay" value={1} disabled onChange={unchanged} options={[{ value: 1, label: "1 phút / giây" }]} /></div>
      <div className={styles.clock}><span>Thời điểm replay (UTC+7)</span><strong>--:--:--</strong></div>
    </div>
    <div className={styles.layout}>
      <div className={styles.section}>
        <BacktestChart frame={null} symbol="M1" session={0} active={false} busy={false} />
        <p className={styles.help}>Dữ liệu M1 chỉ mở nến sau khi đóng; không dựng tick hoặc diễn biến trong nến. Replay chờ lượt AI trong chế độ học, thời gian xử lý thực được ghi riêng.</p>
        <section className={styles.panel}><div className={styles.panelHeading}><h2>Quyết định và drawing</h2><button type="button" tabIndex={-1} disabled><Icon name="export" />Xuất kết quả riêng</button></div><p className={styles.help}>AI nhận ảnh chart, các line, giá/volume đã replay và tài liệu chiến lược riêng.</p><div className={styles.journal} /></section>
      </div>
      <aside className={styles.aside}>
        <section className={`${styles.panel} ${styles.aiPanel}`}>
          <BacktestConnectionSummary loading ready={false} refreshing />
          <AuditorConnection context="backtest" className={styles.connectionConfig} status={null} loading pending="" disabled onSave={unchanged} onCheck={unchanged} onOpenTerminal={unchanged} />
          <button type="button" tabIndex={-1} disabled>Nhập chiến lược Markdown</button>
          <div className={styles.aiActions}>
            <button type="button" tabIndex={-1} disabled>Kiểm tra kết nối AI</button>
            <button type="button" tabIndex={-1} className={`${styles.primary} ${styles.full}`} disabled>Phân tích chart hiện tại</button>
          </div>
          <div className={styles.aiSettings}>
            <label className={`${styles.inline} ${styles.aiToggle}`}><input type="checkbox" tabIndex={-1} disabled />AI phân tích khi replay</label>
            <div className={styles.sourceField}><label htmlFor="backtest-loading-cadence">Khoảng phân tích</label><ChartSelect id="backtest-loading-cadence" label="Khoảng phân tích" value={1} disabled onChange={unchanged} options={[{ value: 1, label: "Mỗi phút" }]} /></div>
            <label className={styles.aiSecond}><span>Giây trong nến<small>Dữ liệu giây</small></span><input tabIndex={-1} type="number" value={55} disabled /></label>
          </div>
          <p className={`${styles.help} ${styles.aiHint}`}>Backtest dùng kết nối AI riêng, không cần khởi động Auditor. Khoảng phân tích là cấu hình thử nghiệm, không tự thay quy tắc chiến lược.</p>
        </section>
        <section className={styles.panel}><h2>Lệnh mô phỏng</h2><div className={styles.metrics}><div><span>Cặp đóng</span><strong>0</strong></div><div><span>Phí (điểm)</span><strong>0.00</strong></div><div><span>Sau phí</span><strong className={styles.positive}>0.00</strong></div></div>
          <p>Chưa có vị thế</p><label className={styles.inline}><input type="checkbox" tabIndex={-1} disabled />Áp dụng lệnh AI tự động</label>
          <button type="button" tabIndex={-1} disabled>Áp dụng quyết định hiện tại</button><button type="button" tabIndex={-1} disabled>Hủy lệnh chờ</button>
          <label>Phí mỗi cặp (điểm)<input tabIndex={-1} type="number" value={.45} disabled /></label>
          <p className={styles.help}>Một vị thế, một hợp đồng. Stop-Limit kích hoạt theo giá đóng mẫu, chỉ xét khớp Limit từ mẫu tiếp theo. Không giả lập partial fill, sổ lệnh hoặc thanh khoản. Chưa tự đóng vị thế cuối phiên.</p>
        </section>
        <section className={styles.panel}><h2>Hướng dẫn cho lượt tiếp theo</h2><textarea tabIndex={-1} disabled placeholder="Giải thích cách chọn điểm, kẻ line hoặc sửa cách AI hiểu..." aria-label="Hướng dẫn cho AI" /><p className={styles.help}>Không cung cấp diễn biến tương lai. Hướng dẫn không tự sửa tài liệu chiến lược. Chạy lại giữ kết quả cũ riêng trong tab, không gửi chúng cho AI. Xuất kết quả trước khi đóng hoặc tải lại trang.</p></section>
      </aside>
    </div>
  </div></main>;
}
