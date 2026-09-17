import { useEffect, useRef, useState } from "react";
import type { LineToolType } from "lightweight-charts-line-tools-core";
import {
  DRAWING_TOOL_GROUPS,
  type DrawingToolGroup,
} from "./chart-config";
import {
  VNDIRECT_TOOLBAR_ICONS,
  type VndirectToolbarIconName,
} from "./vndirect-icons";

type MagnetMode = 0 | 1 | 2;
type ToolbarIconName = VndirectToolbarIconName;

interface DrawingToolbarProps {
  activeTool: LineToolType | null;
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
  onZoomIn: () => void;
  onDeleteSelected: () => void;
  onClear: () => void;
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

function activeGroupIcon(group: DrawingToolGroup, activeTool: LineToolType | null) {
  return group.tools.find((tool) => tool.type === activeTool)?.icon ?? group.icon;
}

export function DrawingToolbar({
  activeTool,
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
  onZoomIn,
  onDeleteSelected,
  onClear,
}: DrawingToolbarProps) {
  const toolbarRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

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

  const toggleMenu = (menu: string) => setOpenMenu((current) => current === menu ? null : menu);
  const selectTool = (type: LineToolType) => {
    onStartDrawing(type);
    setOpenMenu(null);
  };

  return (
    <aside ref={toolbarRef} className="drawing-toolbar" aria-label="Công cụ vẽ">
      <div className="toolbar-group">
        <button
          className={`toolbar-button ${activeTool === null && !eraserMode ? "toolbar-button--active" : ""}`}
          title="Chế độ con trỏ"
          aria-label="Chế độ con trỏ"
          aria-expanded={openMenu === "cursor"}
          onClick={() => toggleMenu("cursor")}
        >
          <ToolbarIcon name={eraserMode ? "eraser" : "cursor"} />
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
        const selected = group.tools.some((tool) => tool.type === activeTool);
        return (
          <div className="toolbar-group" key={group.id}>
            <button
              className={`toolbar-button ${selected ? "toolbar-button--active" : ""}`}
              title={group.title}
              aria-label={group.title}
              aria-expanded={openMenu === group.id}
              onClick={() => toggleMenu(group.id)}
              disabled={locked}
            >
              <ToolbarIcon name={activeGroupIcon(group, activeTool)} />
            </button>
            {openMenu === group.id && (
              <div className="toolbar-menu" role="menu">
                <div className="toolbar-menu__title">{group.title}</div>
                {group.tools.map((tool) => (
                  <button
                    className={activeTool === tool.type ? "toolbar-menu__active" : ""}
                    key={tool.type}
                    role="menuitem"
                    onClick={() => selectTool(tool.type)}
                  >
                    <ToolbarIcon name={tool.icon} /><span>{tool.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <span className="toolbar-divider" />
      <button className="toolbar-button" title="Đo biên độ giá" aria-label="Đo biên độ giá" onClick={() => selectTool("PriceRange")} disabled={locked}>
        <ToolbarIcon name="measure" />
      </button>
      <button className="toolbar-button" title="Phóng to" aria-label="Phóng to" onClick={onZoomIn}>
        <ToolbarIcon name="zoom" />
      </button>
      <button
        className={`toolbar-button ${magnetMode > 0 ? "toolbar-button--active" : ""}`}
        title={`Nam châm: ${magnetMode === 0 ? "tắt" : magnetMode === 1 ? "yếu" : "mạnh"}`}
        aria-label="Thay đổi chế độ nam châm"
        onClick={onToggleMagnet}
        disabled={locked}
      >
        <ToolbarIcon name={magnetMode === 2 ? "magnetStrong" : "magnet"} />
        {magnetMode > 0 && <span className="toolbar-badge">{magnetMode}</span>}
      </button>
      <button
        className={`toolbar-button ${stayInDrawingMode ? "toolbar-button--active" : ""}`}
        title="Giữ chế độ vẽ"
        aria-label="Giữ chế độ vẽ"
        aria-pressed={stayInDrawingMode}
        onClick={onToggleStayInDrawingMode}
        disabled={locked}
      >
        <ToolbarIcon name={stayInDrawingMode ? "stayActive" : "stay"} />
      </button>
      <button
        className={`toolbar-button ${locked ? "toolbar-button--active" : ""}`}
        title={locked ? "Mở khóa bản vẽ" : "Khóa bản vẽ"}
        aria-label={locked ? "Mở khóa bản vẽ" : "Khóa bản vẽ"}
        onClick={onToggleLock}
      >
        <ToolbarIcon name={locked ? "lock" : "unlock"} />
      </button>
      <button
        className={`toolbar-button ${drawingsHidden ? "toolbar-button--active" : ""}`}
        title={drawingsHidden ? "Hiện bản vẽ" : "Ẩn bản vẽ"}
        aria-label={drawingsHidden ? "Hiện bản vẽ" : "Ẩn bản vẽ"}
        onClick={onToggleVisibility}
      >
        <ToolbarIcon name={drawingsHidden ? "hide" : "show"} />
      </button>

      <div className="toolbar-group">
        <button
          className="toolbar-button toolbar-button--danger"
          title="Xóa bản vẽ"
          aria-label="Xóa bản vẽ"
          aria-expanded={openMenu === "delete"}
          onClick={() => toggleMenu("delete")}
        >
          <ToolbarIcon name="trash" />
        </button>
        {openMenu === "delete" && (
          <div className="toolbar-menu toolbar-menu--bottom" role="menu">
            <button role="menuitem" onClick={() => { onDeleteSelected(); setOpenMenu(null); }}>Xóa bản vẽ đã chọn</button>
            <button className="toolbar-menu__danger" role="menuitem" onClick={() => { onClear(); setOpenMenu(null); }}>Xóa tất cả bản vẽ</button>
          </div>
        )}
      </div>
    </aside>
  );
}
