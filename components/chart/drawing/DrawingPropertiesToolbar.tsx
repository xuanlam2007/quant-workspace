import { useEffect, useRef, useState } from "react";
import { LineStyle } from "lightweight-charts";
import type { LineToolExport, LineToolType } from "lightweight-charts-line-tools-core";
import type { DrawingIcon } from "../config/chart-config";
import { VNDIRECT_TOOLBAR_ICONS } from "./vndirect-icons";

const TOOL_ICONS: Partial<Record<LineToolType, DrawingIcon>> = {
  TrendLine: "trend",
  Arrow: "arrow",
  Ray: "ray",
  ExtendedLine: "extended",
  HorizontalLine: "horizontal",
  HorizontalRay: "horizontalRay",
  VerticalLine: "vertical",
  CrossLine: "cross",
  FibRetracement: "fib",
  Rectangle: "rectangle",
  Text: "text",
  Callout: "callout",
  PriceRange: "priceRange",
  LongShortPosition: "position",
};

interface DrawingPropertiesToolbarProps {
  drawing: LineToolExport<LineToolType>;
  onChange: (drawing: LineToolExport<LineToolType>) => void;
  onOpenSettings: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}

function toolLineOptions(drawing: LineToolExport<LineToolType>) {
  const options = drawing.options as Record<string, unknown>;
  if (options.line) return { key: "line", value: options.line as Record<string, unknown> };
  if (options.rectangle) {
    const rectangle = options.rectangle as Record<string, unknown>;
    return { key: "rectangle", value: rectangle.border as Record<string, unknown> };
  }
  if (options.priceRange) {
    const priceRange = options.priceRange as Record<string, unknown>;
    const rectangle = priceRange.rectangle as Record<string, unknown>;
    return { key: "priceRange", value: rectangle.border as Record<string, unknown> };
  }
  return null;
}

