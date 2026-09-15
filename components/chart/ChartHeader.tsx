import type { ConnStatus } from "@/lib/dchart-socket";
import { RESOLUTIONS, STUDY_CATALOG, SYMBOLS, TIMEFRAME_GROUPS, type StudyId } from "./chart-config";

interface ChartHeaderProps {
  symbol: string;
  resolution: string;
  status: ConnStatus;
  lastPrice: string;
  timeframeMenuOpen: boolean;
  indicatorMenuOpen: boolean;
  indicatorSearch: string;
  activeStudies: StudyId[];
  maDescription: string;
  isFullscreen: boolean;
  onSymbolChange: (symbol: string) => void;
  onResolutionChange: (resolution: string) => void;
  onTimeframeMenuToggle: (open: boolean) => void;
  onIndicatorMenuToggle: (open: boolean) => void;
  onIndicatorSearchChange: (search: string) => void;
  onStudyToggle: (id: StudyId) => void;
  onDownloadSnapshot: () => void;
  onToggleFullscreen: () => void;
}

export function ChartHeader({
  symbol,
  resolution,
  status,
  lastPrice,
  timeframeMenuOpen,
  indicatorMenuOpen,
  indicatorSearch,
  activeStudies,
  maDescription,
  isFullscreen,
  onSymbolChange,
  onResolutionChange,
  onTimeframeMenuToggle,
  onIndicatorMenuToggle,
  onIndicatorSearchChange,
  onStudyToggle,
  onDownloadSnapshot,
  onToggleFullscreen,
}: ChartHeaderProps) {
  const normalizedSearch = indicatorSearch.trim().toLocaleLowerCase("vi");
  const filteredStudies = STUDY_CATALOG.filter((study) =>
    `${study.label} ${study.description}`.toLocaleLowerCase("vi").includes(normalizedSearch)
  );

  return (
    <header className="chart-header">
      <div className="symbol-row">
        <div className="product-mark" title="VNDIRECT chart workspace" aria-label="VNDIRECT chart workspace">D</div>
        <select value={symbol} onChange={(event) => onSymbolChange(event.target.value)}>
          {SYMBOLS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <details className="timeframe-menu" open={timeframeMenuOpen} onToggle={(event) => onTimeframeMenuToggle(event.currentTarget.open)}>
          <summary>{RESOLUTIONS.find((item) => item.value === resolution)?.label ?? "1D"}</summary>
          <div className="timeframe-menu__panel">
            {TIMEFRAME_GROUPS.map((group) => (
              <div className="timeframe-menu__group" key={group.label}>
                <div className="timeframe-menu__heading">{group.label}</div>
                {group.options.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={option.value === resolution ? "timeframe-menu__option timeframe-menu__option--active" : "timeframe-menu__option"}
                    onClick={() => onResolutionChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </details>
        <details className="indicator-menu" open={indicatorMenuOpen} onToggle={(event) => onIndicatorMenuToggle(event.currentTarget.open)}>
          <summary className="header-button">Chỉ báo <span>{activeStudies.length}</span></summary>
          <div className="indicator-menu__panel">
            <div className="indicator-menu__title">
              <strong>Các chỉ báo</strong>
              <button type="button" aria-label="Đóng danh sách chỉ báo" onClick={() => onIndicatorMenuToggle(false)}>×</button>
            </div>
            <label className="indicator-menu__search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.6 19.2-4.3-4.3a7.5 7.5 0 1 0-1.4 1.4l4.3 4.3 1.4-1.4ZM5 10.5a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0Z" /></svg>
              <input value={indicatorSearch} onChange={(event) => onIndicatorSearchChange(event.target.value)} placeholder="Tìm kiếm" autoFocus />
            </label>
            <div className="indicator-menu__heading">Tên chỉ báo</div>
            <div className="indicator-menu__list">
              {filteredStudies.map((study) => (
                <label key={study.id} className={activeStudies.includes(study.id) ? "indicator-menu__option indicator-menu__option--active" : "indicator-menu__option"}>
                  <input type="checkbox" checked={activeStudies.includes(study.id)} onChange={() => onStudyToggle(study.id)} />
                  <i style={{ background: study.color }} />
                  <span><b>{study.label}</b><small>{study.id === "volume" ? maDescription : study.description}</small></span>
                </label>
              ))}
              {filteredStudies.length === 0 && <div className="indicator-menu__empty">Không tìm thấy chỉ báo</div>}
            </div>
          </div>
        </details>
      </div>
      <div className="status-row">
        <span className={`dot ${status === "connected" ? "dot--on" : "dot--off"}`} />
        <span className="connection-label">{status}</span>
        <span id="last-price">{lastPrice}</span>
        <span className="header-separator" />
        <button className="header-icon-button" title="Download chart snapshot" aria-label="Download chart snapshot" onClick={onDownloadSnapshot}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5 10 3h4l1.5 2H19a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.5ZM12 8a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" /></svg>
        </button>
        <button className={isFullscreen ? "header-icon-button header-button--active" : "header-icon-button"} title="Toggle fullscreen" aria-label="Toggle fullscreen" onClick={onToggleFullscreen}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z" /></svg>
        </button>
      </div>
    </header>
  );
}
