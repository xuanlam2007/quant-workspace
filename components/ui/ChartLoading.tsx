import { AppHeader } from "../AppHeader";
import { DRAWING_TOOL_GROUPS, RANGE_PRESETS } from "../chart/config/chart-config";
import { LoadingNumber, LoadingText, Skeleton } from "./Loading";
import styles from "./Loading.module.css";

function IconSlot() {
  return <span className="header-btn__icon"><Skeleton width={18} height={18} label="Đang tải công cụ" /></span>;
}

function HeaderIconSlot() {
  return <span className="header-btn header-btn--icon"><IconSlot /></span>;
}

function DrawingSlot({ group = false }: { group?: boolean }) {
  const slot = <span className="toolbar-button"><Skeleton width={24} height={24} label="Đang tải công cụ vẽ" /></span>;
  return group ? <div className="toolbar-group">{slot}</div> : slot;
}

export default function ChartLoading() {
  return <div id="app" aria-busy="true">
    <AppHeader />
    <header className={`chart-header ${styles.chartPlaceholder}`} aria-label="Đang tải thanh công cụ biểu đồ">
      <div className="chart-header__group chart-header__group--left">
        <span className="header-btn header-btn--symbol"><IconSlot /><span className="header-btn__symbol-text"><LoadingText width="7ch" /></span></span>
        <HeaderIconSlot /><span className="header-divider" />
        <span className="header-btn header-btn--text"><LoadingText width="2ch" /></span>
        <span className="header-divider" /><HeaderIconSlot /><span className="header-divider" />
        <span className="header-btn header-btn--with-icon"><IconSlot /><span className="header-btn__text">Các chỉ báo</span></span>
        <span className="header-divider" /><HeaderIconSlot /><HeaderIconSlot />
      </div>
      <div className="chart-header__group chart-header__group--right">
        <span className="header-divider" /><span className="header-btn"><LoadingText width="10ch" /></span><span className="header-divider" />
        <HeaderIconSlot /><HeaderIconSlot /><HeaderIconSlot />
      </div>
    </header>
    <div className={`chart-shell ${styles.chartPlaceholder}`}>
      <aside className="drawing-toolbar" aria-label="Đang tải công cụ vẽ">
        <DrawingSlot group />{DRAWING_TOOL_GROUPS.map(group => <DrawingSlot key={group.id} group />)}
        <span className="toolbar-divider" /><DrawingSlot /><DrawingSlot />
        <span className="toolbar-divider" />{["magnet", "stay", "lock", "visibility"].map(id => <DrawingSlot key={id} />)}
        <span className="toolbar-divider" /><DrawingSlot group />
      </aside>
      <div className="chart-stage">
        <div className="market-data-panel" style={{ left: 4, right: 4, top: 4 }}>
          <div className="market-data-row">
            <div className="market-data__title"><span className="market-data__instrument"><LoadingText width="38ch" label="Đang tải mã giao dịch" /></span></div>
            <div className="ohlcv-strip">{["O", "H", "L", "C"].map(label => <span key={label}>{label} <b><LoadingNumber loading digits={7} decimal label={`Đang tải giá ${label}`} /></b></span>)}</div>
          </div>
        </div>
        <main id="chart" className={styles.chartCanvas} aria-label="Đang tải biểu đồ" />
        <footer className="chart-footer">
          <div className="range-presets">{RANGE_PRESETS.map(preset => <button key={preset.label} type="button" tabIndex={-1} disabled>{preset.label}</button>)}<span className="chart-footer__separator" /><button type="button" tabIndex={-1} className="chart-footer__go-to-date" disabled aria-label="Đang tải chọn ngày"><Skeleton width={18} height={18} /></button></div>
          <div className="chart-footer__settings">{["%", "log", "tự động"].map(label => <button key={label} type="button" tabIndex={-1} disabled>{label}</button>)}</div>
        </footer>
      </div>
    </div>
  </div>;
}
