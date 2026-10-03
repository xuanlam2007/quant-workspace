import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LineToolType } from "lightweight-charts-line-tools-core";
import {
  DRAWING_TOOL_GROUPS,
  type DrawingToolOption,
} from "../config/chart-config";
import {
  VNDIRECT_TOOLBAR_ICONS,
  type VndirectToolbarIconName,
} from "./vndirect-icons";
import { useDrawingFavorites } from "./useDrawingFavorites";
import { FavoriteDrawingToolbar } from "./FavoriteDrawingToolbar";
import { FAVORITE_ICONS } from "../ui/favorite-icons";

const SHORTCUTS: Record<string, string> = { "trend-line": "Alt + T", "fib-retracement": "Alt + F", "horizontal-line": "Alt + H", "horizontal-ray": "Alt + J", "vertical-line": "Alt + V", "cross-line": "Alt + C" };

type MagnetMode = 0 | 1 | 2;
type ToolbarIconName = VndirectToolbarIconName;

interface DrawingToolbarProps {
  activeTool: LineToolType | null;
  zoomActive: boolean;
  canUndoZoom: boolean;
  eraserMode: boolean;
  locked: boolean;
  magnetMode: MagnetMode;
  stayInDrawingMode: boolean;
  drawingsHidden: boolean;
  onSelectCursor: () => void;
  onSelectEraser: () => void;
  onStartDrawing: (type: LineToolType) => void;
  onToggleMagnet: () => void;
  onToggleStayInDrawingMode: () => void;
  onToggleLock: () => void;
  onToggleVisibility: () => void;
  onToggleZoom: () => void;
  onUndoZoom: () => void;
  onClear: () => void;
  onClearIndicators: () => void;
  onClearAll: () => void;
}

function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  return (
    <span
      className="toolbar-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: VNDIRECT_TOOLBAR_ICONS[name] }}
    />
  );
}

function MenuCaret() {
  return (
    <svg aria-hidden="true" viewBox="0 0 10 16" width="10" height="16">
      <path d="M.6 1.4 2 0l8 8-8 8-1.4-1.4 6.389-6.532L.6 1.4Z" />
    </svg>
  );
}

