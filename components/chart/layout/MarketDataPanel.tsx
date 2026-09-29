"use client";

import { useEffect, useRef, useState } from "react";
import type { Bar, SymbolInfo } from "@/lib/dchart-api";
import { RESOLUTIONS, type MaType } from "../config/chart-config";
import { formatVolume } from "../core/chart-utils";

export interface ComparisonQuote {
  symbol: string;
  description: string;
  exchange: string;
  price: number;
  change: number;
  changePercent: number;
  color: string;
}

interface MarketDataPanelProps {
  symbol: string;
  exchange: string;
  symbolInfo?: SymbolInfo;
  pricePrecision: number;
  resolution: string;
  quoteBar?: Bar;
  previousClose?: number;
  comparisons?: ComparisonQuote[];
  seriesVisible: boolean;
  scaleSide: "left" | "right";
  volumeEnabled: boolean;
  currentVolumeMa?: number;
  maLength: number;
  maType: MaType;
  smoothingLength: number;
  seriesValueVisible: boolean;
  priceLineVisible: boolean;
  onToggleSeriesVisibility: () => void;
  onCopyPrice: (price: number) => void;
  onPastePrice: () => void;
  onMoveToPane: (direction: "above" | "below") => void;
  onMoveSeriesOrder: (direction: "front" | "back") => void;
  onPinToScale: (side: "left" | "right") => void;
  onToggleSeriesValue: () => void;
  onTogglePriceLine: () => void;
  onToggleVolume: () => void;
  onMaLengthChange: (length: number) => void;
  onMaTypeChange: (type: MaType) => void;
  onSmoothingLengthChange: (length: number) => void;
}

type MenuSubmenu = "order" | "pane" | "scale" | null;

