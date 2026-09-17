import { useEffect, useRef, useState } from "react";
import { LineStyle } from "lightweight-charts";
import type { TextOptions } from "lightweight-charts-line-tools-core";

interface TextToolDialogProps {
  text: TextOptions;
  onCancel: () => void;
  onConfirm: (text: TextOptions) => void;
}

export function TextToolDialog({ text, onCancel, onConfirm }: TextToolDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(() => structuredClone(text));
  const [tab, setTab] = useState<"text" | "visibility">("text");

  useEffect(() => {
    textareaRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  const updateFont = (patch: Partial<TextOptions["font"]>) => {
    setDraft((current) => ({ ...current, font: { ...current.font, ...patch } }));
  };

  const toggleBackground = () => {
    setDraft((current) => ({
      ...current,
      box: {
        ...current.box,
        background: current.box.background
          ? undefined
          : { color: "rgba(32, 38, 51, 0.88)", inflation: { x: 4, y: 4 } },
      },
    }));
  };

  const toggleBorder = () => {
    setDraft((current) => ({
      ...current,
      box: {
        ...current.box,
        border: current.box.border
          ? undefined
          : { color: "#596273", width: 1, radius: 2, highlight: false, style: LineStyle.Solid },
      },
    }));
  };

  return (
    <div className="drawing-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section className="text-tool-dialog" role="dialog" aria-modal="true" aria-labelledby="text-tool-title">
        <header>
          <h2 id="text-tool-title">Văn bản <span aria-hidden="true">✎</span></h2>
          <button type="button" aria-label="Đóng cài đặt văn bản" data-tooltip="Đóng" onClick={onCancel}>×</button>
        </header>
        <nav className="text-tool-tabs" aria-label="Nhóm cài đặt">
          <button className={tab === "text" ? "active" : ""} onClick={() => setTab("text")}>Văn bản</button>
          <button className={tab === "visibility" ? "active" : ""} onClick={() => setTab("visibility")}>Hiển thị</button>
        </nav>

        {tab === "text" ? (
          <div className="text-tool-dialog__body">
            <div className="text-tool-formatting">
              <label className="text-tool-color" data-tooltip="Màu chữ">
                <input type="color" aria-label="Màu chữ" value={draft.font.color} onChange={(event) => updateFont({ color: event.target.value })} />
              </label>
              <select aria-label="Cỡ chữ" value={draft.font.size} onChange={(event) => updateFont({ size: Number(event.target.value) })}>
                {[10, 12, 14, 16, 18, 20, 24, 28, 32].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
              <button className={draft.font.bold ? "active" : ""} aria-label="Chữ đậm" aria-pressed={draft.font.bold} onClick={() => updateFont({ bold: !draft.font.bold })}><strong>B</strong></button>
              <button className={draft.font.italic ? "active" : ""} aria-label="Chữ nghiêng" aria-pressed={draft.font.italic} onClick={() => updateFont({ italic: !draft.font.italic })}><em>I</em></button>
            </div>
            <textarea ref={textareaRef} value={draft.value} aria-label="Nội dung văn bản" onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))} />
            <label className="text-tool-option">
              <input type="checkbox" checked={Boolean(draft.box.background)} onChange={toggleBackground} />
              <span>Hình nền</span>
              <i style={{ background: draft.box.background?.color ?? "transparent" }} />
            </label>
            <label className="text-tool-option">
              <input type="checkbox" checked={Boolean(draft.box.border)} onChange={toggleBorder} />
              <span>Đường viền</span>
              <i style={{ background: draft.box.border?.color ?? "transparent" }} />
            </label>
            <label className="text-tool-option">
              <input type="checkbox" checked={draft.wordWrapWidth > 0} onChange={(event) => setDraft((current) => ({ ...current, wordWrapWidth: event.target.checked ? 240 : 0 }))} />
              <span>Tự động xuống dòng</span>
            </label>
          </div>
        ) : (
          <div className="text-tool-dialog__body text-tool-visibility">
            Văn bản hiển thị trên tất cả khung thời gian.
          </div>
        )}

        <footer>
          <select aria-label="Bản mẫu văn bản" defaultValue="default"><option value="default">Bản mẫu</option></select>
          <span />
          <button className="dialog-button dialog-button--secondary" onClick={onCancel}>Hủy bỏ</button>
          <button className="dialog-button dialog-button--primary" onClick={() => onConfirm(draft)}>Ok</button>
        </footer>
      </section>
    </div>
  );
}
