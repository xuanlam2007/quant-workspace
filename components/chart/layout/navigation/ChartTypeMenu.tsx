"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CHART_STYLES, type ChartStyle } from "../../config/chart-styles";
import { CHART_STYLE_ICONS } from "../../config/chart-style-icons";
import { FAVORITE_ICONS } from "../../ui/favorite-icons";


interface Props {
  style: ChartStyle;
  favorites: ChartStyle[];
  onChange: (style: ChartStyle) => void;
  onFavoritesChange: (favorites: ChartStyle[]) => void;
  onOpen: () => void;
  otherMenuOpen: boolean;
}

export function ChartTypeMenu({ style, favorites, onChange, onFavoritesChange, onOpen, otherMenuOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 500 });
  const [lastNonFavorite, setLastNonFavorite] = useState<ChartStyle>();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const previous = useRef(style);
  const current = CHART_STYLES.find((item) => item.id === style)!;
  const quick = [...favorites];
  if (!quick.includes(style)) quick.push(style);
  else if (lastNonFavorite !== undefined && !quick.includes(lastNonFavorite)) quick.push(lastNonFavorite);
  const grouped = favorites.length > 0 && quick.length > 1;

  useEffect(() => {
    const updateHost = () => setPortalHost(document.fullscreenElement ?? document.body);
    updateHost();
    document.addEventListener("fullscreenchange", updateHost);
    return () => document.removeEventListener("fullscreenchange", updateHost);
  }, []);

  useEffect(() => {
    if (previous.current !== style && !favorites.includes(previous.current)) setLastNonFavorite(previous.current);
    previous.current = style;
  }, [style, favorites]);
  useEffect(() => { if (otherMenuOpen) setOpen(false); }, [otherMenuOpen]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      const top = root.current?.closest(".chart-header")?.getBoundingClientRect().bottom ?? rect?.bottom ?? 0;
      if (rect) setPosition({ left: Math.max(4, Math.min(rect.left, window.innerWidth - 301)), top, maxHeight: Math.max(80, window.innerHeight - top - 8) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, portalHost]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const icon = (id: ChartStyle) => <span aria-hidden="true" className="chart-type__icon" dangerouslySetInnerHTML={{ __html: CHART_STYLE_ICONS[id] }}/>;
  const toggle = () => { if (!open) onOpen(); setOpen((value) => !value); };
  return <div className={`chart-type ${grouped ? "chart-type--grouped" : ""}`} ref={root}>
    {grouped && <div className="chart-type__quick">{quick.map((id) => <button type="button" tabIndex={-1} key={id} className={`header-btn header-btn--icon ${id === style ? "chart-type__active" : ""}`} aria-label={CHART_STYLES.find((item) => item.id === id)!.label} data-tooltip={CHART_STYLES.find((item) => item.id === id)!.label} aria-pressed={id === style} onClick={() => { onChange(id); setOpen(false); }}>{icon(id)}</button>)}</div>}
    <button type="button" tabIndex={-1} className={`header-btn header-btn--icon chart-type__trigger ${open ? "active" : ""}`} aria-label={`Kiểu biểu đồ: ${current.label}`} data-tooltip={grouped ? "Kiểu biểu đồ" : current.label} aria-haspopup="menu" aria-expanded={open} onClick={toggle} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); if (!open) toggle(); requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()); } }}>
      {icon(style)}
      {grouped && <svg className={`chart-type__caret ${open ? "dropped" : ""}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 8" width="16" height="8" aria-hidden="true"><path fill="currentColor" d="M0 1.475l7.396 6.04.596.485.593-.49L16 1.39 14.807 0 7.393 6.122 8.58 6.12 1.186.08z"/></svg>}
    </button>
    {open && portalHost && createPortal(<><div className="chart-type__scrim" onPointerDown={() => setOpen(false)}/><div ref={menu} className="chart-type__menu" role="menu" aria-label="Kiểu biểu đồ" style={position} onKeyDown={(event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const rows = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
      const index = rows.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      rows[next]?.focus();
    }}>
      {CHART_STYLES.map(({ id, label }) => <Fragment key={id}>{id === 8 && <div className="chart-type__separator" role="separator"/>}<div className={`chart-type__row ${id === style ? "selected" : ""}`}>
        <button type="button" tabIndex={-1} role="menuitemradio" aria-checked={id === style} className="chart-type__select" onClick={() => { onChange(id); setOpen(false); }}>{icon(id)}<span>{label}</span></button>
        <button type="button" tabIndex={-1} className={`chart-type__favorite ${favorites.includes(id) ? "filled" : ""}`} aria-pressed={favorites.includes(id)} aria-label={favorites.includes(id) ? "Loại bỏ khỏi mục yêu thích" : "Thêm vào mục yêu thích"} data-tooltip={favorites.includes(id) ? "Loại bỏ khỏi mục yêu thích" : "Thêm vào mục yêu thích"} onClick={() => onFavoritesChange(favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id])} dangerouslySetInnerHTML={{ __html: favorites.includes(id) ? FAVORITE_ICONS.filled : FAVORITE_ICONS.empty }}/>
      </div></Fragment>)}
    </div></>, portalHost)}
  </div>;
}
