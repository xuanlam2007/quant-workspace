import { useEffect, useRef, useState } from "react";
import type { LineToolType } from "lightweight-charts-line-tools-core";
import {
  DRAWING_TOOL_GROUPS,
  type DrawingToolGroup,
} from "../config/chart-config";
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

function activeGroupIcon(group: DrawingToolGroup, activeTool: LineToolType | null) {
  return group.tools.find((tool) => tool.type === activeTool && tool.available !== false)?.icon ?? group.icon;
}

function activeGroupTool(group: DrawingToolGroup, activeTool: LineToolType | null) {
  return group.tools.find((tool) => tool.type === activeTool && tool.available !== false) ?? group.tools[0];
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
  onClear,
  onClearIndicators,
  onClearAll,
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
          className={`toolbar-button toolbar-button--split ${activeTool === null && !eraserMode ? "toolbar-button--active" : ""}`}
          data-tooltip="Chế độ con trỏ"
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
          <span aria-hidden="true" />
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
        const defaultTool = activeGroupTool(group, activeTool);
        return (
          <div className="toolbar-group" key={group.id}>
            <button
              className={`toolbar-button toolbar-button--split ${selected ? "toolbar-button--active" : ""}`}
              data-tooltip={defaultTool.id === "trend-line" ? "Đường Xu hướng    Shift · Vẽ một đường thẳng với góc 45 độ" : defaultTool.title}
              data-tooltip-placement="right"
              aria-label={`Chọn ${defaultTool.title}`}
              onClick={() => selectTool(defaultTool.type)}
              disabled={locked}
            >
              <ToolbarIcon name={activeGroupIcon(group, activeTool)} />
            </button>
            {group.tools.length > 1 && (
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
                <span aria-hidden="true" />
              </button>
            )}
            {openMenu === group.id && (
              <div className="toolbar-menu" role="menu">
                <div className="toolbar-menu__title">{group.title}</div>
                {group.tools.map((tool) => (
                  <button
                    className={activeTool === tool.type ? "toolbar-menu__active" : ""}
                    key={tool.id}
                    role="menuitem"
                    onClick={() => selectTool(tool.type)}
                    disabled={tool.available === false}
                    aria-disabled={tool.available === false}
                    data-tooltip={tool.available === false ? "Chưa được package line-tools hiện tại hỗ trợ" : undefined}
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
      <button className="toolbar-button" data-tooltip="Đo biên độ giá" data-tooltip-placement="right" aria-label="Đo biên độ giá" onClick={() => selectTool("PriceRange")} disabled={locked}>
        <ToolbarIcon name="measure" />
      </button>
      <button className="toolbar-button" data-tooltip="Phóng to" data-tooltip-placement="right" aria-label="Phóng to" onClick={onZoomIn}>
        <ToolbarIcon name="zoom" />
      </button>
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
          <span aria-hidden="true" />
        </button>
        {openMenu === "delete" && (
          <div className="toolbar-menu toolbar-menu--bottom" role="menu">
            <button role="menuitem" onClick={() => { onClear(); setOpenMenu(null); }}>Xóa tất cả bản vẽ</button>
            <button role="menuitem" onClick={() => { onClearIndicators(); setOpenMenu(null); }}>Xóa tất cả chỉ báo</button>
            <button className="toolbar-menu__danger" role="menuitem" onClick={() => { onClearAll(); setOpenMenu(null); }}>Xóa bản vẽ và chỉ báo</button>
          </div>
        )}
      </div>
    </aside>
  );
}
