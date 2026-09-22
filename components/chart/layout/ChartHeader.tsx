"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { connectionStatusLabel, type ConnStatus } from "@/lib/dchart-socket";
import {
  RESOLUTIONS,
  STUDY_CATALOG,
  TIMEFRAME_GROUPS,
  type StudyId,
} from "../config/chart-config";
import { SymbolSearchModal } from "./SymbolSearchModal";

const HEADER_SVGS = {
  search: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M3.5 8a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM8 2a6 6 0 1 0 3.65 10.76l3.58 3.58 1.06-1.06-3.57-3.57A6 6 0 0 0 8 2Z" />
    </svg>
  ),
  inputSearch: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18" fill="none" aria-hidden="true">
      <path stroke="currentColor" d="M12.4 12.5a7 7 0 1 0-4.9 2 7 7 0 0 0 4.9-2zm0 0 5.101 5" />
    </svg>
  ),
  compare: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <path fill="currentColor" d="M13.5 6a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM4 14.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" />
      <path fill="currentColor" d="M9 14h4v-4h1v4h4v1h-4v4h-1v-4H9v-1z" />
    </svg>
  ),
  candles: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="currentColor" aria-hidden="true">
      <path d="M17 11v6h3v-6h-3zm-.5-1h4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5z" />
      <path d="M18 7h1v3.5h-1zm0 10.5h1V21h-1z" />
      <path d="M9 8v12h3V8H9zm-.5-1h4a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5z" />
      <path d="M10 4h1v3.5h-1zm0 16.5h1V24h-1z" />
    </svg>
  ),
  indicators: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true">
      <path stroke="currentColor" strokeWidth="1.2" d="M20 17l-5 5M15 17l5 5M9 11.5h7M17.5 8a2.5 2.5 0 0 0-5 0v11a2.5 2.5 0 0 1-5 0" />
    </svg>
  ),
  undo: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <path fill="currentColor" d="M8.707 13l2.647 2.646-.707.708L6.792 12.5l3.853-3.854.708.708L8.707 12H14.5a5.5 5.5 0 0 1 5.5 5.5V19h-1v-1.5a4.5 4.5 0 0 0-4.5-4.5H8.707z" />
    </svg>
  ),
  redo: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <path fill="currentColor" d="M18.293 13l-2.647 2.646.707.708 3.854-3.854-3.854-3.854-.707.708L18.293 12H12.5A5.5 5.5 0 0 0 7 17.5V19h1v-1.5a4.5 4.5 0 0 1 4.5-4.5h5.793z" />
    </svg>
  ),
  settings: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <g fill="currentColor" fillRule="evenodd">
        <path fillRule="nonzero" d="M14 17a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0-1a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
        <path d="M5.005 16A1.003 1.003 0 0 1 4 14.992v-1.984A.998.998 0 0 1 5 12h1.252a7.87 7.87 0 0 1 .853-2.06l-.919-.925c-.356-.397-.348-1 .03-1.379l1.42-1.42a1 1 0 0 1 1.416.007l.889.882A7.96 7.96 0 0 1 12 6.253V5c0-.514.46-1 1-1h2c.557 0 1 .44 1 1v1.253a7.96 7.96 0 0 1 2.06.852l.888-.882a1 1 0 0 1 1.416-.006l1.42 1.42a.999.999 0 0 1 .029 1.377s-.4.406-.918.926a7.87 7.87 0 0 1 .853 2.06H23c.557 0 1 .447 1 1.008v1.984A.998.998 0 0 1 23 16h-1.252a7.87 7.87 0 0 1-.853 2.06l.882.888a1 1 0 0 1 .006 1.416l-1.42 1.42a1 1 0 0 1-1.415-.007l-.889-.882a7.96 7.96 0 0 1-2.059.852v1.248c0 .56-.45 1.005-1.008 1.005h-1.984A1.004 1.004 0 0 1 12 22.995v-1.248a7.96 7.96 0 0 1-2.06-.852l-.888.882a1 1 0 0 1-1.416.006l-1.42-1.42a1 1 0 0 1 .007-1.415l.882-.888A7.87 7.87 0 0 1 6.252 16H5.005zm3.378-6.193l-.227.34A6.884 6.884 0 0 0 7.14 12.6l-.082.4H5.005C5.002 13 5 13.664 5 14.992c0 .005.686.008 2.058.008l.082.4c.18.883.52 1.71 1.016 2.453l.227.34-1.45 1.46c-.004.003.466.477 1.41 1.422l1.464-1.458.34.227a6.959 6.959 0 0 0 2.454 1.016l.399.083v2.052c0 .003.664.005 1.992.005.005 0 .008-.686.008-2.057l.399-.083a6.959 6.959 0 0 0 2.454-1.016l.34-.227 1.46 1.45c.003.004.477-.466 1.422-1.41l-1.458-1.464.227-.34A6.884 6.884 0 0 0 20.86 15.4l.082-.4h2.053c.003 0 .005-.664.005-1.992 0-.005-.686-.008-2.058-.008l-.082-.4a6.884 6.884 0 0 0-1.016-2.453l-.227-.34 1.376-1.384.081-.082-1.416-1.416-1.465 1.458-.34-.227a6.959 6.959 0 0 0-2.454-1.016L15 7.057V5c0-.003-.664-.003-1.992 0-.005 0-.008.686-.008 2.057l-.399.083a6.959 6.959 0 0 0-2.454 1.016l-.34.227-1.46-1.45c-.003-.004-.477.466-1.421 1.408l1.457 1.466z" />
      </g>
    </svg>
  ),
  fullscreen: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <path fill="currentColor" d="M8.5 6A2.5 2.5 0 0 0 6 8.5V11h1V8.5C7 7.67 7.67 7 8.5 7H11V6H8.5zM6 17v2.5A2.5 2.5 0 0 0 8.5 22H11v-1H8.5A1.5 1.5 0 0 1 7 19.5V17H6zM19.5 7H17V6h2.5A2.5 2.5 0 0 1 22 8.5V11h-1V8.5c0-.83-.67-1.5-1.5-1.5zM22 19.5V17h-1v2.5c0 .83-.67 1.5-1.5 1.5H17v1h2.5a2.5 2.5 0 0 0 2.5-2.5z" />
    </svg>
  ),
  fullscreenExit: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <path fill="currentColor" d="M17 6v2.5a2.5 2.5 0 0 0 2.5 2.5H22v-1h-2.5A1.5 1.5 0 0 1 18 8.5V6h-1zm2.5 11a2.5 2.5 0 0 0-2.5 2.5V22h1v-2.5c0-.83-.67-1.5-1.5-1.5H22v-1h-2.5zm-11 1H6v-1h2.5a2.5 2.5 0 0 1 2.5 2.5V22h-1v-2.5c0-.83-.67-1.5-1.5-1.5zM11 8.5V6h-1v2.5c0 .83-.67 1.5-1.5 1.5H6v1h2.5A2.5 2.5 0 0 0 11 8.5z" />
    </svg>
  ),
  camera: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M11.118 6a.5.5 0 0 0-.447.276L9.809 8H5.5A1.5 1.5 0 0 0 4 9.5v10A1.5 1.5 0 0 0 5.5 21h16a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 21.5 8h-4.309l-.862-1.724A.5.5 0 0 0 15.882 6h-4.764zm-1.342-.17A1.5 1.5 0 0 1 11.118 5h4.764a1.5 1.5 0 0 1 1.342.83L17.809 7H21.5A2.5 2.5 0 0 1 24 9.5v10a2.5 2.5 0 0 1-2.5 2.5h-16A2.5 2.5 0 0 1 3 19.5v-10A2.5 2.5 0 0 1 5.5 7h3.691l.585-1.17z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M13.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm0 1a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z" />
    </svg>
  ),
};

