import type { LineToolType } from "lightweight-charts-line-tools-core";
import { DRAWING_TOOLS } from "./chart-config";

interface DrawingToolbarProps {
  locked: boolean;
  onStartDrawing: (type: LineToolType) => void;
  onUndo: () => void;
  onToggleLock: () => void;
  onDeleteSelected: () => void;
  onClear: () => void;
}

export function DrawingToolbar({ locked, onStartDrawing, onUndo, onToggleLock, onDeleteSelected, onClear }: DrawingToolbarProps) {
  return (
    <aside className="drawing-toolbar" aria-label="Drawing tools">
      {DRAWING_TOOLS.map((tool) => (
        <button className="toolbar-button" key={tool.type} title={tool.title} aria-label={tool.title} onClick={() => onStartDrawing(tool.type)} disabled={locked}>
          {tool.label}
        </button>
      ))}
      <span className="toolbar-divider" />
      <button className="toolbar-button" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={onUndo}>↶</button>
      <button
        className={`toolbar-button ${locked ? "toolbar-button--active" : ""}`}
        title={locked ? "Unlock drawings" : "Lock drawings"}
        aria-label={locked ? "Unlock drawings" : "Lock drawings"}
        onClick={onToggleLock}
      >
        {locked ? "🔒" : "🔓"}
      </button>
      <button className="toolbar-button" title="Delete selected drawing" aria-label="Delete selected drawing" onClick={onDeleteSelected}>⌫</button>
      <button className="toolbar-button toolbar-button--danger" title="Clear drawings for this symbol and timeframe" aria-label="Clear drawings" onClick={onClear}>×</button>
    </aside>
  );
}
