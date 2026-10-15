import type { SavedPanePresentation } from "../panes/pane-presentation";

export function restoredSourcePanes(sources: { id: string; pane: number; anchor?: string }[], saved: { id: string; pane: number }[], paneCount: number) {
  const assignments = new Map(saved.map((source) => [source.id, source.pane]));
  const existing = new Map<number, number>();
  for (const source of sources) {
    const pane = assignments.get(source.anchor ?? source.id);
    if (pane !== undefined && !existing.has(source.pane)) existing.set(source.pane, pane);
  }
  return new Map(sources.map((source) => [source.id,
    assignments.get(source.anchor ?? source.id) ?? existing.get(source.pane) ?? paneCount + source.pane,
  ]));
}

export function occupiedPaneLayout(sourcePanes: number[], saved: SavedPanePresentation) {
  const occupied = [...new Set(sourcePanes)].sort((a, b) => a - b);
  return {
    occupied,
    presentation: {
      collapsed: occupied.flatMap((original, index) => saved.collapsed.includes(original) ? [index] : []),
      maximized: saved.maximized !== null && occupied.includes(saved.maximized) ? occupied.indexOf(saved.maximized) : null,
      factors: occupied.map((original) => saved.factors[original] ?? 1),
    },
  };
}
