"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { RESOLUTIONS } from "../../config/chart-config";
import { FAVORITE_ICONS } from "../../ui/favorite-icons";
import { useDraggablePanel } from "../../ui/useDraggablePanel";
import { LAYOUT_ICONS } from "./layout-icons";
import {
  deleteNamedLayout, layoutStorageError, LAYOUT_LIBRARY_CHANGED, LAYOUT_LIBRARY_KEY,
  LAYOUT_SORT_KEY, readLayoutLibrary, saveNamedLayout, toggleLayoutFavorite,
  WORKSPACE_CHANGED, workspaceSignature,
  type LayoutLibrary, type NamedLayout, type WorkspaceSnapshot,
} from "./named-layouts";

interface Props {
  symbol: string;
  resolution: string;
  ready: boolean;
  capture: () => WorkspaceSnapshot;
  onLoad: (id: string) => void;
  onOpen: () => void;
  otherMenuOpen: boolean;
}

type Dialog = "save" | "copy" | "rename" | "load" | null;
type Sort = { sortField: "title" | "modified"; sortDirection: 0 | 1 };
type Confirmation = { type: "delete"; entry: NamedLayout } | { type: "overwrite"; entry: NamedLayout };
const emptyLibrary: LayoutLibrary = { version: 1, activeId: null, layouts: [] };
const sortOptions: (Sort & { label: string })[] = [
  { sortField: "title", sortDirection: 0, label: "Tên bố cục (A đến Z)" },
  { sortField: "title", sortDirection: 1, label: "Tên bố cục (Z đến A)" },
  { sortField: "modified", sortDirection: 0, label: "Ngày chỉnh sửa (cũ lên trước)" },
  { sortField: "modified", sortDirection: 1, label: "Ngày chỉnh sửa (mới lên trước)" },
];

function Icon({ svg }: { svg: string }) {
  return <span aria-hidden="true" className="layout-icon" dangerouslySetInnerHTML={{ __html: svg }}/>;
}

function description(entry: NamedLayout) {
  return `${entry.symbol}, ${RESOLUTIONS.find((item) => item.value === entry.resolution)?.label ?? entry.resolution}`;
}

