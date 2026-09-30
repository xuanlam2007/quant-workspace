"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { Bar, SymbolInfo } from "@/lib/dchart-api";
import { RESOLUTIONS, type MaType } from "../config/chart-config";
import { formatVolume } from "../core/chart-utils";
import type { ChartAppearance } from "./ChartSettingsDialog";
import { HEADER_SVGS } from "./ChartHeader";
import { VolumeSettingsDialog, type VolumeSettings } from "./VolumeSettingsDialog";

const legendIcons = {
  eye: <svg viewBox="0 0 24 22" width="24" height="22" fill="none" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d="M17.9948 7.91366C16.6965 6.48549 14.6975 5 11.9999 5C9.30225 5 7.30322 6.48549 6.00488 7.91366C6.00488 7.91366 4 10 4 11C4 12 6.00488 14.0863 6.00488 14.0863C7.30322 15.5145 9.30225 17 11.9999 17C14.6975 17 16.6965 15.5145 17.9948 14.0863C17.9948 14.0863 20 12 20 11C20 10 17.9948 7.91366 17.9948 7.91366ZM6.74482 13.4137C7.94648 14.7355 9.69746 16 11.9999 16C14.3022 16 16.0532 14.7355 17.2549 13.4137C17.2549 13.4137 19 11.5 19 11C19 10.5 17.2549 8.58634 17.2549 8.58634C16.0532 7.26451 14.3022 6 11.9999 6C9.69746 6 7.94648 7.26451 6.74482 8.58634C6.74482 8.58634 5 10.5 5 11C5 11.5 6.74482 13.4137 6.74482 13.4137Z"/><path fill="currentColor" fillRule="evenodd" d="M12 13C13.1046 13 14 12.1046 14 11C14 9.89543 13.1046 9 12 9C10.8954 9 10 9.89543 10 11C10 12.1046 10.8954 13 12 13ZM12 14C13.6569 14 15 12.6569 15 11C15 9.34315 13.6569 8 12 8C10.3431 8 9 9.34315 9 11C9 12.6569 10.3431 14 12 14Z"/></svg>,
  crossedEye: <svg viewBox="0 0 24 22" width="24" height="22" fill="none" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d="M8.8503 16.2712C9.76531 16.7135 10.8152 17 11.9999 17C14.6975 17 16.6965 15.5145 17.9948 14.0863C17.9948 14.0863 20 12 20 11C20 10 17.9948 7.91366 17.9948 7.91366C17.8729 7.77954 17.7448 7.64491 17.6105 7.51105L16.9035 8.2181C17.0254 8.33968 17.1425 8.46276 17.2549 8.58634C17.2549 8.58634 19 10.5 19 11C19 11.5 17.2549 13.4137 17.2549 13.4137C16.0532 14.7355 14.3022 16 11.9999 16C11.1218 16 10.324 15.8161 9.60627 15.5153L8.8503 16.2712ZM7.09663 13.7823C6.97455 13.6606 6.85728 13.5374 6.74482 13.4137C6.74482 13.4137 5 11.5 5 11C5 10.5 6.74482 8.58634 6.74482 8.58634C7.94648 7.26451 9.69746 6 11.9999 6C12.8781 6 13.6761 6.18398 14.394 6.48495L15.1499 5.729C14.2348 5.28657 13.1847 5 11.9999 5C9.30225 5 7.30322 6.48549 6.00488 7.91366C6.00488 7.91366 4 10 4 11C4 12 6.00488 14.0863 6.00488 14.0863C6.12693 14.2206 6.25516 14.3553 6.38959 14.4893L7.09663 13.7823Z"/><path fill="currentColor" fillRule="evenodd" d="M11.2231 13.8984C11.4709 13.9647 11.7313 14 12 14C13.6569 14 15 12.6569 15 11C15 10.7313 14.9647 10.4709 14.8984 10.2231L13.9961 11.1254C13.934 12.1301 13.1301 12.934 12.1254 12.9961L11.2231 13.8984ZM11.8751 9.00384C10.87 9.06578 10.0658 9.87001 10.0038 10.8751L9.10166 11.7772C9.03535 11.5294 9 11.2688 9 11C9 9.34315 10.3431 8 12 8C12.2688 8 12.5294 8.03535 12.7772 8.10166L11.8751 9.00384Z"/><path fill="currentColor" fillRule="evenodd" d="M5.64648 16.6465L17.6465 4.64648L18.3536 5.35359L6.35359 17.3536L5.64648 16.6465Z"/></svg>,
  more: <svg viewBox="0 0 16 4" width="16" height="4" fill="none" aria-hidden="true"><circle stroke="currentColor" cx="2" cy="2" r="1.5"/><circle stroke="currentColor" cx="8" cy="2" r="1.5"/><circle stroke="currentColor" cx="14" cy="2" r="1.5"/></svg>,
  remove: <svg viewBox="0 0 24 22" width="24" height="22" fill="none" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d="M17.35 6.35l-10 10-.7-.7 10-10 .7.7z"/><path fill="currentColor" fillRule="evenodd" d="M6.65 6.35l10 10 .7-.7-10-10-.7.7z"/></svg>,
  closed: <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><rect width="10" height="4" fill="currentColor" rx="2" x="4" y="7"/></svg>,
  open: <svg viewBox="0 0 18 18" width="18" height="18" fill="none" aria-hidden="true"><circle fill="currentColor" cx="9" cy="9" r="5"/></svg>,
};

