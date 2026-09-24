import { useEffect, useState } from "react";
import type { PriceScaleMode } from "lightweight-charts";

export type PriceAxisMenuAction =
  | "reset" | "auto" | "lock" | "seriesOnly" | "invert"
  | "normal" | "percent" | "indexed" | "log" | "move"
  | "symbolLabels" | "seriesValue" | "highLowLabels" | "studyNames"
  | "studyValues" | "alignLabels" | "priceLine" | "highLowLines" | "countdown";

export interface PriceAxisMenuState {
  x: number;
  y: number;
  side: "left" | "right";
  paneIndex: number;
}

interface PriceAxisContextMenuProps {
  position: PriceAxisMenuState;
  mode: PriceScaleMode;
  autoScale: boolean;
  inverted: boolean;
  locked: boolean;
  seriesOnly: boolean;
  labels: {
    symbol: boolean;
    seriesValue: boolean;
    highLow: boolean;
    studyNames: boolean;
    studyValues: boolean;
    align: boolean;
  };
  lines: { price: boolean; highLow: boolean };
  countdown: boolean;
  isMainAxis: boolean;
  onAction: (action: PriceAxisMenuAction) => void;
  onClose: () => void;
}

type MenuItem = {
  id: PriceAxisMenuAction;
  label: string;
  checked?: boolean;
  disabled?: boolean;
  shortcut?: string;
};

function Check({ checked }: { checked?: boolean }) {
  return <span className="price-axis-menu__check" aria-hidden="true">{checked ? "✓" : ""}</span>;
}

export function PriceAxisContextMenu({
  position, mode, autoScale, inverted, locked, seriesOnly, labels, lines,
  countdown, isMainAxis, onAction, onClose,
}: PriceAxisContextMenuProps) {
  const [submenu, setSubmenu] = useState<"labels" | "lines" | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".price-axis-menu")) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  const run = (id: PriceAxisMenuAction) => {
    onAction(id);
    onClose();
  };
  const renderItem = ({ id, label, checked, disabled, shortcut }: MenuItem) => (
    <button
      key={id}
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked === undefined ? undefined : checked}
      disabled={disabled}
      tabIndex={-1}
      className="price-axis-menu__item"
      onClick={() => run(id)}
    >
      <Check checked={checked} />
      <span className="price-axis-menu__label">{label}</span>
      {shortcut && <span className="price-axis-menu__shortcut">{shortcut}</span>}
    </button>
  );
  const labelItems: MenuItem[] = [
    { id: "symbolLabels", label: "Biểu tượng Nhãn tên", checked: labels.symbol },
    { id: "seriesValue", label: "Biểu tượng Nhãn giá trị cuối cùng", checked: labels.seriesValue },
    { id: "highLowLabels", label: "Nhãn giá cao và thấp", checked: labels.highLow },
    { id: "studyNames", label: "Nhãn tên chỉ số", checked: labels.studyNames },
    { id: "studyValues", label: "Các chỉ báo giá trị nhãn", checked: labels.studyValues },
    { id: "alignLabels", label: "Không có Nhãn chồng chéo", checked: labels.align },
  ];
  const lineItems: MenuItem[] = [
    { id: "priceLine", label: "Đường Giá", checked: lines.price },
    { id: "highLowLines", label: "Dòng giá cao và thấp", checked: lines.highLow },
  ];
  const menuLeft = Math.max(8, Math.min(position.x, window.innerWidth - 368));
  const menuTop = Math.max(8, Math.min(position.y, window.innerHeight - 600));
  const submenuToRight = menuLeft < 380;

  return (
    <div
      className={`price-axis-menu ${submenuToRight ? "price-axis-menu--submenu-right" : ""}`}
      role="menu"
      aria-label="Price scale options"
      style={{ left: menuLeft, top: menuTop }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {renderItem({ id: "reset", label: "Đặt lại Thang giá", shortcut: "Alt + R" })}
      <div className="price-axis-menu__divider" />
      {renderItem({ id: "auto", label: "Tự động (khớp Dữ liệu với Màn hình)", checked: autoScale })}
      {isMainAxis && renderItem({ id: "lock", label: "Khoá Hệ số Giá trên Thanh", checked: locked })}
      {renderItem({ id: "seriesOnly", label: "Chia tỷ lệ Chỉ Biểu đồ Giá", checked: seriesOnly })}
      {renderItem({ id: "invert", label: "Mức Đảo ngược", checked: inverted })}
      <div className="price-axis-menu__divider" />
      {renderItem({ id: "normal", label: "Đều đặn", checked: mode === 0, disabled: locked })}
      {renderItem({ id: "percent", label: "Phần trăm", checked: mode === 2, shortcut: "Alt + P", disabled: locked })}
      {renderItem({ id: "indexed", label: "Lập chỉ mục tới 100", checked: mode === 3, disabled: locked })}
      {renderItem({ id: "log", label: "Logarit", checked: mode === 1, shortcut: "Alt + L", disabled: locked })}
      <div className="price-axis-menu__divider" />
      {renderItem({ id: "move", label: `Chuyển Thang giá sang ${position.side === "right" ? "Trái" : "Phải"}` })}
      <div className="price-axis-menu__divider" />
      {([
        ["labels", "Nhãn", labelItems],
        ["lines", "Đường", lineItems],
      ] as const).map(([id, label, items]) => (
        <div key={id} className="price-axis-menu__submenu-wrap" onMouseEnter={() => setSubmenu(id)} onMouseLeave={() => setSubmenu(null)}>
          <button type="button" role="menuitem" tabIndex={-1} className="price-axis-menu__item" aria-haspopup="menu" aria-expanded={submenu === id} onClick={() => setSubmenu(submenu === id ? null : id)}>
            <Check />
            <span className="price-axis-menu__label">{label}</span>
            <span className="price-axis-menu__chevron" aria-hidden="true">›</span>
          </button>
          {submenu === id && <div className="price-axis-menu__submenu" role="menu" aria-label={label}>{items.map(renderItem)}</div>}
        </div>
      ))}
      {renderItem({ id: "countdown", label: "Đếm ngược tới khi Đóng Thanh", checked: countdown })}
    </div>
  );
}