export function DrawingPropertiesToolbar({
  drawing,
  onChange,
  onOpenSettings,
  onToggleLock,
  onDelete,
}: DrawingPropertiesToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [position, setPosition] = useState({ left: -1, top: 48 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const line = toolLineOptions(drawing);
  const color = String(line?.value.color ?? "#2962ff");
  const width = Number(line?.value.width ?? 2);
  const style = Number(line?.value.style ?? LineStyle.Solid);
  const locked = drawing.options.editable === false;

  useEffect(() => {
    const parent = toolbarRef.current?.parentElement;
    const toolbar = toolbarRef.current;
    if (!parent || !toolbar || position.left >= 0) return;
    setPosition({ left: Math.max(12, parent.clientWidth - toolbar.offsetWidth - 16), top: 48 });
  }, [position.left]);

  const updateLine = (patch: Record<string, unknown>) => {
    if (!line) return;
    const options = structuredClone(drawing.options) as Record<string, unknown>;
    if (line.key === "line") {
      options.line = { ...(options.line as object), ...patch };
    } else if (line.key === "rectangle") {
      const rectangle = options.rectangle as Record<string, unknown>;
      options.rectangle = { ...rectangle, border: { ...(rectangle.border as object), ...patch } };
    } else {
      const priceRange = options.priceRange as Record<string, unknown>;
      const rectangle = priceRange.rectangle as Record<string, unknown>;
      options.priceRange = {
        ...priceRange,
        rectangle: { ...rectangle, border: { ...(rectangle.border as object), ...patch } },
        verticalLine: { ...(priceRange.verticalLine as object), ...patch },
        horizontalLine: { ...(priceRange.horizontalLine as object), ...patch },
      };
    }
    onChange({ ...drawing, options: options as typeof drawing.options });
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY, ...position };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const origin = dragRef.current;
    const parent = toolbarRef.current?.parentElement;
    const toolbar = toolbarRef.current;
    if (!origin || !parent || !toolbar) return;
    setPosition({
      left: Math.max(0, Math.min(parent.clientWidth - toolbar.offsetWidth, origin.left + event.clientX - origin.x)),
      top: Math.max(0, Math.min(parent.clientHeight - toolbar.offsetHeight, origin.top + event.clientY - origin.y)),
    });
  };

  const icon = TOOL_ICONS[drawing.toolType] ?? "trend";

  return (
    <div
      ref={toolbarRef}
      className="drawing-properties"
      style={{ left: position.left, top: position.top }}
      role="toolbar"
      aria-label="Thuộc tính bản vẽ đã chọn"
    >
      <button
        className="drawing-properties__drag"
        aria-label="Di chuyển thanh thuộc tính"
        data-tooltip="Di chuyển thanh thuộc tính"
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={() => { dragRef.current = null; }}
      >
        <span className="toolbar-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: VNDIRECT_TOOLBAR_ICONS.drag }} />
      </button>
      <span className="toolbar-icon" dangerouslySetInnerHTML={{ __html: VNDIRECT_TOOLBAR_ICONS[icon] }} />
      {line && (
        <>
          <label className="drawing-properties__color" data-tooltip="Màu đường">
            <input
              type="color"
              value={color.startsWith("#") ? color : "#2962ff"}
              aria-label="Màu đường"
              onChange={(event) => updateLine({ color: event.target.value })}
            />
          </label>
          <select aria-label="Độ dày đường" value={width} onChange={(event) => updateLine({ width: Number(event.target.value) })}>
            {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}px</option>)}
          </select>
          <select aria-label="Kiểu đường" value={style} onChange={(event) => updateLine({ style: Number(event.target.value) })}>
            <option value={LineStyle.Solid}>Liền</option>
            <option value={LineStyle.Dotted}>Chấm</option>
            <option value={LineStyle.Dashed}>Đứt</option>
            <option value={LineStyle.LargeDashed}>Đứt dài</option>
          </select>
        </>
      )}
      <button
        className="drawing-properties__button"
        data-tooltip="Cài đặt"
        aria-label="Mở cài đặt bản vẽ"
        aria-expanded={settingsOpen}
        onClick={() => {
          setMoreOpen(false);
          if (drawing.toolType === "Text") onOpenSettings();
          else setSettingsOpen((open) => !open);
        }}
      >
        <span className="toolbar-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: VNDIRECT_TOOLBAR_ICONS.settings }} />
      </button>
      <button className="drawing-properties__button" data-tooltip={locked ? "Mở khóa" : "Khóa"} aria-label={locked ? "Mở khóa bản vẽ" : "Khóa bản vẽ"} onClick={onToggleLock}>
        <span className="toolbar-icon" dangerouslySetInnerHTML={{ __html: VNDIRECT_TOOLBAR_ICONS[locked ? "lock" : "unlock"] }} />
      </button>
      <button className="drawing-properties__button" data-tooltip="Xóa" aria-label="Xóa bản vẽ" onClick={onDelete}>
        <span className="toolbar-icon" dangerouslySetInnerHTML={{ __html: VNDIRECT_TOOLBAR_ICONS.trash }} />
      </button>
      <button
        className="drawing-properties__button"
        data-tooltip="Thêm"
        aria-label="Thêm tùy chọn"
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        onClick={() => { setSettingsOpen(false); setMoreOpen((open) => !open); }}
      >
        <span className="toolbar-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: VNDIRECT_TOOLBAR_ICONS.more }} />
      </button>
      {settingsOpen && (
        <div className="drawing-properties__popover" role="dialog" aria-label="Cài đặt bản vẽ">
          <strong>Cài đặt bản vẽ</strong>
          {line ? (
            <>
              <label>Màu đường <input type="color" value={color.startsWith("#") ? color : "#2962ff"} onChange={(event) => updateLine({ color: event.target.value })} /></label>
              <label>Độ dày <input type="range" min="1" max="4" value={width} onChange={(event) => updateLine({ width: Number(event.target.value) })} /></label>
            </>
          ) : <span>Thuộc tính được chỉnh trực tiếp trên thanh công cụ.</span>}
        </div>
      )}
      {moreOpen && (
        <div className="drawing-properties__popover drawing-properties__popover--menu" role="menu">
          <button role="menuitem" onClick={() => { setMoreOpen(false); onToggleLock(); }}>{locked ? "Mở khóa bản vẽ" : "Khóa bản vẽ"}</button>
          <button role="menuitem" className="danger" onClick={() => { setMoreOpen(false); onDelete(); }}>Xóa bản vẽ</button>
        </div>
      )}
    </div>
  );
}