const menuIcons = {
  info: <svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true"><g transform="translate(4 5)"><circle stroke="currentColor" cx="9.5" cy="9.5" r="9"/><path stroke="currentColor" d="M7 14.5h2.5v-5H7"/><path stroke="currentColor" strokeLinecap="square" d="M9.5 14.5h2"/><path fill="currentColor" d="M9.5 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></g></svg>,
  order: <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M13.39 3.84a1 1 0 0 1 1.22 0l8.19 6.37a1 1 0 0 1 0 1.58l-8.19 6.37a1 1 0 0 1-1.22 0L5.2 11.79a1 1 0 0 1 0-1.58l8.19-6.37zm.61.8L5.81 11 14 17.37 22.19 11 14 4.63zM5.3 13.6l8.7 6.76 8.7-6.76.6.78-8.69 6.77a1 1 0 0 1-1.22 0l-8.7-6.77.62-.78zm8.09 10.55l-8.7-6.77.62-.78L14 23.37l8.7-6.76.6.78-8.69 6.77a1 1 0 0 1-1.22 0z"/></svg>,
  pane: <svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true"><path stroke="currentColor" strokeLinecap="square" d="M6.145 11.968L14 5.5l7.855 6.468a.3.3 0 0 1-.191.532H6.336a.3.3 0 0 1-.19-.532zm0 4.064L14 22.5l7.855-6.468a.3.3 0 0 0-.191-.532H6.336a.3.3 0 0 0-.19.532z"/></svg>,
  scale: <svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true"><g transform="translate(4 5)"><path fill="currentColor" d="M3 1h1v13.5H3z"/><circle stroke="currentColor" cx="3.5" cy="16.5" r="2"/><path fill="currentColor" d="M5.5 16H18v1H5.5z"/><path stroke="currentColor" d="M0 4L3.5.5 7 4m8 9l3.5 3.5L15 20"/></g></svg>,
  hide: <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M18.15 7.02A9.05 9.05 0 0014 6c-3.45 0-6.08 2-7.8 3.92a18.18 18.18 0 00-2.64 3.84v.02h-.01L4 14l-.45-.21-.1.21.1.21L4 14l-.45.21.01.03a5.85 5.85 0 00.16.32c.11.2.28.51.5.87a18.18 18.18 0 002.4 3.12l.71-.71A17.18 17.18 0 014.56 14a10.05 10.05 0 01.52-.91c.41-.69 1.04-1.6 1.85-2.5C8.58 8.75 10.95 7 14 7a8 8 0 013.4.77l.75-.75zm-3.11 3.12a4 4 0 00-4.9 4.9l.86-.87V14a3 3 0 013.17-3l.87-.86zm1.96 3.7l.86-.88a4 4 0 01-4.9 4.9l.87-.86A3 3 0 0017 13.83zm-6.4 6.4A8 8 0 0014 21c3.05 0 5.42-1.76 7.07-3.58A17.18 17.18 0 0023.44 14a9.47 9.47 0 00-.52-.91 17.18 17.18 0 00-2.25-2.93l.7-.7a18.18 18.18 0 013.06 4.3l.02.02L24 14l.45.21-.01.03a7.03 7.03 0 01-.16.32c-.11.2-.28.51-.5.87-.44.72-1.1 1.69-1.97 2.65C20.08 20.01 17.45 22 14 22c-1.55 0-2.94-.4-4.15-1.02l.75-.75zM24 14l.45-.21.1.21-.1.21L24 14zM22.2 6.5L6.5 22.2l-.7-.7L21.5 5.8l.7.7z"/></svg>,
  show: <svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true"><g stroke="currentColor" transform="translate(3 6)"><path d="M.964 8C3 4 6.679.5 11 .5 15.32.5 19 4 21.036 8 19 12 15.32 15.5 11 15.5 6.679 15.5 3 12 .964 8z"/><circle cx="11" cy="8" r="3.5"/></g></svg>,
  settings: <svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true"><g stroke="currentColor" transform="translate(4 4)"><path d="M.5 10.992c0 .287.226.508.505.508H2.65c.19.93.55 1.82 1.09 2.63L2.577 15.3a.5.5 0 0 0-.007.71l1.42 1.42a.5.5 0 0 0 .71-.007l1.17-1.163c.81.54 1.71.9 2.63 1.09v1.645c0 .284.227.505.508.505h1.984c.28 0 .508-.221.508-.505V17.35a7.46 7.46 0 0 0 2.63-1.09l1.17 1.163a.5.5 0 0 0 .71.007l1.42-1.42a.5.5 0 0 0-.007-.71l-1.163-1.17c.54-.81.9-1.7 1.09-2.63h1.645a.502.502 0 0 0 .505-.508V9.008a.503.503 0 0 0-.505-.508H17.35c-.19-.93-.55-1.82-1.09-2.63l1.163-1.17a.5.5 0 0 0 .007-.71l-1.42-1.42a.5.5 0 0 0-.71.007L14.13 3.74a7.46 7.46 0 0 0-2.63-1.09V1.005A.504.504 0 0 0 10.992.5H9.008a.504.504 0 0 0-.508.505V2.65c-.92.19-1.82.55-2.63 1.09L4.7 2.577a.5.5 0 0 0-.71-.007L2.57 3.99a.5.5 0 0 0 .007.71L3.74 5.87c-.54.81-.9 1.7-1.09 2.63H1.005a.503.503 0 0 0-.505.508v1.984z"/><circle cx="10" cy="10" r="2.5"/></g></svg>,
  chevron: <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><path fill="currentColor" d="M.6 1.4 2 0l8 8-8 8-1.4-1.4 6.389-6.532L.6 1.4Z"/></svg>,
};