function modifiedLabel(time: number) {
  const date = new Date(time);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function match(text: string, query: string) {
  const source = text.toLocaleLowerCase(), term = query.trim().toLocaleLowerCase();
  if (!term) return { rank: 0, indexes: [] as number[] };
  const exact = source.indexOf(term);
  if (exact !== -1) return { rank: source === term ? 4 : 3, indexes: Array.from({ length: term.length }, (_, index) => exact + index) };
  const indexes: number[] = [];
  let offset = 0;
  for (const character of term) {
    const index = source.indexOf(character, offset);
    if (index === -1) return { rank: -1, indexes: [] as number[] };
    indexes.push(index); offset = index + 1;
  }
  return { rank: 1, indexes };
}

function Highlight({ text, query }: { text: string; query: string }) {
  const indexes = new Set(match(text, query).indexes);
  return <>{text.split("").map((character, index) => indexes.has(index) ? <mark key={index}>{character}</mark> : character)}</>;
}

export function LayoutSaveLoad({ symbol, resolution, ready, capture, onLoad, onOpen, otherMenuOpen }: Props) {
  const [library, setLibrary] = useState<LayoutLibrary>(emptyLibrary);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ sortField: "modified", sortDirection: 1 });
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [host, setHost] = useState<Element | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const sortMenu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = useRef({ capture, onLoad, ready });
  current.current = { capture, onLoad, ready };
  const busyRef = useRef(false);
  const drag = useDraggablePanel(dialog !== null);
  const active = library.layouts.find((entry) => entry.id === library.activeId);

  const refresh = useCallback(() => {
    try { setLibrary(readLayoutLibrary()); setError(""); setInitialized(true); }
    catch (reason) { setError(layoutStorageError(reason)); setInitialized(false); }
  }, []);

  useEffect(() => {
    refresh();
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_SORT_KEY) ?? "null") as Sort | null;
      if (saved && ["title", "modified"].includes(saved.sortField) && [0, 1].includes(saved.sortDirection)) setSort(saved);
    } catch { /* Bỏ qua tùy chọn sắp xếp không hợp lệ. */ }
    const storage = (event: StorageEvent) => { if (event.key === LAYOUT_LIBRARY_KEY || event.key === null) refresh(); };
    window.addEventListener(LAYOUT_LIBRARY_CHANGED, refresh);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(LAYOUT_LIBRARY_CHANGED, refresh); window.removeEventListener("storage", storage); };
  }, [refresh]);

  useEffect(() => {
    const updateHost = () => setHost(document.fullscreenElement ?? document.body);
    updateHost(); document.addEventListener("fullscreenchange", updateHost);
    return () => document.removeEventListener("fullscreenchange", updateHost);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      if (!active) { setDirty(true); return; }
      if (!current.current.ready || busyRef.current) return;
      try { setDirty(workspaceSignature(current.current.capture()) !== workspaceSignature(active.workspace)); }
      catch { setDirty(true); }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 350); };
    schedule();
    window.addEventListener("pointerup", schedule, true);
    window.addEventListener("keyup", schedule, true);
    window.addEventListener("wheel", schedule, { passive: true });
    window.addEventListener(WORKSPACE_CHANGED, schedule);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerup", schedule, true);
      window.removeEventListener("keyup", schedule, true);
      window.removeEventListener("wheel", schedule);
      window.removeEventListener(WORKSPACE_CHANGED, schedule);
    };
  }, [active, ready]);

  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), 1000);
    return () => clearTimeout(timer);
  }, [busy]);

  useEffect(() => { if (otherMenuOpen) setMenuOpen(false); }, [otherMenuOpen]);
  useEffect(() => { const timer = setTimeout(() => setQuery(search), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    if (!dialog || confirm) return;
    const frame = requestAnimationFrame(() => { input.current?.focus(); if (dialog !== "load") input.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, [dialog, confirm]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const place = () => {
      const bounds = root.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = menu.current?.offsetWidth ?? 180, height = menu.current?.offsetHeight ?? 90;
      setPosition({ top: Math.max(0, Math.min(bounds.bottom, window.innerHeight - height)), left: Math.max(0, Math.min(bounds.right - 26, window.innerWidth - width - 4)) });
    };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [menuOpen, active, host]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!root.current?.contains(event.target) && !menu.current?.contains(event.target)) setMenuOpen(false);
      if (!sortMenu.current?.contains(event.target)) setSortOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  const rows = useMemo(() => library.layouts.map((entry) => ({ entry, rank: Math.max(match(entry.name, query).rank, match(description(entry), query).rank === -1 ? -1 : Math.min(2, match(description(entry), query).rank)) }))
    .filter(({ rank }) => !query.trim() || rank >= 0)
    .sort((a, b) => {
      if (query.trim() && a.rank !== b.rank) return b.rank - a.rank;
      if (a.entry.favorite !== b.entry.favorite) return a.entry.favorite ? -1 : 1;
      const order = sort.sortField === "modified" ? a.entry.modified - b.entry.modified : a.entry.name.localeCompare(b.entry.name);
      return order * (sort.sortDirection === 0 ? 1 : -1);
    }).map(({ entry }) => entry), [library.layouts, query, sort]);

  useEffect(() => { setSelected(-1); }, [query, sort]);
  useEffect(() => {
    if (selected >= rows.length) setSelected(rows.length - 1);
    list.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected, rows.length]);

  const close = () => {
    if (busyRef.current) return;
    setDialog(null); setConfirm(null); setSortOpen(false); setError(""); trigger.current?.focus();
  };
  const open = (next: Dialog) => {
    onOpen(); setMenuOpen(false); setSortOpen(false); setError(""); setConfirm(null); setDialog(next);
    setName(next === "copy" ? `${active?.name ?? ""} - Bản sao`.slice(0, 64) : next === "rename" ? active?.name ?? "" : "");
    if (next === "load") { setSearch(""); setQuery(""); setSelected(-1); refresh(); }
  };
  const save = async (title: string, id?: string) => {
    if (busyRef.current || !current.current.ready) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const workspace = current.current.capture();
      setLibrary(saveNamedLayout(title, workspace, symbol, resolution, id));
      setDirty(false); setDialog(null); setConfirm(null); setMenuOpen(false);
    } catch (reason) { setError(layoutStorageError(reason)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const beginSave = () => {
    setMenuOpen(false);
    if (active) { void save(active.name, active.id); }
    else open("save");
  };
  const submit = () => {
    if (!name.trim() || busyRef.current) return;
    try {
      const duplicate = readLayoutLibrary().layouts.find((entry) => entry.name === name.trim() && (dialog !== "rename" || entry.id !== active?.id));
      if (duplicate) { setConfirm({ type: "overwrite", entry: duplicate }); return; }
      void save(name, dialog === "rename" ? active?.id : undefined);
    } catch (reason) { setError(layoutStorageError(reason)); }
  };
  const load = (entry: NamedLayout) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { current.current.onLoad(entry.id); }
    catch (reason) { busyRef.current = false; setBusy(false); setError(layoutStorageError(reason)); }
  };
  const remove = () => {
    if (confirm?.type !== "delete") return;
    try { setLibrary(deleteNamedLayout(confirm.entry.id)); setConfirm(null); setError(""); }
    catch (reason) { setError(layoutStorageError(reason)); }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const editable = event.target instanceof Element && !!event.target.closest('input, textarea, select, [contenteditable="true"]');
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!dialog && !document.querySelector('[role="dialog"]') && initialized && ready) beginSave();
        return;
      }
      if (!editable && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === "." && !document.querySelector('[role="dialog"]')) {
        event.preventDefault(); event.stopImmediatePropagation(); open("load"); return;
      }
      if (event.key === "Escape" && (dialog || menuOpen)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (confirm) { if (!busyRef.current) setConfirm(null); }
        else if (sortOpen) setSortOpen(false);
        else if (dialog) close();
        else { setMenuOpen(false); trigger.current?.focus(); }
        return;
      }
      if (dialog === "load" && !confirm && !sortOpen && !busyRef.current && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); event.stopImmediatePropagation();
          setSelected((value) => Math.max(0, Math.min(rows.length - 1, value < 0 ? 0 : value + (event.key === "ArrowDown" ? 1 : -1))));
        } else if (event.key === "Enter" && rows[selected] && !(event.target instanceof Element && event.target.closest("button"))) {
          event.preventDefault(); event.stopImmediatePropagation(); load(rows[selected]);
        }
      }
      if ((dialog || menuOpen) && event.key === "Tab") event.preventDefault();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  });

  const menuKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  const canSave = initialized && ready && !busy && (!active || dirty);
  const saveTitle = active && !dirty ? "Tất cả thay đổi đã được lưu" : "Lưu tất cả các biểu đồ cho tất cả các mã và các khung thời gian";

  return <div className="layout-save" ref={root}>
    <button ref={trigger} type="button" tabIndex={-1} className={`layout-save__button${dialog && dialog !== "load" ? " is-open" : ""}`} aria-label={saveTitle} data-tooltip={saveTitle} data-tooltip-hotkey={canSave ? "Ctrl + S" : undefined} data-tooltip-variant="layout-save" aria-disabled={!canSave} disabled={busy || !ready} onClick={() => { if (canSave) beginSave(); }}>
      <span className="layout-save__name">{active?.name ?? "Lưu"}</span>
      {(dirty || !active || slow) && <span className="layout-save__hint">{slow ? <span className="layout-spinner"/> : "Lưu"}</span>}
    </button>
    <button type="button" tabIndex={-1} className={`layout-save__caret${menuOpen ? " is-open" : ""}`} aria-label="Quản lý bố cục biểu đồ" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { onOpen(); setMenuOpen(!menuOpen); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); onOpen(); setMenuOpen(true); requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()); } }}><Icon svg={LAYOUT_ICONS.caret}/></button>
    {host && menuOpen && createPortal(<div className="layout-menu" ref={menu} style={position} role="menu" aria-label="Bố cục biểu đồ" onKeyDown={menuKeys}>
      <button type="button" tabIndex={-1} role="menuitem" disabled={!canSave} onClick={beginSave}><span>Lưu bố cục</span><small>Ctrl + S</small></button>
      {active && <><button type="button" tabIndex={-1} role="menuitem" disabled={busy || !ready} onClick={() => open("rename")}>Đổi tên…</button><button type="button" tabIndex={-1} role="menuitem" disabled={busy || !ready} onClick={() => open("copy")}>Tạo bản sao…</button></>}
      <div className="layout-menu__separator" role="separator"/>
      <button type="button" tabIndex={-1} role="menuitem" onClick={() => open("load")}><span>Tải bố cục…</span><small>Dot</small></button>
    </div>, host)}
    {host && dialog && createPortal(<div className="layout-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !confirm) close(); }}>
      <div ref={panel} className={`layout-dialog ${dialog === "load" ? "layout-dialog--load" : "layout-dialog--save"}`} style={drag.style} role="dialog" aria-modal="true" aria-labelledby="layout-dialog-title" aria-busy={busy} data-selection-boundary>
        <div className="layout-dialog__header" {...drag.handle}><h2 id="layout-dialog-title">{dialog === "load" ? "Tải bố cục" : dialog === "rename" ? "Đổi tên Bố cục Biểu đồ" : dialog === "copy" ? "Tạo bản sao Bố cục Biểu đồ" : "Lưu Bố cục Biểu đồ mới"}</h2><button type="button" tabIndex={-1} className="layout-dialog__close" aria-label="Đóng" disabled={busy} onClick={close}><Icon svg={LAYOUT_ICONS.close}/></button></div>
        {dialog === "load" ? <>
          <label className="layout-dialog__search"><Icon svg={LAYOUT_ICONS.search}/><input ref={input} tabIndex={-1} type="text" autoComplete="off" value={search} placeholder="Tìm kiếm" aria-label="Tìm kiếm bố cục" onChange={(event) => { setSearch(event.target.value); setSelected(-1); }}/></label>
          <div className="layout-dialog__columns"><span>Tên bố cục</span><div ref={sortMenu} className="layout-sort"><button type="button" tabIndex={-1} className={sortOpen ? "is-open" : ""} aria-label="Sắp xếp theo tên bố cục, ngày chỉnh sửa" aria-expanded={sortOpen} aria-haspopup="menu" onClick={() => setSortOpen(!sortOpen)}><Icon svg={sort.sortDirection ? LAYOUT_ICONS.sortDescending : LAYOUT_ICONS.sortAscending}/></button>
            {sortOpen && <div className="layout-menu layout-sort__menu" role="menu" onKeyDown={menuKeys}>{sortOptions.map((option) => <button key={`${option.sortField}-${option.sortDirection}`} type="button" tabIndex={-1} role="menuitemradio" aria-checked={sort.sortField === option.sortField && sort.sortDirection === option.sortDirection} onClick={() => {
              setSort({ sortField: option.sortField, sortDirection: option.sortDirection }); setSortOpen(false);
              try { localStorage.setItem(LAYOUT_SORT_KEY, JSON.stringify({ sortField: option.sortField, sortDirection: option.sortDirection })); }
              catch (reason) { setError(layoutStorageError(reason)); }
            }}><Icon svg={option.sortDirection ? LAYOUT_ICONS.sortDescending : LAYOUT_ICONS.sortAscending}/><span>{option.label}</span></button>)}</div>}
          </div></div>
          <div className="layout-dialog__list" ref={list} role="list" aria-label="Bố cục đã lưu" onScroll={() => setSortOpen(false)}>
            {rows.map((entry, index) => <div key={entry.id} role="listitem" data-index={index} className={`layout-row${entry.id === library.activeId ? " is-active" : ""}${index === selected ? " is-selected" : ""}`}>
              <button type="button" tabIndex={-1} className={`layout-row__favorite${entry.favorite ? " is-favorite" : ""}`} aria-label={entry.favorite ? "Loại bỏ khỏi mục yêu thích" : "Thêm vào mục yêu thích"} aria-pressed={entry.favorite} disabled={busy} onClick={() => { try { setLibrary(toggleLayoutFavorite(entry.id)); } catch (reason) { setError(layoutStorageError(reason)); } }}><Icon svg={entry.favorite ? FAVORITE_ICONS.filled : FAVORITE_ICONS.empty}/></button>
              <button type="button" tabIndex={-1} className="layout-row__open" disabled={busy} onClick={() => load(entry)}><span className="layout-row__name"><Highlight text={entry.name} query={query}/></span><span className="layout-row__details"><Highlight text={description(entry)} query={query}/> ({modifiedLabel(entry.modified)})</span></button>
              <button type="button" tabIndex={-1} className="layout-row__remove" aria-label={`Xóa bố cục ${entry.name}`} disabled={busy} onClick={() => { setError(""); setConfirm({ type: "delete", entry }); }}><Icon svg={LAYOUT_ICONS.remove}/></button>
            </div>)}
            {!rows.length && !error && <div className="layout-dialog__empty">{query ? "Không tìm thấy bố cục" : "Chưa có bố cục đã lưu"}</div>}
          </div>
          {error && <div className="layout-dialog__error" role="alert">{error}<button type="button" tabIndex={-1} onClick={refresh}>Thử lại</button></div>}
        </> : <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label className="layout-dialog__name">Điền tên định dạng biểu đồ mới:<input ref={input} tabIndex={-1} value={name} maxLength={64} autoComplete="off" aria-label="Tên bố cục" disabled={busy} onChange={(event) => setName(event.target.value)}/></label>
          {error && <p className="layout-dialog__error" role="alert">{error}</p>}
          <div className="layout-dialog__actions"><button type="button" tabIndex={-1} disabled={busy} onClick={close}>Hủy bỏ</button><button type="submit" tabIndex={-1} className="primary" disabled={!name.trim() || busy || !ready}>{slow ? <span className="layout-spinner"/> : "Lưu"}</button></div>
        </form>}
      </div>
      {confirm && <div className="layout-confirm-backdrop"><div className="layout-dialog layout-dialog--confirm" role="alertdialog" aria-modal="true" aria-labelledby="layout-confirm-title">
        <div className="layout-dialog__header"><h2 id="layout-confirm-title">{confirm.type === "delete" ? "Xóa bố cục" : "Ghi đè bố cục"}</h2><button type="button" tabIndex={-1} className="layout-dialog__close" aria-label="Đóng" disabled={busy} onClick={() => setConfirm(null)}><Icon svg={LAYOUT_ICONS.close}/></button></div>
        <p>{confirm.type === "delete" ? `Bạn có thực sự muốn xóa Bố cục Biểu đồ ${confirm.entry.name}?` : `Bố cục “${confirm.entry.name}” đã tồn tại. Bạn có muốn ghi đè không?`}</p>
        {error && <p className="layout-dialog__error" role="alert">{error}</p>}
        <div className="layout-dialog__actions"><button type="button" tabIndex={-1} disabled={busy} onClick={() => setConfirm(null)}>Hủy bỏ</button><button type="button" tabIndex={-1} className="primary" disabled={busy} autoFocus onClick={() => confirm.type === "delete" ? remove() : void save(name, confirm.entry.id)}>{confirm.type === "delete" ? "Xóa" : "Ghi đè"}</button></div>
      </div></div>}
    </div>, host)}
    {host && error && !dialog && createPortal(<div className="layout-save__error" role="alert">{error}<button type="button" tabIndex={-1} aria-label="Đóng" onClick={() => setError("")}><Icon svg={LAYOUT_ICONS.close}/></button></div>, host)}
  </div>;
}