export interface ChartHeaderProps {
  symbol: string;
  resolution: string;
  timeframeMenuOpen: boolean;
  indicatorMenuOpen: boolean;
  indicatorSearch: string;
  activeStudies: StudyId[];
  maDescription: string;
  isFullscreen: boolean;
  connectionStatus: ConnStatus;
  canUndo?: boolean;
  canRedo?: boolean;
  isSymbolModalOpen?: boolean;
  initialSearchQuery?: string;
  onSymbolModalToggle?: (open: boolean) => void;
  onSymbolChange: (symbol: string) => void;
  onResolutionChange: (resolution: string) => void;
  onTimeframeMenuToggle: (open: boolean) => void;
  onIndicatorMenuToggle: (open: boolean) => void;
  onIndicatorSearchChange: (search: string) => void;
  onStudyToggle: (id: StudyId) => void;
  onDownloadSnapshot: () => void;
  onToggleFullscreen: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenSettings?: () => void;
}

export function ChartHeader({
  symbol,
  resolution,
  timeframeMenuOpen,
  indicatorMenuOpen,
  indicatorSearch,
  activeStudies,
  maDescription,
  isFullscreen,
  connectionStatus,
  canUndo = false,
  canRedo = false,
  isSymbolModalOpen: controlledSymbolModalOpen,
  initialSearchQuery = "",
  onSymbolModalToggle,
  onSymbolChange,
  onResolutionChange,
  onTimeframeMenuToggle,
  onIndicatorMenuToggle,
  onIndicatorSearchChange,
  onStudyToggle,
  onDownloadSnapshot,
  onToggleFullscreen,
  onUndo,
  onRedo,
  onOpenSettings,
}: ChartHeaderProps) {
  const [internalSymbolModalOpen, setInternalSymbolModalOpen] = useState(false);
  const isSymbolModalOpen =
    controlledSymbolModalOpen !== undefined
      ? controlledSymbolModalOpen
      : internalSymbolModalOpen;

  const setSymbolModalOpen = useCallback(
    (open: boolean) => {
      if (onSymbolModalToggle) {
        onSymbolModalToggle(open);
      } else {
        setInternalSymbolModalOpen(open);
      }
    },
    [onSymbolModalToggle]
  );

  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const indicatorDropdownRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!timeframeMenuOpen && !indicatorMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (timeframeMenuOpen && !timeframeDropdownRef.current?.contains(target))
        onTimeframeMenuToggle(false);
      if (indicatorMenuOpen && !indicatorDropdownRef.current?.contains(target))
        onIndicatorMenuToggle(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onTimeframeMenuToggle(false);
      onIndicatorMenuToggle(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [
    timeframeMenuOpen,
    indicatorMenuOpen,
    onTimeframeMenuToggle,
    onIndicatorMenuToggle,
  ]);

  const normalizedSearch = indicatorSearch.trim().toLocaleLowerCase("vi");
  const filteredStudies = STUDY_CATALOG.filter((study) =>
    `${study.label} ${study.description}`
      .toLocaleLowerCase("vi")
      .includes(normalizedSearch)
  );

  const currentResolutionLabel =
    RESOLUTIONS.find((item) => item.value === resolution)?.label ?? "1D";
  const statusLabel = connectionStatusLabel(connectionStatus);

  return (
    <>
      <header className="chart-header">
        <div className="chart-header__group chart-header__group--left">
          {/* Tìm kiếm mã chứng khoán modal trigger */}
          <button
            type="button"
            className="header-btn header-btn--symbol"
            aria-label="Tìm kiếm mã"
            data-tooltip="Tìm kiếm mã"
            onClick={() => {
              setSymbolModalOpen(true);
            }}
          >
            <span className="header-btn__icon">{HEADER_SVGS.search}</span>
            <span className="header-btn__symbol-text">{symbol}</span>
          </button>

          {/* Nút so sánh mã */}
          <button
            type="button"
            className="header-btn header-btn--icon"
            aria-label="So sánh hoặc Thêm mã"
            data-tooltip="So sánh hoặc Thêm mã"
            onClick={() => {
              const otherSymbol = symbol === "VN30" ? "VNINDEX" : "VN30";
              onSymbolChange(otherSymbol);
            }}
          >
            <span className="header-btn__icon">{HEADER_SVGS.compare}</span>
          </button>

          <span className="header-divider" />

          {/* Chọn khung thời gian */}
          <div
            ref={timeframeDropdownRef}
            className={`header-dropdown timeframe-dropdown ${timeframeMenuOpen ? "header-dropdown--open" : ""}`}
          >
            <button
              type="button"
              className="header-btn header-btn--text"
              aria-label="Khung thời gian"
              data-tooltip="Khung thời gian"
              aria-haspopup="menu"
              aria-expanded={timeframeMenuOpen}
              onClick={() => {
                onTimeframeMenuToggle(!timeframeMenuOpen);
              }}
            >
              <span className="header-btn__text">{currentResolutionLabel}</span>
            </button>
            {timeframeMenuOpen && (
              <div className="header-dropdown__panel timeframe-dropdown__panel" role="menu">
                {TIMEFRAME_GROUPS.map((group) => (
                  <div className="timeframe-dropdown__group" key={group.label}>
                    <div className="timeframe-dropdown__heading">{group.label}</div>
                    {group.options.map((option) => (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.value === resolution}
                        key={option.value}
                        className={
                          option.value === resolution
                            ? "header-dropdown__item header-dropdown__item--active"
                            : "header-dropdown__item"
                        }
                        onClick={() => onResolutionChange(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          <span className="header-divider" />

          {/* Kiểu biểu đồ (Nến) */}
          <button
            type="button"
            className="header-btn header-btn--icon"
            aria-label="Kiểu biểu đồ (Nến)"
            data-tooltip="Kiểu biểu đồ"
          >
            <span className="header-btn__icon">{HEADER_SVGS.candles}</span>
          </button>

          <span className="header-divider" />

          {/* Nút Các chỉ báo */}
          <details
            ref={indicatorDropdownRef}
            className="header-dropdown indicators-dropdown"
            open={indicatorMenuOpen}
            onToggle={(event) => {
              onIndicatorMenuToggle(event.currentTarget.open);
            }}
          >
            <summary
              className="header-btn header-btn--with-icon"
              aria-label="Các chỉ báo"
              data-tooltip="Các chỉ báo"
            >
              <span className="header-btn__icon">{HEADER_SVGS.indicators}</span>
              <span className="header-btn__text">Các chỉ báo</span>
            </summary>
            <div className="header-dropdown__panel indicator-menu__panel" data-selection-boundary>
              <div className="indicator-menu__title">
                <strong>Các chỉ báo</strong>
                <button
                  type="button"
                  aria-label="Đóng danh sách chỉ báo"
                  onClick={() => onIndicatorMenuToggle(false)}
                >
                  ×
                </button>
              </div>
              <label className="indicator-menu__search">
                <span className="indicator-search-icon">{HEADER_SVGS.inputSearch}</span>
                <input
                  data-clear-selection-on-outside-drag
                  value={indicatorSearch}
                  onChange={(event) => onIndicatorSearchChange(event.target.value)}
                  placeholder="Tìm kiếm"
                  autoFocus
                />
              </label>
              <div className="indicator-menu__heading">Tên chỉ báo</div>
              <div className="indicator-menu__list">
                {filteredStudies.map((study) => (
                  <label
                    key={study.id}
                    className={
                      activeStudies.includes(study.id)
                        ? "indicator-menu__option indicator-menu__option--active"
                        : "indicator-menu__option"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={activeStudies.includes(study.id)}
                      onChange={() => onStudyToggle(study.id)}
                    />
                    <i style={{ background: study.color }} />
                    <span>
                      <b>{study.label}</b>
                      <small>
                        {study.id === "volume" ? maDescription : study.description}
                      </small>
                    </span>
                  </label>
                ))}
                {filteredStudies.length === 0 && (
                  <div className="indicator-menu__empty">Không tìm thấy chỉ báo</div>
                )}
              </div>
            </div>
          </details>

          <span className="header-divider" />

          {/* Nút Hoàn tác & Làm lại */}
          <button
            type="button"
            className="header-btn header-btn--icon"
            aria-label="Hoàn tác"
            data-tooltip="Hoàn tác (Ctrl+Z)"
            disabled={!canUndo}
            onClick={() => {
              onUndo?.();
            }}
          >
            <span className="header-btn__icon">{HEADER_SVGS.undo}</span>
          </button>

          <button
            type="button"
            className="header-btn header-btn--icon"
            aria-label="Làm lại"
            data-tooltip="Làm lại (Ctrl+Y)"
            disabled={!canRedo}
            onClick={() => {
              onRedo?.();
            }}
          >
            <span className="header-btn__icon">{HEADER_SVGS.redo}</span>
          </button>
        </div>

        <div className="chart-header__group chart-header__group--right">
          <span className="header-divider" />

          <span
            className={`connection-status connection-status--${connectionStatus}`}
            role="status"
            aria-live="polite"
            title={statusLabel}
          >
            <span className="connection-status__dot" aria-hidden="true" />
            <span className="connection-status__label">{statusLabel}</span>
          </span>

          {/* Nút Cài đặt */}
          <button
            type="button"
            className="header-btn header-btn--icon"
            aria-label="Cài đặt biểu đồ"
            data-tooltip="Cài đặt biểu đồ"
            onClick={() => {
              onOpenSettings?.();
            }}
          >
            <span className="header-btn__icon">{HEADER_SVGS.settings}</span>
          </button>

          {/* Nút Toàn màn hình */}
          <button
            type="button"
            className={
              isFullscreen
                ? "header-btn header-btn--icon header-btn--active"
                : "header-btn header-btn--icon"
            }
            aria-label={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
            data-tooltip={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
            onClick={() => {
              onToggleFullscreen();
            }}
          >
            <span className="header-btn__icon">
              {isFullscreen ? HEADER_SVGS.fullscreenExit : HEADER_SVGS.fullscreen}
            </span>
          </button>

          {/* Nút Chụp ảnh màn hình */}
          <button
            type="button"
            className="header-btn header-btn--icon"
            aria-label="Chụp ảnh tức thì"
            data-tooltip="Chụp ảnh tức thì"
            onClick={() => {
              onDownloadSnapshot();
            }}
          >
            <span className="header-btn__icon">{HEADER_SVGS.camera}</span>
          </button>
        </div>
      </header>

      {/* Modal tìm kiếm mã giao dịch VNDIRECT */}
      <SymbolSearchModal
        isOpen={isSymbolModalOpen}
        onClose={() => setSymbolModalOpen(false)}
        onSelectSymbol={onSymbolChange}
        currentSymbol={symbol}
        initialQuery={initialSearchQuery}
      />
    </>
  );
}