export interface SourceLegend {
  id: string;
  label: string;
  color: string;
  value?: string;
  top: number;
  paneIndex: number;
  shared: boolean;
  visible: boolean;
  scaleSide: "left" | "right";
}
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
  sourceLegends: SourceLegend[];
  volumeRowTop: number;
  onMoveSourceToPane: (id: string, direction: "above" | "below") => void;
  onMoveSourceOrder: (id: string, direction: "front" | "back") => void;
  onToggleSourceVisibility: (id: string) => void;
  onRemoveSource: (id: string) => void;
  onPinSourceToScale: (id: string, side: "left" | "right") => void;
  seriesVisible: boolean;
  scaleSide: "left" | "right";
  leftAxisWidth: number;
  rightAxisWidth: number;
  paneTop: number;
  loading: boolean;
  volumeEnabled: boolean;
  volumeHidden: boolean;
  volumeScaleSide: "left" | "right";
  mainPaneIndex: number;
  mainPaneShared: boolean;
  volumePaneShared: boolean;
  volumePaneIndex: number;
  paneCount: number;
  currentVolumeMa?: number;
  maLength: number;
  maType: MaType;
  smoothingLength: number;
  volumeSettings: VolumeSettings;
  selectedLegend: string | null;
  onSelectLegend: (legend: string) => void;
  seriesValueVisible: boolean;
  priceLineVisible: boolean;
  appearance: ChartAppearance;
  onOpenChartSettings: () => void;
  onToggleSeriesVisibility: () => void;
  onCopyPrice: (price: number) => void;
  onPastePrice: () => void;
  onMoveToPane: (direction: "above" | "below") => void;
  canMoveToPane: boolean;
  onMoveSeriesOrder: (direction: "front" | "back") => void;
  onPinToScale: (side: "left" | "right") => void;
  onToggleSeriesValue: () => void;
  onTogglePriceLine: () => void;
  onRemoveVolume: () => void;
  onToggleVolumeVisibility: () => void;
  onMoveVolumeToPane: (direction: "above" | "below") => void;
  onMoveVolumeSeriesOrder: (direction: "front" | "back") => void;
  onPinVolumeToScale: (side: "left" | "right") => void;
  onMaLengthChange: (length: number) => void;
  onMaTypeChange: (type: MaType) => void;
  onSmoothingLengthChange: (length: number) => void;
  onVolumeSettingsApply: (settings: VolumeSettings) => void;
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
  sourceLegends,
  volumeRowTop,
  onMoveSourceToPane,
  onMoveSourceOrder,
  onToggleSourceVisibility,
  onRemoveSource,
  onPinSourceToScale,
  seriesVisible,
  scaleSide,
  leftAxisWidth,
  rightAxisWidth,
  paneTop,
  loading,
  volumeEnabled,
  volumeHidden,
  volumeScaleSide,
  mainPaneIndex,
  mainPaneShared,
  volumePaneShared,
  volumePaneIndex,
  paneCount,
  currentVolumeMa,
  maLength,
  maType,
  smoothingLength,
  volumeSettings,
  selectedLegend,
  onSelectLegend,
  seriesValueVisible,
  priceLineVisible,
  appearance,
  onOpenChartSettings,
  onToggleSeriesVisibility,
  onCopyPrice,
  onPastePrice,
  onMoveToPane,
  canMoveToPane,
  onMoveSeriesOrder,
  onPinToScale,
  onToggleSeriesValue,
  onTogglePriceLine,
  onRemoveVolume,
  onToggleVolumeVisibility,
  onMoveVolumeToPane,
  onMoveVolumeSeriesOrder,
  onPinVolumeToScale,
  onMaLengthChange,
  onMaTypeChange,
  onSmoothingLengthChange,
  onVolumeSettingsApply,
}: MarketDataPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [submenu, setSubmenu] = useState<MenuSubmenu>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [volumeSettingsOpen, setVolumeSettingsOpen] = useState(false);
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);
  const [sourceMenuId, setSourceMenuId] = useState<string | null>(null);
  const [sourceMenuPosition, setSourceMenuPosition] = useState({ left: 0, top: 0 });
  const [volumeMenuPosition, setVolumeMenuPosition] = useState({ left: 0, top: 0 });
  const [now, setNow] = useState(() => Date.now());
  const [sessionOpen, setSessionOpen] = useState(false);
  const [visibilityTooltip, setVisibilityTooltip] = useState<{ text: string; left: number; top: number } | null>(null);
  const sessionRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const volumeMenuRef = useRef<HTMLDivElement>(null);
  const sourceMenuRef = useRef<HTMLDivElement>(null);
  const price = quoteBar?.close;
  const change = quoteBar && previousClose !== undefined ? quoteBar.close - previousClose : 0;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;
  const quoteClass = change >= 0 ? "quote--up" : "quote--down";
  const formatPrice = (value?: number) => value?.toFixed(pricePrecision) ?? "N/A";
  const instrumentTitle = symbolInfo?.description || symbol;
  const timezone = symbolInfo?.timezone || "Asia/Bangkok";
  const session = symbolInfo?.session || "0900-1500";
  const sessionRanges = session === "24x7" ? [{ start: 0, end: 1440 }] : session.split(":")[0].split(",").flatMap((value) => {
    const match = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(value.trim());
    if (!match) return [];
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    return end > start ? [{ start, end }] : [{ start: 0, end }, { start, end: 1440 }];
  }).sort((a, b) => a.start - b.start);
  const sessionStart = sessionRanges[0]?.start ?? 540;
  const sessionEnd = sessionRanges.at(-1)?.end ?? 900;
  const sessionDays = session === "24x7" ? "1234567" : session.split(":")[1] || "23456";
  const localParts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(now));
  const localDay = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(localParts.find((part) => part.type === "weekday")?.value ?? "Mon");
  const localMinutes = Number(localParts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(localParts.find((part) => part.type === "minute")?.value ?? 0);
  const localSeconds = localMinutes * 60 + Number(localParts.find((part) => part.type === "second")?.value ?? 0);
  const activeRanges = sessionDays.includes(String(localDay + 1)) ? sessionRanges : [];
  const openRange = activeRanges.find(({ start, end }) => localSeconds >= start * 60 && localSeconds < end * 60);
  const marketOpen = Boolean(openRange);
  let remainingSeconds = openRange ? openRange.end * 60 - localSeconds : Infinity;
  if (!openRange) for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    if (!sessionDays.includes(String((localDay + dayOffset) % 7 + 1))) continue;
    for (const { start } of sessionRanges) {
      const remaining = (dayOffset * 1440 + start) * 60 - localSeconds;
      if (remaining > 0) remainingSeconds = Math.min(remainingSeconds, remaining);
    }
  }
  const remainingMinutes = Number.isFinite(remainingSeconds) ? Math.floor(remainingSeconds / 60) : 0;
  const remainingDays = Math.floor(remainingMinutes / 1440);
  const remainingHours = Math.floor(remainingMinutes % 1440 / 60);
  const nextOpenText = remainingDays > 0 ? `${remainingDays} ngày và ${remainingHours} giờ`
    : remainingHours > 0 ? `${remainingHours} giờ và ${remainingMinutes % 60} phút`
      : remainingMinutes > 0 ? `${remainingMinutes} phút` : "ít hơn một phút";
  const sessionSegments: { start: number; end: number; open: boolean }[] = [];
  let sessionCursor = 0;
  for (const range of activeRanges) {
    if (range.start > sessionCursor) sessionSegments.push({ start: sessionCursor, end: range.start, open: false });
    sessionSegments.push({ ...range, open: true });
    sessionCursor = range.end;
  }
  if (sessionCursor < 1440) sessionSegments.push({ start: sessionCursor, end: 1440, open: false });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!sessionOpen) return;
    const close = (event: PointerEvent) => { if (!sessionRef.current?.contains(event.target as Node)) setSessionOpen(false); };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [sessionOpen]);

  useEffect(() => {
    if (!seriesVisible) setSessionOpen(false);
  }, [seriesVisible]);

  useEffect(() => {
    if (!menuOpen && !volumeMenuOpen && !sourceMenuId && !infoOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuOpen && !menuRef.current?.contains(event.target)) setMenuOpen(false);
      if (volumeMenuOpen && !volumeMenuRef.current?.contains(event.target)) setVolumeMenuOpen(false);
      if (sourceMenuId && !sourceMenuRef.current?.contains(event.target)) setSourceMenuId(null);
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setVolumeMenuOpen(false);
        setSourceMenuId(null);
        setSubmenu(null);
        setInfoOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnPointer, true);
    document.addEventListener("keydown", closeOnKey, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer, true);
      document.removeEventListener("keydown", closeOnKey, true);
    };
  }, [infoOpen, menuOpen, volumeMenuOpen, sourceMenuId]);

  const openMenuAt = (x: number, y: number) => {
    setMenuPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - 378)),
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
    setVolumeMenuOpen(false);
    setSourceMenuId(null);
    setSubmenu(null);
  };

  const renderMenuButton = (label: string, action: () => void, disabled = false, icon?: keyof typeof menuIcons, shortcut?: string) => (
    <button type="button" tabIndex={-1} role="menuitem" className="series-menu__item" disabled={disabled} onClick={() => runMenuAction(action)}>
      <span className="series-menu__icon">{icon ? menuIcons[icon] : null}</span>
      <span className="series-menu__label">{label}</span>
      {shortcut && <span className="series-menu__shortcut">{shortcut}</span>}
    </button>
  );

  const showVisibilityTooltip = (event: MouseEvent<HTMLButtonElement>, text: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setVisibilityTooltip({ text, left: rect.left + rect.width / 2, top: rect.top - 5 });
  };

  const activeSource = sourceLegends.find((source) => source.id === sourceMenuId);

  return (
    <div className="market-data-panel" style={{ left: leftAxisWidth + 4, right: rightAxisWidth + 4, top: paneTop + 4 }}>
      <div
        className="market-data-row"
        onContextMenu={(event) => {
          event.preventDefault();
          openMenuAt(event.clientX, event.clientY);
        }}
      >
        {appearance.titleVisible && <div className={`market-data__title${selectedLegend === "instrument" ? " market-data__title--selected" : ""}${!seriesVisible ? " market-data__title--hidden" : ""}`} onClick={(event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).closest("span")) onSelectLegend("instrument"); }}>
          <span className="market-data__instrument">{instrumentTitle}</span>
          <span className="market-data__separator">·</span>
          <span>{RESOLUTIONS.find((item) => item.value === resolution)?.label ?? resolution}</span>
          <span className="market-data__separator">·</span>
          <span>{exchange || "N/A"}</span>
          <div className="market-data__actions">
            <button type="button" tabIndex={-1} aria-label={seriesVisible ? "Ẩn" : "Hiển thị"} aria-pressed={seriesVisible} onMouseEnter={(event) => showVisibilityTooltip(event, seriesVisible ? "Ẩn" : "Hiển thị")} onMouseLeave={() => setVisibilityTooltip(null)} onClick={() => { setVisibilityTooltip(null); onToggleSeriesVisibility(); }}>
              {seriesVisible ? legendIcons.eye : legendIcons.crossedEye}
            </button>
            <button type="button" tabIndex={-1} aria-label="Thêm nữa" onClick={(event) => openMenu(event.currentTarget)}>{legendIcons.more}</button>
          </div>
        </div>}
        {seriesVisible && <div className={`market-data__session market-data__session--${marketOpen ? "open" : "closed"}${sessionOpen ? " market-data__session--active" : ""}`} ref={sessionRef}>
          <button type="button" tabIndex={-1} aria-label={marketOpen ? "Thị trường Mở" : "Thị trường đóng cửa"} aria-expanded={sessionOpen} onClick={() => setSessionOpen((open) => !open)}>{marketOpen ? legendIcons.open : legendIcons.closed}</button>
          {sessionOpen && <div className="market-data__session-popover" role="dialog" aria-label="Trạng thái thị trường">
            <div className="market-data__session-heading">{marketOpen ? legendIcons.open : legendIcons.closed}<strong>{marketOpen ? "Thị trường Mở" : "Thị trường đóng cửa"}</strong></div>
            <p>{marketOpen ? <>Tất cả đều tốt - Thị trường mở cửa. <strong>Thị trường đóng trong {nextOpenText}.</strong></> : <>Đã đến lúc đi dạo một vòng - thị trường này đã đóng cửa. <strong>Thị trường mở trong {nextOpenText}.</strong></>}</p>
            <div className="market-data__session-timeline">
              <span className="market-data__session-weekday">{localDay === 0 ? "CHỦ" : "THỨ"}<br/>{localDay === 0 ? "NHẬT" : localDay + 1}</span>
              <div className="market-data__session-rail">
                <div className="market-data__session-track">
                  {sessionSegments.map((segment) => <i key={segment.start} className={segment.open ? "is-open" : ""} style={{ left: `${segment.start / 1440 * 100}%`, width: `${(segment.end - segment.start) / 1440 * 100}%` }}><span/></i>)}
                  <b style={{ left: `${localMinutes / 1440 * 100}%` }}/>
                </div>
                <div className="market-data__session-hours"><span style={{ left: `${sessionStart / 1440 * 100}%` }}>{String(Math.floor(sessionStart / 60)).padStart(2, "0")}:{String(sessionStart % 60).padStart(2, "0")}</span><span style={{ left: `${sessionEnd / 1440 * 100}%` }}>{String(Math.floor(sessionEnd / 60)).padStart(2, "0")}:{String(sessionEnd % 60).padStart(2, "0")}</span></div>
              </div>
            </div>
            <small>Múi giờ giao dịch: {timezone === "Asia/Bangkok" ? "Bangkok (UTC+7)" : timezone}</small>
          </div>}
        </div>}
        {seriesVisible && (loading ? <span className="market-data__loader" role="status" aria-label="Đang tải dữ liệu biểu đồ"><i/><i/><i/></span> : <div className="ohlcv-strip" aria-label="Giá mở cửa, cao nhất, thấp nhất, đóng cửa và khối lượng">
          {appearance.ohlcVisible && <>
          <span>O <b className={quoteClass}>{formatPrice(quoteBar?.open)}</b></span>
          <span>H <b className={quoteClass}>{formatPrice(quoteBar?.high)}</b></span>
          <span>L <b className={quoteClass}>{formatPrice(quoteBar?.low)}</b></span>
          <span>C <b className={quoteClass}>{formatPrice(quoteBar?.close)}</b></span>
          </>}
          {appearance.changeVisible && previousClose !== undefined && <span className={quoteClass}>{change >= 0 ? "+" : ""}{change.toFixed(pricePrecision)} ({changePercent.toFixed(2)}%)</span>}
          {appearance.volumeVisible && <span className="ohlcv-strip__volume">Khối lượng <b>{quoteBar ? formatVolume(quoteBar.volume) : "N/A"}</b></span>}
        </div>)}
      </div>

      {sourceLegends.map((source) => (
        <div className={`indicator-data-row source-legend-row${!source.visible ? " indicator-data-row--hidden" : ""}`} key={source.id} style={{ position: "absolute", top: source.top - paneTop }} onContextMenu={(event) => { event.preventDefault(); setSourceMenuId(source.id); setSourceMenuPosition({ left: Math.min(event.clientX, window.innerWidth - 456), top: Math.min(event.clientY, window.innerHeight - 460) }); }}>
          <div className={`indicator-data__title${selectedLegend === source.id ? " indicator-data__title--selected" : ""}${!source.visible ? " indicator-data__title--hidden" : ""}`} onClick={() => onSelectLegend(source.id)}>
            <span className="indicator-data__name">{source.label}</span>
            <div className="indicator-data__actions">
              <button type="button" tabIndex={-1} aria-label={source.visible ? "Ẩn" : "Hiển thị"} onMouseEnter={(event) => showVisibilityTooltip(event, source.visible ? "Ẩn" : "Hiển thị")} onMouseLeave={() => setVisibilityTooltip(null)} onClick={() => { setVisibilityTooltip(null); onToggleSourceVisibility(source.id); }}>{source.visible ? legendIcons.eye : legendIcons.crossedEye}</button>
              <button type="button" tabIndex={-1} aria-label="Loại bỏ" onClick={() => onRemoveSource(source.id)}>{legendIcons.remove}</button>
              <button type="button" tabIndex={-1} aria-label="Thêm nữa" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setSubmenu(null); setSourceMenuId(source.id); setSourceMenuPosition({ left: Math.min(rect.left, window.innerWidth - 456), top: Math.min(rect.bottom + 5, window.innerHeight - 460) }); }}>{legendIcons.more}</button>
            </div>
          </div>
          {source.value && <span className="source-legend-value" style={{ color: source.color }}>{source.value}</span>}
        </div>
      ))}

      {volumeEnabled && <div className={`indicator-data-row${volumeHidden ? " indicator-data-row--hidden" : ""}`} style={{ position: "absolute", top: volumeRowTop - paneTop }}>
        {appearance.studyTitleVisible && <div className={`indicator-data__title${selectedLegend === "volume" ? " indicator-data__title--selected" : ""}${volumeHidden ? " indicator-data__title--hidden" : ""}`} onClick={(event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).closest("span")) onSelectLegend("volume"); }}><span className="indicator-data__name">Khối lượng {maType} {smoothingLength}</span><div className="indicator-data__actions">
          <button type="button" tabIndex={-1} aria-label={volumeHidden ? "Hiển thị" : "Ẩn"} aria-pressed={!volumeHidden} onMouseEnter={(event) => showVisibilityTooltip(event, volumeHidden ? "Hiển thị" : "Ẩn")} onMouseLeave={() => setVisibilityTooltip(null)} onClick={() => { setVisibilityTooltip(null); onToggleVolumeVisibility(); }}>{volumeHidden ? legendIcons.crossedEye : legendIcons.eye}</button>
          <button type="button" tabIndex={-1} aria-label="Cài đặt" aria-pressed={volumeSettingsOpen} onClick={() => setVolumeSettingsOpen((open) => !open)}>{HEADER_SVGS.settings}</button>
          <button type="button" tabIndex={-1} aria-label="Loại bỏ" onClick={onRemoveVolume}>{legendIcons.remove}</button>
          <button type="button" tabIndex={-1} aria-label="Thêm nữa" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setVolumeMenuPosition({ left: Math.min(rect.left, window.innerWidth - 456), top: Math.min(rect.bottom + 5, window.innerHeight - 460) }); setVolumeMenuOpen(true); }}>{legendIcons.more}</button>
        </div></div>}
        {!loading && appearance.studyValueVisible && volumeSettings.statusValueVisible && <div className="indicator-data__values"><span className="indicator-data__volume">{quoteBar ? formatVolume(quoteBar.volume) : "N/A"}</span>{volumeSettings.smoothedVisible && <span className="indicator-data__ma">{currentVolumeMa !== undefined ? formatVolume(currentVolumeMa) : "N/A"}</span>}</div>}
      </div>}

      {activeSource && createPortal(<div ref={sourceMenuRef} className="series-menu source-series-menu" role="menu" aria-label={`Tùy chọn ${activeSource.label}`} style={{ left: sourceMenuPosition.left, top: sourceMenuPosition.top }}>
        <div className="series-menu__submenu-wrap" onMouseEnter={() => setSubmenu("order")} onMouseLeave={() => setSubmenu(null)}>
          <button type="button" role="menuitem" tabIndex={-1} className="series-menu__item" aria-haspopup="menu" aria-expanded={submenu === "order"} onClick={() => setSubmenu(submenu === "order" ? null : "order")}><span className="series-menu__icon">{menuIcons.order}</span><span className="series-menu__label">Thứ tự Trực quan</span><span className="series-menu__chevron">{menuIcons.chevron}</span></button>
          {submenu === "order" && <div className="series-menu__submenu" role="menu" aria-label="Thứ tự Trực quan">{renderMenuButton("Đưa lên trước", () => onMoveSourceOrder(activeSource.id, "front"))}{renderMenuButton("Đưa xuống sau", () => onMoveSourceOrder(activeSource.id, "back"))}</div>}
        </div>
        {(activeSource.shared || activeSource.paneIndex > 0 || activeSource.paneIndex < paneCount - 1) && <div className="series-menu__submenu-wrap" onMouseEnter={() => setSubmenu("pane")} onMouseLeave={() => setSubmenu(null)}>
          <button type="button" role="menuitem" tabIndex={-1} className="series-menu__item" aria-haspopup="menu" aria-expanded={submenu === "pane"} onClick={() => setSubmenu(submenu === "pane" ? null : "pane")}><span className="series-menu__icon">{menuIcons.pane}</span><span className="series-menu__label">Chuyển tới</span><span className="series-menu__chevron">{menuIcons.chevron}</span></button>
          {submenu === "pane" && <div className="series-menu__submenu" role="menu" aria-label="Chuyển tới">{(activeSource.shared || activeSource.paneIndex > 0) && renderMenuButton(activeSource.shared ? "Cửa sổ mới bên trên" : "Cửa sổ hiện có bên trên", () => onMoveSourceToPane(activeSource.id, "above"))}{(activeSource.shared || activeSource.paneIndex < paneCount - 1) && renderMenuButton(activeSource.shared ? "Cửa sổ mới bên dưới" : "Cửa sổ hiện có bên dưới", () => onMoveSourceToPane(activeSource.id, "below"))}</div>}
        </div>}
        <div className="series-menu__submenu-wrap" onMouseEnter={() => setSubmenu("scale")} onMouseLeave={() => setSubmenu(null)}>
          <button type="button" role="menuitem" tabIndex={-1} className="series-menu__item" aria-haspopup="menu" aria-expanded={submenu === "scale"} onClick={() => setSubmenu(submenu === "scale" ? null : "scale")}><span className="series-menu__icon">{menuIcons.scale}</span><span className="series-menu__label">Ghim theo Tỷ lệ (hiện tại bên {activeSource.scaleSide === "right" ? "phải" : "trái"})</span><span className="series-menu__chevron">{menuIcons.chevron}</span></button>
          {submenu === "scale" && <div className="series-menu__submenu" role="menu" aria-label="Ghim theo Tỷ lệ">{renderMenuButton("Bên trái", () => onPinSourceToScale(activeSource.id, "left"))}{renderMenuButton("Bên phải", () => onPinSourceToScale(activeSource.id, "right"))}</div>}
        </div>
        <div className="series-menu__divider" />
        {renderMenuButton(activeSource.visible ? "Ẩn" : "Hiện", () => onToggleSourceVisibility(activeSource.id), false, activeSource.visible ? "hide" : "show")}
        {renderMenuButton("Loại bỏ", () => onRemoveSource(activeSource.id))}
      </div>, document.body)}
      {volumeMenuOpen && createPortal(<div ref={volumeMenuRef} className="series-menu volume-series-menu" role="menu" aria-label="Tùy chọn khối lượng" style={{ left: volumeMenuPosition.left, top: volumeMenuPosition.top }}>
        <div className="series-menu__submenu-wrap" onMouseEnter={() => setSubmenu("order")} onMouseLeave={() => setSubmenu(null)}>
          <button type="button" role="menuitem" tabIndex={-1} className="series-menu__item" aria-haspopup="menu" aria-expanded={submenu === "order"} onClick={() => setSubmenu(submenu === "order" ? null : "order")}><span className="series-menu__icon">{menuIcons.order}</span><span className="series-menu__label">Thứ tự Trực quan</span><span className="series-menu__chevron">{menuIcons.chevron}</span></button>
          {submenu === "order" && <div className="series-menu__submenu" role="menu" aria-label="Thứ tự Trực quan">{renderMenuButton("Đưa lên trước", () => onMoveVolumeSeriesOrder("front"))}{renderMenuButton("Đưa xuống sau", () => onMoveVolumeSeriesOrder("back"))}</div>}
        </div>
        {renderMenuButton("Khả năng hiển thị trong các khoảng thời gian", () => setVolumeSettingsOpen(true))}
        <div className="series-menu__submenu-wrap" onMouseEnter={() => setSubmenu("pane")} onMouseLeave={() => setSubmenu(null)}>
          <button type="button" role="menuitem" tabIndex={-1} className="series-menu__item" aria-haspopup="menu" aria-expanded={submenu === "pane"} onClick={() => setSubmenu(submenu === "pane" ? null : "pane")}><span className="series-menu__icon">{menuIcons.pane}</span><span className="series-menu__label">Chuyển tới</span><span className="series-menu__chevron">{menuIcons.chevron}</span></button>
          {submenu === "pane" && <div className="series-menu__submenu" role="menu" aria-label="Chuyển tới">{(volumePaneShared || volumePaneIndex > 0) && renderMenuButton(volumePaneShared ? "Cửa sổ mới bên trên" : "Cửa sổ hiện có bên trên", () => onMoveVolumeToPane("above"))}{(volumePaneShared || volumePaneIndex < paneCount - 1) && renderMenuButton(volumePaneShared ? "Cửa sổ mới bên dưới" : "Cửa sổ hiện có bên dưới", () => onMoveVolumeToPane("below"))}</div>}
        </div>
        <div className="series-menu__submenu-wrap" onMouseEnter={() => setSubmenu("scale")} onMouseLeave={() => setSubmenu(null)}>
          <button type="button" role="menuitem" tabIndex={-1} className="series-menu__item" aria-haspopup="menu" aria-expanded={submenu === "scale"} onClick={() => setSubmenu(submenu === "scale" ? null : "scale")}><span className="series-menu__icon">{menuIcons.scale}</span><span className="series-menu__label">Ghim theo Tỷ lệ (hiện tại bên {volumeScaleSide === "right" ? "phải" : "trái"})</span><span className="series-menu__chevron">{menuIcons.chevron}</span></button>
          {submenu === "scale" && <div className="series-menu__submenu" role="menu" aria-label="Ghim theo Tỷ lệ">{renderMenuButton("Bên trái", () => onPinVolumeToScale("left"))}{renderMenuButton("Bên phải", () => onPinVolumeToScale("right"))}</div>}
        </div>
        <div className="series-menu__divider" />
        {renderMenuButton("Sao chép", () => navigator.clipboard?.writeText(String(quoteBar?.volume ?? "")), false, undefined, "Ctrl + C")}
        {renderMenuButton(volumeHidden ? "Hiện" : "Ẩn", onToggleVolumeVisibility, false, volumeHidden ? "show" : "hide")}
        {renderMenuButton("Loại bỏ", onRemoveVolume)}
        <div className="series-menu__divider" />
        {renderMenuButton("Cài đặt…", () => setVolumeSettingsOpen(true), false, "settings")}
      </div>, document.body)}

      {volumeSettingsOpen && createPortal(<VolumeSettingsDialog settings={volumeSettings} onApply={onVolumeSettingsApply} onClose={() => setVolumeSettingsOpen(false)} />, document.body)}

      {menuOpen && createPortal(
        <div className="market-data__popover-host" ref={menuRef}>
          <div className="series-menu" role="menu" aria-label="Tùy chọn mã giao dịch" style={{ left: menuPosition.left, top: menuPosition.top }}>
            {renderMenuButton("Thông tin Mã giao dịch…", () => setInfoOpen(true), false, "info")}
            {renderMenuButton(`Sao chép giá ${formatPrice(price)}`, () => price !== undefined && onCopyPrice(price), price === undefined)}
            {renderMenuButton("Dán", onPastePrice, false, undefined, "Ctrl + V")}
            <div className="series-menu__divider" />
            {([
              ["order", "Thứ tự Trực quan"],
              ...(canMoveToPane ? [["pane", "Chuyển tới"] as const] : []),
              ["scale", `Ghim theo Tỷ lệ (hiện tại bên ${scaleSide === "right" ? "phải" : "trái"})`],
            ] as const).map(([id, label]) => (
              <div className="series-menu__submenu-wrap" key={id} onMouseEnter={() => setSubmenu(id)} onMouseLeave={() => setSubmenu(null)}>
                <button type="button" role="menuitem" tabIndex={-1} className="series-menu__item" aria-haspopup="menu" aria-expanded={submenu === id} onClick={() => setSubmenu(submenu === id ? null : id)}>
                  <span className="series-menu__icon">{menuIcons[id]}</span><span className="series-menu__label">{label}</span><span className="series-menu__chevron">{menuIcons.chevron}</span>
                </button>
                {submenu === id && (
                  <div className="series-menu__submenu" role="menu" aria-label={label}>
                    {id === "order" && <>
                      {renderMenuButton("Đưa lên trước", () => onMoveSeriesOrder("front"))}
                      {renderMenuButton("Đưa xuống sau", () => onMoveSeriesOrder("back"))}
                    </>}
                    {id === "pane" && <>
                      {(mainPaneShared || mainPaneIndex > 0) && renderMenuButton(mainPaneShared ? "Cửa sổ mới bên trên" : "Cửa sổ hiện có bên trên", () => onMoveToPane("above"))}
                      {(mainPaneShared || mainPaneIndex < paneCount - 1) && renderMenuButton(mainPaneShared ? "Cửa sổ mới bên dưới" : "Cửa sổ hiện có bên dưới", () => onMoveToPane("below"))}
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
            {renderMenuButton(seriesVisible ? "Ẩn" : "Hiện", onToggleSeriesVisibility, false, seriesVisible ? "hide" : "show")}
            <div className="series-menu__divider" />
            {renderMenuButton("Cài đặt…", onOpenChartSettings, false, "settings")}
          </div>
        </div>,
        document.body,
      )}

      {visibilityTooltip && createPortal(<div className="series-visibility-tooltip" style={{ left: visibilityTooltip.left, top: visibilityTooltip.top }}>{visibilityTooltip.text}</div>, document.body)}

      {infoOpen && (
        <div className="series-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInfoOpen(false); }}>
          <section className="series-dialog" role="dialog" aria-modal="true" aria-labelledby="series-info-title">
            <header><h2 id="series-info-title">Thông tin Mã giao dịch</h2><button type="button" tabIndex={-1} aria-label="Đóng" onClick={() => setInfoOpen(false)}>×</button></header>
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

    </div>
  );
}
