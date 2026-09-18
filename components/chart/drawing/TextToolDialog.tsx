import { useEffect, useRef, useState } from "react";
import { LineStyle } from "lightweight-charts";
import type { TextOptions } from "lightweight-charts-line-tools-core";

interface TextToolDialogProps {
  text: TextOptions;
  onCancel: () => void;
  onConfirm: (text: TextOptions) => void;
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10.5 2.5l3 3L4.75 14.25H1.75v-3L10.5 2.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 3.5l9 9M12.5 3.5l-9 9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
      <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TextToolDialog({ text, onCancel, onConfirm }: TextToolDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(() => {
    const base = text ? structuredClone(text) : ({} as TextOptions);
    return {
      value: base.value ?? "Văn bản",
      font: {
        color: base.font?.color ?? "#2962ff",
        size: base.font?.size ?? 14,
        bold: base.font?.bold ?? false,
        italic: base.font?.italic ?? false,
        family: base.font?.family ?? "sans-serif",
      },
      box: {
        ...(base.box ?? {}),
        scale: base.box?.scale ?? 1,
        angle: base.box?.angle ?? 0,
        alignment: base.box?.alignment ?? { vertical: 0, horizontal: 0 },
      },
      wordWrapWidth: base.wordWrapWidth ?? 0,
      padding: base.padding ?? 0,
      forceTextAlign: false,
      forceCalculateMaxLineWidth: false,
      alignment: base.alignment ?? 1,
    } as TextOptions;
  });
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
    setDraft((current) => {
      const currentBg = current.box?.background;
      return {
        ...current,
        box: {
          ...current.box,
          background: currentBg
            ? undefined
            : { color: "rgba(32, 38, 51, 0.88)", inflation: { x: 4, y: 4 } },
        },
      };
    });
  };

  const toggleBorder = () => {
    setDraft((current) => {
      const currentBorder = current.box?.border;
      return {
        ...current,
        box: {
          ...current.box,
          border: currentBorder
            ? undefined
            : { color: "#596273", width: 1, radius: 2, highlight: false, style: LineStyle.Solid },
        },
      };
    });
  };

  return (
    <div className="drawing-dialog-backdrop" role="presentation">
      <section className="text-tool-dialog" role="dialog" aria-modal="true" aria-labelledby="text-tool-title">
        <header className="text-tool-header">
          <h2 id="text-tool-title" className="text-tool-title">
            Văn bản
            <span className="text-tool-pencil-icon" aria-hidden="true"><PencilIcon /></span>
          </h2>
          <button type="button" className="text-tool-close-btn" aria-label="Đóng cài đặt văn bản" onClick={onCancel}>
            <CloseIcon />
          </button>
        </header>

        <nav className="text-tool-tabs" aria-label="Nhóm cài đặt">
          <button className={`text-tool-tab ${tab === "text" ? "is-active" : ""}`} onClick={() => setTab("text")}>
            Văn bản
          </button>
          <button className={`text-tool-tab ${tab === "visibility" ? "is-active" : ""}`} onClick={() => setTab("visibility")}>
            Hiển thị
          </button>
        </nav>

        {tab === "text" ? (
          <div className="text-tool-dialog__body">
            <div className="text-tool-formatting">
              <label className="text-tool-color-btn" data-tooltip="Màu chữ">
                <span className="text-tool-color-swatch" style={{ background: draft.font.color }} />
                <input
                  type="color"
                  aria-label="Màu chữ"
                  value={draft.font.color}
                  onChange={(event) => updateFont({ color: event.target.value })}
                />
              </label>

              <div className="text-tool-select-box text-tool-size-select">
                <select
                  aria-label="Cỡ chữ"
                  value={draft.font.size}
                  onChange={(event) => updateFont({ size: Number(event.target.value) })}
                >
                  {[10, 12, 14, 16, 18, 20, 24, 28, 32].map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
                <span className="text-tool-select-chevron"><ChevronIcon /></span>
              </div>

              <button
                type="button"
                className={`text-tool-format-btn ${draft.font.bold ? "is-active" : ""}`}
                aria-label="Chữ đậm"
                aria-pressed={draft.font.bold}
                onClick={() => updateFont({ bold: !draft.font.bold })}
              >
                <strong>B</strong>
              </button>
              <button
                type="button"
                className={`text-tool-format-btn text-tool-format-btn--italic ${draft.font.italic ? "is-active" : ""}`}
                aria-label="Chữ nghiêng"
                aria-pressed={draft.font.italic}
                onClick={() => updateFont({ italic: !draft.font.italic })}
              >
                <em>I</em>
              </button>
            </div>

            <textarea
              ref={textareaRef}
              value={draft.value}
              aria-label="Nội dung văn bản"
              onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
            />

            <div className="text-tool-options-list">
              <label className="text-tool-option-row">
                <input
                  type="checkbox"
                  className="text-tool-checkbox"
                  checked={Boolean(draft.box?.background)}
                  onChange={toggleBackground}
                />
                <span className="text-tool-option-label">Hình nền</span>
                <span className={`text-tool-preview-box ${draft.box?.background ? "" : "text-tool-preview-box--transparent"}`}>
                  {draft.box?.background && (
                    <span className="text-tool-preview-fill" style={{ background: draft.box.background.color }} />
                  )}
                </span>
              </label>

              <label className="text-tool-option-row">
                <input
                  type="checkbox"
                  className="text-tool-checkbox"
                  checked={Boolean(draft.box?.border)}
                  onChange={toggleBorder}
                />
                <span className="text-tool-option-label">Đường viền</span>
                <span className="text-tool-preview-box">
                  {draft.box?.border && (
                    <span
                      className="text-tool-preview-border"
                      style={{ borderColor: draft.box.border.color ?? "#596273" }}
                    />
                  )}
                </span>
              </label>

              <label className="text-tool-option-row">
                <input
                  type="checkbox"
                  className="text-tool-checkbox"
                  checked={draft.wordWrapWidth > 0}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      wordWrapWidth: event.target.checked ? 240 : 0,
                    }))
                  }
                />
                <span className="text-tool-option-label">Tự động xuống dòng</span>
              </label>
            </div>
          </div>
        ) : (
          <div className="text-tool-dialog__body text-tool-visibility">
            Văn bản hiển thị trên tất cả khung thời gian.
          </div>
        )}

        <footer className="text-tool-footer">
          <div className="text-tool-select-box text-tool-template-select">
            <select aria-label="Bản mẫu văn bản" defaultValue="default">
              <option value="default">Bản mẫu</option>
            </select>
            <span className="text-tool-select-chevron"><ChevronIcon /></span>
          </div>
          <div className="text-tool-footer-actions">
            <button type="button" className="dialog-btn dialog-btn--secondary" onClick={onCancel}>
              Hủy bỏ
            </button>
            <button type="button" className="dialog-btn dialog-btn--primary" onClick={() => onConfirm(draft)}>
              Ok
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