export function MarketDataPanel({
  symbol,
  exchange,
  symbolInfo,
  pricePrecision,
  resolution,
  quoteBar,
  previousClose,
  comparisons = [],
  seriesVisible,
  scaleSide,
  volumeEnabled,
  currentVolumeMa,
  maLength,
  maType,
  smoothingLength,
  seriesValueVisible,
  priceLineVisible,
  onToggleSeriesVisibility,
  onCopyPrice,
  onPastePrice,
  onMoveToPane,
  onMoveSeriesOrder,
  onPinToScale,
  onToggleSeriesValue,
  onTogglePriceLine,
  onToggleVolume,
  onMaLengthChange,
  onMaTypeChange,
  onSmoothingLengthChange,
}: MarketDataPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [submenu, setSubmenu] = useState<MenuSubmenu>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [volumeSettingsOpen, setVolumeSettingsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const price = quoteBar?.close;
  const change = quoteBar && previousClose !== undefined ? quoteBar.close - previousClose : 0;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;
  const quoteClass = change >= 0 ? "quote--up" : "quote--down";
  const formatPrice = (value?: number) => value?.toFixed(pricePrecision) ?? "N/A";
  const instrumentTitle = symbolInfo?.description || symbol;

  useEffect(() => {
    if (!menuOpen && !settingsOpen && !infoOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuOpen && !menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setSubmenu(null);
        setSettingsOpen(false);
        setInfoOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnPointer, true);
    document.addEventListener("keydown", closeOnKey, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer, true);
      document.removeEventListener("keydown", closeOnKey, true);
    };
  }, [infoOpen, menuOpen, settingsOpen]);

  const openMenuAt = (x: number, y: number) => {
    setMenuPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - 320)),
      top: Math.max(8, Math.min(y, window.innerHeight - 430)),
    });
    setSubmenu(null);
    setMenuOpen(true);
  };

  const openMenu = (target: HTMLButtonElement) => {
    const rect = target.getBoundingClientRect();
    openMenuAt(rect.left, rect.bottom + 5);
  };

  const runMenuAction = (action: () => void) => {
    action();
    setMenuOpen(false);
    setSubmenu(null);
  };

  const renderMenuButton = (label: string, action: () => void, disabled = false) => (
    <button type="button" tabIndex={-1} role="menuitem" className="series-menu__item" disabled={disabled} onClick={() => runMenuAction(action)}>
      {label}
    </button>
  );

  return (
    <div className="market-data-panel">
      <div
        className="market-data-row"
        onContextMenu={(event) => {
          event.preventDefault();
          openMenuAt(event.clientX, event.clientY);
        }}
      >
        <div className="market-data__title">
          <span className="market-data__instrument">{instrumentTitle}</span>
          <span className="market-data__separator">·</span>
          <span>{RESOLUTIONS.find((item) => item.value === resolution)?.label ?? resolution}</span>
          <span className="market-data__separator">·</span>
          <span>{exchange || "N/A"}</span>
        </div>
        <div className="ohlcv-strip" aria-label="Open high low close volume">
          <span>O <b>{formatPrice(quoteBar?.open)}</b></span>
          <span>H <b>{formatPrice(quoteBar?.high)}</b></span>
          <span>L <b>{formatPrice(quoteBar?.low)}</b></span>
          <span>C <b className={quoteClass}>{formatPrice(quoteBar?.close)}</b></span>
          {previousClose !== undefined && <span className={quoteClass}>{change >= 0 ? "+" : ""}{change.toFixed(pricePrecision)} ({changePercent.toFixed(2)}%)</span>}
          <span className="ohlcv-strip__volume">Vol <b>{quoteBar ? formatVolume(quoteBar.volume) : "N/A"}</b></span>
        </div>
        <div className="market-data__actions">
          <button type="button" tabIndex={-1} aria-label={seriesVisible ? "Hide instrument" : "Show instrument"} aria-pressed={seriesVisible} title={seriesVisible ? "Hide" : "Show"} onClick={onToggleSeriesVisibility}>
            {seriesVisible ? "◉" : "○"}
          </button>
          <button type="button" tabIndex={-1} aria-label="Instrument options" title="More actions" onClick={(event) => openMenu(event.currentTarget)}>•••</button>
        </div>
      </div>

      {comparisons.map((comparison) => (
        <div className="market-data__comparison" key={comparison.symbol}>
          <span>{comparison.description || comparison.symbol}, {comparison.exchange}</span>
          <b style={{ color: comparison.color }}>{formatPrice(comparison.price)}</b>
          <span style={{ color: comparison.change >= 0 ? "#26a69a" : "#ef5350" }}>
            {comparison.change >= 0 ? "+" : ""}{formatPrice(comparison.change)} ({comparison.changePercent >= 0 ? "+" : ""}{comparison.changePercent.toFixed(2)}%)
          </span>
        </div>
      ))}

      <div className={`indicator-data-row${volumeEnabled ? "" : " indicator-data-row--hidden"}`}>
        <span className="indicator-data__name">Khối lượng {maLength} {maType} {smoothingLength}</span>
        <span className="indicator-data__volume">{quoteBar ? formatVolume(quoteBar.volume) : "N/A"}</span>
        <span className="indicator-data__ma">{currentVolumeMa !== undefined ? formatVolume(currentVolumeMa) : "N/A"}</span>
        {volumeSettingsOpen && volumeEnabled && (
          <label className="ma-control" data-tooltip="Volume moving average settings">
            <select tabIndex={-1} value={maType} aria-label="MA type" onChange={(event) => onMaTypeChange(event.target.value as MaType)}>
              <option value="SMA">SMA</option>
              <option value="EMA">EMA</option>
              <option value="WMA">WMA</option>
            </select>
            <input tabIndex={-1} type="number" min="2" max="500" value={maLength} aria-label="MA length" onChange={(event) => onMaLengthChange(Math.max(2, Math.min(500, Number(event.target.value) || 2)))} />
            <input tabIndex={-1} type="number" min="1" max="500" value={smoothingLength} aria-label="Smoothing length" onChange={(event) => onSmoothingLengthChange(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} />
          </label>
        )}
        <div className="indicator-data__actions">
          <button type="button" tabIndex={-1} aria-label={volumeEnabled ? "Hide volume" : "Show volume"} aria-pressed={volumeEnabled} title={volumeEnabled ? "Hide" : "Show"} onClick={onToggleVolume}>{volumeEnabled ? "◉" : "○"}</button>
          <button type="button" tabIndex={-1} aria-label="Volume settings" aria-pressed={volumeSettingsOpen} title="Settings" onClick={() => setVolumeSettingsOpen((open) => !open)}>⚙</button>
          <button type="button" tabIndex={-1} aria-label="Remove volume" title="Remove" onClick={onToggleVolume}>×</button>
        </div>
      </div>

      <div className="market-data__popover-host" ref={menuRef}>
        {menuOpen && (
          <div className="series-menu" role="menu" aria-label="Series options" style={{ left: menuPosition.left, top: menuPosition.top }}>
            {renderMenuButton("Thông tin Mã giao dịch…", () => setInfoOpen(true))}
            {renderMenuButton(`Sao chép giá ${formatPrice(price)}`, () => price !== undefined && onCopyPrice(price), price === undefined)}
            {renderMenuButton("Dán", onPastePrice)}
            <div className="series-menu__divider" />
            {([
              ["order", "Thứ tự Trực quan"],
              ["pane", "Chuyển tới"],
              ["scale", `Ghim theo Tỷ lệ (hiện tại bên ${scaleSide === "right" ? "phải" : "trái"})`],
            ] as const).map(([id, label]) => (
              <div className="series-menu__submenu-wrap" key={id} onMouseEnter={() => setSubmenu(id)} onMouseLeave={() => setSubmenu(null)}>
                <button type="button" role="menuitem" tabIndex={-1} className="series-menu__item" aria-haspopup="menu" aria-expanded={submenu === id} onClick={() => setSubmenu(submenu === id ? null : id)}>
                  {label}<span aria-hidden="true">›</span>
                </button>
                {submenu === id && (
                  <div className="series-menu__submenu" role="menu" aria-label={label}>
                    {id === "order" && <>
                      {renderMenuButton("Đưa lên trước", () => onMoveSeriesOrder("front"))}
                      {renderMenuButton("Đưa xuống sau", () => onMoveSeriesOrder("back"))}
                    </>}
                    {id === "pane" && <>
                      {renderMenuButton("Cửa sổ mới bên trên", () => onMoveToPane("above"))}
                      {renderMenuButton("Cửa sổ mới bên dưới", () => onMoveToPane("below"))}
                    </>}
                    {id === "scale" && <>
                      {renderMenuButton("Bên trái", () => onPinToScale("left"))}
                      {renderMenuButton("Bên phải", () => onPinToScale("right"))}
                    </>}
                  </div>
                )}
              </div>
            ))}
            <div className="series-menu__divider" />
            {renderMenuButton(seriesVisible ? "Ẩn" : "Hiện", onToggleSeriesVisibility)}
            {renderMenuButton("Cài đặt…", () => setSettingsOpen(true))}
          </div>
        )}
      </div>

      {infoOpen && (
        <div className="series-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInfoOpen(false); }}>
          <section className="series-dialog" role="dialog" aria-modal="true" aria-labelledby="series-info-title">
            <header><h2 id="series-info-title">Thông tin Mã giao dịch</h2><button type="button" tabIndex={-1} aria-label="Close" onClick={() => setInfoOpen(false)}>×</button></header>
            <dl>
              <div><dt>Mã</dt><dd>{symbol}</dd></div>
              <div><dt>Mô tả</dt><dd>{instrumentTitle}</dd></div>
              <div><dt>Sàn</dt><dd>{exchange || "N/A"}</dd></div>
              <div><dt>Loại</dt><dd>{symbolInfo?.type || "N/A"}</dd></div>
              <div><dt>Múi giờ</dt><dd>{symbolInfo?.timezone || "N/A"}</dd></div>
              <div><dt>Phiên</dt><dd>{symbolInfo?.session || "N/A"}</dd></div>
            </dl>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="series-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="series-dialog" role="dialog" aria-modal="true" aria-labelledby="series-settings-title">
            <header><h2 id="series-settings-title">Cài đặt {symbol}</h2><button type="button" tabIndex={-1} aria-label="Close" onClick={() => setSettingsOpen(false)}>×</button></header>
            <label className="series-dialog__toggle"><input tabIndex={-1} type="checkbox" checked={seriesValueVisible} onChange={onToggleSeriesValue} /><span>Nhãn giá cuối cùng</span></label>
            <label className="series-dialog__toggle"><input tabIndex={-1} type="checkbox" checked={priceLineVisible} onChange={onTogglePriceLine} /><span>Đường giá</span></label>
            <footer><button type="button" tabIndex={-1} onClick={() => setSettingsOpen(false)}>Đóng</button></footer>
          </section>
        </div>
      )}
    </div>
  );
}