export function DrawingToolbar({
  activeTool,
  zoomActive,
  canUndoZoom,
  eraserMode,
  locked,
  magnetMode,
  stayInDrawingMode,
  drawingsHidden,
  onSelectCursor,
  onSelectEraser,
  onStartDrawing,
  onToggleMagnet,
  onToggleStayInDrawingMode,
  onToggleLock,
  onToggleVisibility,
  onToggleZoom,
  onUndoZoom,
  onClear,
  onClearIndicators,
  onClearAll,
}: DrawingToolbarProps) {
  const toolbarRef = useRef<HTMLElement>(null);
  const drawingMenuRef = useRef<HTMLDivElement>(null);
  const favorites = useDrawingFavorites();
  const [menuPosition, setMenuPosition] = useState({ left: 52, top: 60 });
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [selectedTools, setSelectedTools] = useState<Record<string, DrawingToolOption>>(() => {
    const initial: Record<string, DrawingToolOption> = {};
    for (const group of DRAWING_TOOL_GROUPS) {
      if (group.tools.length > 0) {
        initial[group.id] = group.tools[0];
      }
    }
    return initial;
  });

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (!activeTool) return;
    for (const group of DRAWING_TOOL_GROUPS) {
      const matchingTool = group.tools.find(
        (tool) => tool.type === activeTool && tool.available !== false,
      );
      if (matchingTool) {
        setSelectedTools((prev) => {
          if (prev[group.id]?.type === activeTool) return prev;
          return { ...prev, [group.id]: matchingTool };
        });
      }
    }
  }, [activeTool]);

  useLayoutEffect(() => {
    if (!openMenu || !drawingMenuRef.current) return;
    const place = () => {
      const anchor = toolbarRef.current?.querySelector(`[data-tool-group="${openMenu}"]`)?.getBoundingClientRect();
      const toolbar = toolbarRef.current?.getBoundingClientRect();
      const menu = drawingMenuRef.current;
      if (anchor && toolbar && menu) setMenuPosition({ left: Math.max(0, Math.min(toolbar.right, window.innerWidth - menu.offsetWidth)), top: Math.max(6, Math.min(anchor.top - 6, window.innerHeight - menu.offsetHeight - 6)) });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(drawingMenuRef.current);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [openMenu]);

  const toggleMenu = (menu: string) => setOpenMenu((current) => current === menu ? null : menu);
  const selectTool = (type: LineToolType) => {
    onStartDrawing(type);
    setOpenMenu(null);
  };

  const selectGroupTool = (groupId: string, tool: DrawingToolOption) => {
    if (tool.available === false) return;
    setSelectedTools((prev) => ({ ...prev, [groupId]: tool }));
    onStartDrawing(tool.type);
    setOpenMenu(null);
  };

  const activeFavoriteId = activeTool ? Object.values(selectedTools).find((tool) => tool.type === activeTool && tool.available !== false)?.id : undefined;

  return (
    <><aside ref={toolbarRef} className="drawing-toolbar" data-menu-open={openMenu !== null} aria-label="Công cụ vẽ">
      <div className="toolbar-group">
        <button
          className={`toolbar-button toolbar-button--split ${activeTool === null && !eraserMode ? "toolbar-button--active" : ""}`}
          data-tooltip="Chế độ con trỏ"
          data-tooltip-delay="1500"
          data-tooltip-placement="right"
          aria-label="Chế độ con trỏ"
          onClick={onSelectCursor}
        >
          <ToolbarIcon name={eraserMode ? "eraser" : "cursor"} />
        </button>
        <button
          className="toolbar-menu-trigger"
          data-tooltip="Các chế độ con trỏ"
          data-tooltip-placement="right"
          aria-label="Mở các chế độ con trỏ"
          aria-haspopup="menu"
          aria-expanded={openMenu === "cursor"}
          onClick={() => toggleMenu("cursor")}
        >
          <MenuCaret />
        </button>
        {openMenu === "cursor" && (
          <div className="toolbar-menu" role="menu">
            <button role="menuitem" onClick={() => { onSelectCursor(); setOpenMenu(null); }}>
              <ToolbarIcon name="cursor" /><span>Con trỏ chữ thập</span>
            </button>
            <button role="menuitem" onClick={() => { onSelectEraser(); setOpenMenu(null); }}>
              <ToolbarIcon name="eraser" /><span>Tẩy bản vẽ</span>
            </button>
          </div>
        )}
      </div>

      {DRAWING_TOOL_GROUPS.map((group) => {
        const selected = group.tools.some(
          (tool) => tool.type === activeTool && tool.available !== false,
        );
        const currentTool = selectedTools[group.id] ?? group.tools[0];
        return (
          <div className="toolbar-group" key={group.id} data-tool-group={group.id}>
            <button
              className={`toolbar-button toolbar-button--split ${selected ? "toolbar-button--active" : ""}`}
              aria-label={`Chọn ${currentTool.title}`}
              data-tooltip={currentTool.id === "trend-line" ? "Đường Xu hướng" : currentTool.title}
              data-tooltip-delay="1500"
              data-tooltip-hotkey={currentTool.id === "trend-line" ? "Shift" : undefined}
              data-tooltip-description={currentTool.id === "trend-line" ? "Vẽ một đường thẳng với góc 45 độ" : undefined}
              data-tooltip-placement="right"
              onClick={() => selectGroupTool(group.id, currentTool)}
              disabled={locked}
            >
              <ToolbarIcon name={currentTool.icon} />
            </button>
            {group.tools.length > 0 && (
              <button
                className="toolbar-menu-trigger"
                data-tooltip={`Các công cụ ${group.title}`}
                data-tooltip-placement="right"
                aria-label={`Mở các công cụ ${group.title}`}
                aria-haspopup="menu"
                aria-expanded={openMenu === group.id}
                onClick={() => toggleMenu(group.id)}
                disabled={locked}
              >
                <MenuCaret />
              </button>
            )}
            {openMenu === group.id && (
              <div ref={drawingMenuRef} className="toolbar-menu toolbar-menu--drawing" role="menu" style={menuPosition} onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const rows = Array.from(drawingMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? []);
                const index = rows.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
                rows[next]?.focus();
              }}>
                {group.tools.map((tool) => (
                  <div className={`drawing-tool-menu__row ${selected && currentTool.id === tool.id ? "is-active" : ""}`} key={tool.id}>
                  <button
                    className="drawing-tool-menu__select"
                    type="button"
                    tabIndex={-1}
                    role="menuitemradio"
                    aria-checked={selected && currentTool.id === tool.id}
                    onClick={() => selectGroupTool(group.id, tool)}
                    disabled={tool.available === false}
                    aria-disabled={tool.available === false}
                    data-tooltip={tool.available === false ? "Chưa được package line-tools hiện tại hỗ trợ" : undefined}
                  >
                    <ToolbarIcon name={tool.icon} /><span className="drawing-tool-menu__label">{tool.title}</span>{SHORTCUTS[tool.id] && <span className="drawing-tool-menu__shortcut">{SHORTCUTS[tool.id]}</span>}
                  </button>
                  {tool.available !== false && <button type="button" tabIndex={-1} className={`drawing-tool-menu__favorite ${favorites.ids.includes(tool.id) ? "is-favorite" : ""}`} aria-label={favorites.ids.includes(tool.id) ? "Loại bỏ khỏi mục yêu thích" : "Thêm vào mục yêu thích"} aria-pressed={favorites.ids.includes(tool.id)} data-tooltip={favorites.ids.includes(tool.id) ? "Loại bỏ khỏi mục yêu thích" : "Thêm vào mục yêu thích"} onClick={() => favorites.toggle(tool.id)} dangerouslySetInnerHTML={{ __html: favorites.ids.includes(tool.id) ? FAVORITE_ICONS.filled : FAVORITE_ICONS.empty }}/>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <span className="toolbar-divider" />
      <button className="toolbar-button" data-tooltip="Đo biên độ giá" data-tooltip-placement="right" aria-label="Đo biên độ giá" onClick={() => selectTool("PriceRange")} disabled={locked}>
        <ToolbarIcon name="measure" />
      </button>
      <button className={`toolbar-button ${zoomActive ? "toolbar-button--active" : ""}`} tabIndex={-1} aria-pressed={zoomActive} data-tooltip="Chọn vùng để phóng to" data-tooltip-placement="right" aria-label="Chọn vùng để phóng to" onClick={onToggleZoom}>
        <ToolbarIcon name="zoom" />
      </button>
      {canUndoZoom && (
        <button className="toolbar-button" tabIndex={-1} data-tooltip="Trở về khung nhìn trước" data-tooltip-placement="right" aria-label="Trở về khung nhìn trước" onClick={onUndoZoom}>
          <ToolbarIcon name="zoomOut" />
        </button>
      )}
      <span className="toolbar-divider" />
      <button
        className={`toolbar-button ${magnetMode > 0 ? "toolbar-button--active" : ""}`}
        data-tooltip={`Nam châm: ${magnetMode === 0 ? "tắt" : magnetMode === 1 ? "yếu" : "mạnh"}`}
        data-tooltip-placement="right"
        aria-label="Thay đổi chế độ nam châm"
        onClick={onToggleMagnet}
        disabled={locked}
      >
        <ToolbarIcon name={magnetMode === 2 ? "magnetStrong" : "magnet"} />
        {magnetMode > 0 && <span className="toolbar-badge">{magnetMode}</span>}
      </button>
      <button
        className={`toolbar-button ${stayInDrawingMode ? "toolbar-button--active" : ""}`}
        data-tooltip="Giữ chế độ vẽ"
        data-tooltip-placement="right"
        aria-label="Giữ chế độ vẽ"
        aria-pressed={stayInDrawingMode}
        onClick={onToggleStayInDrawingMode}
        disabled={locked}
      >
        <ToolbarIcon name={stayInDrawingMode ? "stayActive" : "stay"} />
      </button>
      <button
        className={`toolbar-button ${locked ? "toolbar-button--active" : ""}`}
        data-tooltip={locked ? "Mở khóa bản vẽ" : "Khóa bản vẽ"}
        data-tooltip-placement="right"
        aria-label={locked ? "Mở khóa bản vẽ" : "Khóa bản vẽ"}
        onClick={onToggleLock}
      >
        <ToolbarIcon name={locked ? "lock" : "unlock"} />
      </button>
      <button
        className={`toolbar-button ${drawingsHidden ? "toolbar-button--active" : ""}`}
        data-tooltip={drawingsHidden ? "Hiện bản vẽ" : "Ẩn bản vẽ"}
        data-tooltip-placement="right"
        aria-label={drawingsHidden ? "Hiện bản vẽ" : "Ẩn bản vẽ"}
        onClick={onToggleVisibility}
      >
        <ToolbarIcon name={drawingsHidden ? "hide" : "show"} />
      </button>

      <span className="toolbar-divider" />
      <div className="toolbar-group">
        <button
          className="toolbar-button toolbar-button--split toolbar-button--danger"
          data-tooltip="Xóa tất cả bản vẽ"
          data-tooltip-placement="right"
          aria-label="Xóa tất cả bản vẽ"
          onClick={onClear}
        >
          <ToolbarIcon name="trash" />
        </button>
        <button
          className="toolbar-menu-trigger"
          data-tooltip="Các tùy chọn xóa"
          data-tooltip-placement="right"
          aria-label="Mở các tùy chọn xóa"
          aria-haspopup="menu"
          aria-expanded={openMenu === "delete"}
          onClick={() => toggleMenu("delete")}
        >
          <MenuCaret />
        </button>
        {openMenu === "delete" && (
          <div className="toolbar-menu toolbar-menu--bottom" role="menu">
            <button role="menuitem" onClick={() => { onClear(); setOpenMenu(null); }}>Xóa tất cả bản vẽ</button>
            <button role="menuitem" onClick={() => { onClearIndicators(); setOpenMenu(null); }}>Xóa tất cả chỉ báo</button>
            <button className="toolbar-menu__danger" role="menuitem" onClick={() => { onClearAll(); setOpenMenu(null); }}>Xóa bản vẽ và chỉ báo</button>
          </div>
        )}
      </div>
      {favorites.ids.length > 0 && <button type="button" tabIndex={-1} className={`toolbar-button drawing-favorites-toggle ${favorites.visible ? "is-active" : ""}`} aria-label="Hiển thị thanh công cụ vẽ yêu thích" aria-pressed={favorites.visible} data-tooltip="Hiển thị thanh công cụ vẽ yêu thích" data-tooltip-placement="right" onClick={favorites.toggleVisibility} dangerouslySetInnerHTML={{ __html: FAVORITE_ICONS.toolbar }}/>}
    </aside>
    <FavoriteDrawingToolbar ids={favorites.ids} visible={favorites.visible} locked={locked} activeId={activeFavoriteId} onSelect={(tool) => {
      const group = DRAWING_TOOL_GROUPS.find((item) => item.tools.some((entry) => entry.id === tool.id));
      if (group) selectGroupTool(group.id, tool);
    }} onReorder={favorites.reorder} onHide={favorites.hide}/></>
  );
}
