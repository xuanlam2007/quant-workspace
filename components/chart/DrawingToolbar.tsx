import { useEffect, useRef, useState } from "react";
import type { LineToolType } from "lightweight-charts-line-tools-core";
import {
  DRAWING_TOOL_GROUPS,
  type DrawingIcon,
  type DrawingToolGroup,
} from "./chart-config";

type MagnetMode = 0 | 1 | 2;
type ToolbarIconName = DrawingIcon
  | "cursor" | "eraser" | "measure" | "zoom" | "magnet" | "stay"
  | "lock" | "unlock" | "show" | "hide" | "trash";

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
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let content;

  switch (name) {
    case "cursor": content = <><path {...common} d="M12 3v18M3 12h18" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /></>; break;
    case "eraser": content = <><path {...common} d="m7 18-3-3 9-10 5 5-8 8H7Z" /><path {...common} d="M10 18h9" /></>; break;
    case "trend": content = <><path {...common} d="M4 19 20 5" /><circle cx="4" cy="19" r="1.7" fill="currentColor" /><circle cx="20" cy="5" r="1.7" fill="currentColor" /></>; break;
    case "arrow": content = <path {...common} d="M4 19 19 6M13 6h6v6" />; break;
    case "ray": content = <><path {...common} d="M4 18 20 6" /><circle cx="4" cy="18" r="1.7" fill="currentColor" /></>; break;
    case "extended": content = <><path {...common} d="M2 21 22 3" /><circle cx="8" cy="15.5" r="1.5" fill="currentColor" /><circle cx="16" cy="8.5" r="1.5" fill="currentColor" /></>; break;
    case "horizontal": content = <path {...common} d="M3 12h18" />; break;
    case "horizontalRay": content = <><path {...common} d="M4 12h17" /><circle cx="4" cy="12" r="1.7" fill="currentColor" /></>; break;
    case "vertical": content = <path {...common} d="M12 3v18" />; break;
    case "cross": content = <path {...common} d="M12 3v18M3 12h18" />; break;
    case "fib": content = <><path {...common} d="M4 5h16M4 9h16M4 15h16M4 19h16" /><path {...common} d="M6 3v18" /></>; break;
    case "rectangle": content = <rect {...common} x="4" y="6" width="16" height="12" />; break;
    case "text": content = <path {...common} d="M5 5h14M12 5v14M8 19h8" />; break;
    case "callout": content = <><path {...common} d="M4 5h16v11H9l-4 4v-4H4Z" /><path {...common} d="M8 9h8M8 12h5" /></>; break;
    case "priceRange": content = <><path {...common} d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4" /><path {...common} d="M5 4h3M5 20h3" /></>; break;
    case "position": content = <><path {...common} d="M5 4v16M3 7l2-3 2 3M3 17l2 3 2-3" /><path {...common} d="M11 7h9M11 12h6M11 17h9" /></>; break;
    case "measure": content = <><path {...common} d="m5 18 13-13 3 3L8 21Z" /><path {...common} d="m12 11 2 2m1-5 2 2M9 14l2 2" /></>; break;
    case "zoom": content = <><circle {...common} cx="10.5" cy="10.5" r="6.5" /><path {...common} d="m15.5 15.5 5 5M10.5 7v7M7 10.5h7" /></>; break;
    case "magnet": content = <><path {...common} d="M5 4v9a7 7 0 0 0 14 0V4h-4v9a3 3 0 0 1-6 0V4Z" /><path {...common} d="M5 8h4m6 0h4" /></>; break;
    case "stay": content = <><path {...common} d="M7 4v10a5 5 0 0 0 10 0V4" /><path {...common} d="M4 4h6M14 4h6" /><path {...common} d="m14 18 3 3 4-5" /></>; break;
    case "lock": content = <><rect {...common} x="5" y="10" width="14" height="11" rx="2" /><path {...common} d="M8 10V7a4 4 0 0 1 8 0v3" /></>; break;
    case "unlock": content = <><rect {...common} x="5" y="10" width="14" height="11" rx="2" /><path {...common} d="M9 10V7a4 4 0 0 1 7-2" /></>; break;
    case "hide": content = <><path {...common} d="M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5Z" /><circle {...common} cx="12" cy="12" r="2.5" /><path {...common} d="M4 3 20 21" /></>; break;
    case "show": content = <><path {...common} d="M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5Z" /><circle {...common} cx="12" cy="12" r="2.5" /></>; break;
    case "trash": content = <><path {...common} d="M4 7h16M9 4h6l1 3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>; break;
  }

  return <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">{content}</svg>;
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
        <ToolbarIcon name="magnet" />
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
        <ToolbarIcon name="stay" />
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
