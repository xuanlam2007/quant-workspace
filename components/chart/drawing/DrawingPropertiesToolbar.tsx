import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
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

const COLORS = [
  "#2962ff",
  "#089981",
  "#53b987",
  "#ff9800",
  "#f23645",
  "#eb4d5c",
  "#9c27b0",
  "#787b86",
  "#d8dde7",
  "#ffffff",
];

const LINE_STYLES = [
  { value: LineStyle.Solid, label: "Liền" },
  { value: LineStyle.Dotted, label: "Chấm" },
  { value: LineStyle.Dashed, label: "Đứt" },
  { value: LineStyle.LargeDashed, label: "Đứt dài" },
];

type PropertyMenu = "color" | "width" | "style" | "settings" | "more";

export interface DrawingToolbarAnchor {
  centerX: number;
  top: number;
  bottom: number;
  left?: number;
  right?: number;
  textAnchor?: { x: number; y: number };
}

interface DrawingPropertiesToolbarProps {
  drawing: LineToolExport<LineToolType>;
  anchor?: DrawingToolbarAnchor | null;
  onChange: (drawing: LineToolExport<LineToolType>) => void;
  onOpenSettings: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}

function VndIcon({ name }: { name: keyof typeof VNDIRECT_TOOLBAR_ICONS }) {
  return (
    <span
      className={`drawing-properties__icon ${name === "drag" ? "drawing-properties__icon--drag" : ""}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: VNDIRECT_TOOLBAR_ICONS[name] }}
    />
  );
}

function SettingsIcon() {
  return (
    <svg className="drawing-properties__settings-icon" viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M13 5.5c0-.28.22-.5.5-.5h1c.28 0 .5.22.5.5V7.05l.4.09c.9.18 1.73.53 2.46 1.02l.34.23.29-.3.81-.8c.2-.2.52-.2.71 0l.7.7.36-.35-.35.35c.2.2.2.51 0 .7l-.82.82-.29.29.23.34c.49.73.84 1.57 1.02 2.46l.08.4H22.5c.28 0 .5.22.5.5v1a.5.5 0 0 1-.5.5H20.95l-.09.4c-.18.9-.53 1.73-1.02 2.46l-.23.34.3.29.8.81c.2.2.2.52 0 .71l-.7.7a.5.5 0 0 1-.7 0l-.82-.8-.29-.3-.34.23c-.73.49-1.57.84-2.46 1.02l-.4.08V22.5a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5V20.95l-.4-.09a6.96 6.96 0 0 1-2.46-1.02l-.34-.23-.29.3-.81.8.35.36-.35-.35a.5.5 0 0 1-.71 0l-.7-.71a.5.5 0 0 1 0-.7l-.36-.36.35.35.82-.81.29-.29-.23-.34a6.96 6.96 0 0 1-1.02-2.46l-.08-.4H5.5a.5.5 0 0 1-.5-.5v-1c0-.28.22-.5.5-.5H7.05l.09-.4c.18-.9.53-1.73 1.02-2.46l.23-.34-.3-.29-.8-.81a.5.5 0 0 1 0-.71l.7-.7c.2-.2.51-.2.7 0l.82.8.29.3.34-.23a6.96 6.96 0 0 1 2.46-1.02l.4-.08V5.5zm.5-1.5c-.83 0-1.5.67-1.5 1.5v.75c-.73.2-1.43.48-2.06.86l-.54-.53a1.5 1.5 0 0 0-2.12 0l-.7.7a1.5 1.5 0 0 0 0 2.12l.53.54A7.95 7.95 0 0 0 6.25 12H5.5c-.83 0-1.5.67-1.5 1.5v1c0 .83.67 1.5 1.5 1.5h.75c.2.73.48 1.43.86 2.06l-.53.54a1.5 1.5 0 0 0 0 2.12l.7.7a1.5 1.5 0 0 0 2.12 0l.54-.53c.63.38 1.33.67 2.06.86v.75c0 .83.67 1.5 1.5 1.5h1c.83 0 1.5-.67 1.5-1.5v-.75a7.95 7.95 0 0 0 2.06-.86l.54.53a1.5 1.5 0 0 0 2.12 0l.7-.7a1.5 1.5 0 0 0 0-2.12l-.53-.54c.38-.63.67-1.33.86-2.06h.75c.83 0 1.5-.67 1.5-1.5v-1c0-.83-.67-1.5-1.5-1.5h-.75a7.95 7.95 0 0 0-.86-2.06l.53-.54a1.5 1.5 0 0 0 0-2.12l-.7-.7a1.5 1.5 0 0 0-2.12 0l-.54.53A7.95 7.95 0 0 0 16 6.25V5.5c0-.83-.67-1.5-1.5-1.5h-1zM12 14a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm2-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
    </svg>
  );
}

function WidthIcon({ width }: { width: number }) {
  return (
    <svg className="drawing-properties__line-icon" viewBox={`0 0 18 ${width}`} aria-hidden="true">
      <rect width="18" height={width} rx={width / 2} fill="currentColor" />
    </svg>
  );
}

function StyleIcon({ style }: { style: number }) {
  if (style === LineStyle.Dotted) {
    return (
      <svg className="drawing-properties__style-icon" viewBox="0 0 28 28" aria-hidden="true">
        {[4, 9, 14, 19, 24].map((cx) => <circle key={cx} cx={cx} cy="14" r="1" fill="currentColor" />)}
      </svg>
    );
  }
  if (style === LineStyle.Dashed || style === LineStyle.LargeDashed) {
    const segments = style === LineStyle.LargeDashed
      ? [<path key="a" d="M3 13h9v1H3z" />, <path key="b" d="M16 13h9v1h-9z" />]
      : [4, 12, 20].map((x) => <path key={x} d={`M${x} 13h5v1h-5z`} />);
    return <svg className="drawing-properties__style-icon" viewBox="0 0 28 28" aria-hidden="true" fill="currentColor">{segments}</svg>;
  }
  return (
    <svg className="drawing-properties__style-icon" viewBox="0 0 28 28" aria-hidden="true">
      <path stroke="currentColor" d="M4 13.5h20" />
    </svg>
  );
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function DrawingPropertiesToolbar({
  drawing,
  anchor,
  onChange,
  onOpenSettings,
  onToggleLock,
  onDelete,
}: DrawingPropertiesToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const positionedDrawingIdRef = useRef<string | null>(null);
  const [position, setPosition] = useState({ left: -1, top: 48 });
  const [openMenu, setOpenMenu] = useState<PropertyMenu | null>(null);
  const line = toolLineOptions(drawing);
  const color = String(line?.value.color ?? "#2962ff");
  const width = Number(line?.value.width ?? 2);
  const style = Number(line?.value.style ?? LineStyle.Solid);
  const locked = drawing.options.editable === false;
  const icon = TOOL_ICONS[drawing.toolType] ?? "trend";

  useLayoutEffect(() => {
    if (positionedDrawingIdRef.current === drawing.id) return;
    const parent = toolbarRef.current?.parentElement;
    const toolbar = toolbarRef.current;
    if (!parent || !toolbar) return;
    positionedDrawingIdRef.current = drawing.id;

    const isTextTool = drawing.toolType === "Text" || drawing.toolType === "Callout";
    if (isTextTool && anchor) {
      const textRef = anchor.textAnchor ?? { x: anchor.right ?? anchor.centerX, y: anchor.top };
      const options = drawing.options as Record<string, unknown>;
      const textOptions = options.text as Record<string, unknown> | undefined;
      const textValue = String(textOptions?.value ?? "");
      const fontSize = Number((textOptions?.font as Record<string, unknown> | undefined)?.size ?? 14);
      const estimatedBoxWidth = Math.max(90, textValue.length * (fontSize * 0.75) + 40);
      const halfBoxWidth = estimatedBoxWidth / 2;

      // Diagonally down and to the right of text anchor
      const preferredLeft = Math.max(textRef.x + 24, textRef.x + halfBoxWidth + 12);
      const maxLeft = parent.clientWidth - toolbar.offsetWidth - 8;
      const fallbackLeft = Math.min(textRef.x - 24 - toolbar.offsetWidth, textRef.x - halfBoxWidth - toolbar.offsetWidth - 12);

      let left = preferredLeft;
      let top = textRef.y + 14;

      if (preferredLeft > maxLeft) {
        if (fallbackLeft >= 8) {
          left = fallbackLeft;
        } else {
          left = clamp(textRef.x - toolbar.offsetWidth / 2, 8, maxLeft);
          top = textRef.y + 36;
        }
      }

      setPosition({
        left: clamp(left, 8, maxLeft),
        top: clamp(top, 8, Math.max(8, parent.clientHeight - toolbar.offsetHeight - 8)),
      });
      return;
    }

    const fallbackLeft = (parent.clientWidth - toolbar.offsetWidth) / 2;
    const left = anchor ? anchor.centerX - toolbar.offsetWidth / 2 : fallbackLeft;
    const preferredTop = anchor ? anchor.top - toolbar.offsetHeight - 10 : 48;
    const top = anchor && preferredTop < 8 ? anchor.bottom + 10 : preferredTop;
    setPosition({
      left: clamp(left, 8, Math.max(8, parent.clientWidth - toolbar.offsetWidth - 8)),
      top: clamp(top, 8, Math.max(8, parent.clientHeight - toolbar.offsetHeight - 8)),
    });
  }, [
    anchor?.bottom,
    anchor?.centerX,
    anchor?.left,
    anchor?.right,
    anchor?.top,
    anchor?.textAnchor?.x,
    anchor?.textAnchor?.y,
    drawing.id,
    drawing.toolType,
    drawing.options,
  ]);

  useEffect(() => {
    const closeMenus = (event: globalThis.PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof globalThis.PointerEvent && toolbarRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    };
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeMenus);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeMenus);
    };
  }, []);

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

  const toggleMenu = (menu: PropertyMenu) => {
    setOpenMenu((current) => current === menu ? null : menu);
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY, ...position };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drag = (event: PointerEvent<HTMLButtonElement>) => {
    const origin = dragRef.current;
    const parent = toolbarRef.current?.parentElement;
    const toolbar = toolbarRef.current;
    if (!origin || !parent || !toolbar) return;
    setPosition({
      left: clamp(origin.left + event.clientX - origin.x, 0, parent.clientWidth - toolbar.offsetWidth),
      top: clamp(origin.top + event.clientY - origin.y, 0, parent.clientHeight - toolbar.offsetHeight),
    });
  };

  return (
    <div ref={toolbarRef} className="drawing-properties" style={{ left: position.left, top: position.top }} role="toolbar" aria-label="Thuộc tính bản vẽ đã chọn">
      <button className="drawing-properties__drag" aria-label="Di chuyển thanh thuộc tính" data-tooltip="Di chuyển thanh thuộc tính" onPointerDown={startDrag} onPointerMove={drag} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
        <VndIcon name="drag" />
      </button>

      {line && (
        <>
          <div className="drawing-properties__menu-wrap">
            <button className="drawing-properties__color-button" data-tooltip="Màu đường" aria-label="Chọn màu đường" aria-haspopup="menu" aria-expanded={openMenu === "color"} onClick={() => toggleMenu("color")}>
              <span className="drawing-properties__color-swatch" style={{ background: color }} />
            </button>
            {openMenu === "color" && (
              <div className="drawing-properties__menu drawing-properties__color-menu" role="menu" aria-label="Màu đường">
                {COLORS.map((value) => (
                  <button key={value} className={value.toLowerCase() === color.toLowerCase() ? "is-active" : ""} role="menuitemradio" aria-checked={value.toLowerCase() === color.toLowerCase()} aria-label={`Màu ${value}`} onClick={() => { updateLine({ color: value }); setOpenMenu(null); }}>
                    <span style={{ background: value }} />
                  </button>
                ))}
                <label className="drawing-properties__custom-color">
                  <span>Màu tùy chỉnh</span>
                  <input type="color" value={color.startsWith("#") ? color : "#2962ff"} onChange={(event) => updateLine({ color: event.target.value })} />
                </label>
              </div>
            )}
          </div>

          <div className="drawing-properties__menu-wrap">
            <button className="drawing-properties__control drawing-properties__control--width" aria-label="Chọn độ dày đường" aria-haspopup="menu" aria-expanded={openMenu === "width"} onClick={() => toggleMenu("width")}>
              <WidthIcon width={width} /><span>{width}px</span>
            </button>
            {openMenu === "width" && (
              <div className="drawing-properties__menu drawing-properties__option-menu" role="menu" aria-label="Độ dày đường">
                {[1, 2, 3, 4].map((value) => (
                  <button key={value} className={value === width ? "is-active" : ""} role="menuitemradio" aria-checked={value === width} onClick={() => { updateLine({ width: value }); setOpenMenu(null); }}>
                    <WidthIcon width={value} /><span>{value}px</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="drawing-properties__menu-wrap">
            <button className="drawing-properties__control drawing-properties__control--style" aria-label="Chọn kiểu đường" aria-haspopup="menu" aria-expanded={openMenu === "style"} onClick={() => toggleMenu("style")}>
              <StyleIcon style={style} />
            </button>
            {openMenu === "style" && (
              <div className="drawing-properties__menu drawing-properties__option-menu drawing-properties__style-menu" role="menu" aria-label="Kiểu đường">
                {LINE_STYLES.map((item) => (
                  <button key={item.value} className={item.value === style ? "is-active" : ""} role="menuitemradio" aria-checked={item.value === style} onClick={() => { updateLine({ style: item.value }); setOpenMenu(null); }}>
                    <StyleIcon style={item.value} /><span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="drawing-properties__menu-wrap">
        <button className="drawing-properties__icon-button" data-tooltip="Cài đặt" aria-label="Mở cài đặt bản vẽ" aria-expanded={openMenu === "settings"} onClick={() => { if (drawing.toolType === "Text") onOpenSettings(); else toggleMenu("settings"); }}>
          <SettingsIcon />
        </button>
        {openMenu === "settings" && (
          <div className="drawing-properties__menu drawing-properties__settings" role="dialog" aria-label="Cài đặt bản vẽ">
            <strong>Cài đặt bản vẽ</strong>
            {line ? (
              <>
                <label>Màu đường <input type="color" value={color.startsWith("#") ? color : "#2962ff"} onChange={(event) => updateLine({ color: event.target.value })} /></label>
                <label>Độ dày <input type="range" min="1" max="4" value={width} onChange={(event) => updateLine({ width: Number(event.target.value) })} /></label>
              </>
            ) : <span>Thuộc tính được chỉnh trực tiếp trên thanh công cụ.</span>}
          </div>
        )}
      </div>

      <button className="drawing-properties__icon-button" data-tooltip={locked ? "Mở khóa" : "Khóa"} aria-label={locked ? "Mở khóa bản vẽ" : "Khóa bản vẽ"} onClick={onToggleLock}><VndIcon name={locked ? "lock" : "unlock"} /></button>
      <button className="drawing-properties__icon-button" data-tooltip="Xóa" aria-label="Xóa bản vẽ" onClick={onDelete}><VndIcon name="trash" /></button>

      <div className="drawing-properties__menu-wrap">
        <button className="drawing-properties__icon-button" data-tooltip="Thêm" aria-label="Thêm tùy chọn" aria-haspopup="menu" aria-expanded={openMenu === "more"} onClick={() => toggleMenu("more")}><VndIcon name="more" /></button>
        {openMenu === "more" && (
          <div className="drawing-properties__menu drawing-properties__more-menu" role="menu">
            <button role="menuitem" onClick={() => { setOpenMenu(null); onToggleLock(); }}><VndIcon name={locked ? "lock" : "unlock"} /><span>{locked ? "Mở khóa bản vẽ" : "Khóa bản vẽ"}</span></button>
            <button role="menuitem" className="danger" onClick={() => { setOpenMenu(null); onDelete(); }}><VndIcon name="trash" /><span>Xóa bản vẽ</span></button>
          </div>
        )}
      </div>
    </div>
  );
}
