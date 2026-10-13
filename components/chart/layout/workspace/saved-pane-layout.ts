import type { SavedPanePresentation } from "../panes/pane-presentation";

export function occupiedPaneLayout(sourcePanes: number[], saved: SavedPanePresentation) {
  const occupied = [...new Set(sourcePanes)].sort((a, b) => a - b);
  return {
    occupied,
    presentation: {
      collapsed: occupied.flatMap((original, index) => saved.collapsed.includes(original) ? [index] : []),
      maximized: saved.maximized !== null && occupied.includes(saved.maximized) ? occupied.indexOf(saved.maximized) : null,
      factors: occupied.map((original) => saved.factors[original]),
    },
  };
}
