import type { IChartApi } from "lightweight-charts";

export type Pane = ReturnType<IChartApi["panes"]>[number];
export interface PanePresentation {
  hidden: number[];
  collapsed: number[];
}

const COLLAPSED_HEIGHT = 33;
const HIDDEN_HEIGHT = 2;
const SEPARATOR_HEIGHT = 1;
const controllers = new WeakMap<IChartApi, PanePresentationController>();
export interface SavedPanePresentation { collapsed: number[]; maximized: number | null; factors: number[] }
export function paneController(chart: IChartApi) { return controllers.get(chart); }

export class PanePresentationController {
  readonly collapsed = new Set<Pane>();
  maximized: Pane | null = null;
  private factors = new Map<Pane, number>();
  private autoSize: boolean | null = null;
  private frame = 0;
  private disposed = false;
  private observer: ResizeObserver;

  constructor(private chart: IChartApi, private changed: (state: PanePresentation) => void) {
    controllers.set(chart, this);
    this.observer = new ResizeObserver(() => this.refresh());
    const container = chart.chartElement().parentElement;
    if (container) this.observer.observe(container);
  }

  canCollapse() {
    return this.chart.panes().filter((pane) => !this.collapsed.has(pane)).length > 1;
  }

  snapshot(): SavedPanePresentation {
    const panes = this.chart.panes();
    return { collapsed: panes.flatMap((pane, index) => this.collapsed.has(pane) ? [index] : []), maximized: this.maximized ? panes.indexOf(this.maximized) : null, factors: panes.map((pane) => this.factors.get(pane) ?? pane.getStretchFactor()) };
  }

  restore(saved: SavedPanePresentation) {
    const panes = this.chart.panes();
    this.collapsed.clear();
    this.factors.clear();
    panes.forEach((pane, index) => {
      const factor = saved.factors[index];
      if (Number.isFinite(factor) && factor > 0) { pane.setStretchFactor(factor); this.factors.set(pane, factor); }
      if (saved.collapsed.includes(index)) this.collapsed.add(pane);
    });
    this.maximized = saved.maximized === null ? null : panes[saved.maximized] ?? null;
    this.refresh();
  }

  toggleCollapsed(pane: Pane) {
    if (this.disposed || this.maximized || this.chart.panes().length < 2 || !this.chart.panes().includes(pane)) return;
    if (this.collapsed.has(pane)) this.collapsed.delete(pane);
    else if (this.canCollapse()) this.collapsed.add(pane);
    this.refresh();
  }

  toggleMaximized(pane: Pane) {
    if (this.disposed || this.chart.panes().length < 2 || !this.chart.panes().includes(pane)) return;
    this.maximized = this.maximized ? null : pane;
    this.refresh();
  }

  refresh() {
    if (this.disposed) return;
    const panes = this.chart.panes();
    if (!panes.length) return;
    for (const pane of this.collapsed) if (!panes.includes(pane)) this.collapsed.delete(pane);
    for (const pane of this.factors.keys()) if (!panes.includes(pane)) this.factors.delete(pane);
    if (this.maximized && (!panes.includes(this.maximized) || panes.length < 2)) this.maximized = null;
    if (panes.every((pane) => this.collapsed.has(pane))) this.collapsed.delete(panes[0]);

    const element = this.chart.chartElement();
    const container = element.parentElement;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const special = Boolean(this.maximized || this.collapsed.size);
    if (special) {
      for (const pane of panes) if (!this.factors.has(pane)) this.factors.set(pane, pane.getStretchFactor());
    }

    const separators = (panes.length - 1) * SEPARATOR_HEIGHT;
    const plotHeight = Math.max(2, height - this.chart.timeScale().height());
    if (this.maximized) {
      if (this.autoSize === null) {
        this.autoSize = this.chart.options().autoSize;
        this.chart.applyOptions({ autoSize: false });
      }
      // Bù chiều cao tối thiểu của thư viện trước khi ẩn hàng và đường phân cách.
      for (const pane of panes) pane.setStretchFactor(pane === this.maximized ? plotHeight : HIDDEN_HEIGHT);
      this.decorate();
      this.chart.resize(width, height + (panes.length - 1) * (HIDDEN_HEIGHT + SEPARATOR_HEIGHT), true);
    } else {
      if (this.collapsed.size) {
        const available = Math.max(2, plotHeight - separators);
        const headerHeight = Math.min(COLLAPSED_HEIGHT, Math.max(2, (available - 2) / this.collapsed.size));
        const remaining = Math.max(2, available - headerHeight * this.collapsed.size);
        const total = panes.reduce((sum, pane) => sum + (this.collapsed.has(pane) ? 0 : this.factors.get(pane) ?? 1), 0);
        for (const pane of panes) pane.setStretchFactor(this.collapsed.has(pane) ? headerHeight : remaining * (this.factors.get(pane) ?? 1) / total);
      } else if (this.factors.size) {
        for (const pane of panes) pane.setStretchFactor(this.factors.get(pane) ?? pane.getStretchFactor());
        this.factors.clear();
      }
      this.decorate();
      if (this.autoSize !== null) {
        const autoSize = this.autoSize;
        this.autoSize = null;
        this.chart.resize(width, height, true);
        this.chart.applyOptions({ autoSize });
      }
    }

    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (this.disposed) return;
      const currentPanes = this.chart.panes();
      this.decorate();
      this.changed({
        hidden: currentPanes.flatMap((pane, index) => this.maximized && pane !== this.maximized ? [index] : []),
        collapsed: currentPanes.flatMap((pane, index) => !this.maximized && this.collapsed.has(pane) ? [index] : []),
      });
    });
  }

  private decorate() {
    const element = this.chart.chartElement();
    element.querySelectorAll(".chart-pane-hidden, .chart-pane-collapsed").forEach((node) => node.classList.remove("chart-pane-hidden", "chart-pane-collapsed"));
    const panes = this.chart.panes();
    panes.forEach((pane, index) => {
      const row = pane.getHTMLElement();
      if (!row) return;
      row.classList.toggle("chart-pane-hidden", Boolean(this.maximized && pane !== this.maximized));
      row.classList.toggle("chart-pane-collapsed", !this.maximized && this.collapsed.has(pane));
      if (index > 0) row.previousElementSibling?.classList.toggle("chart-pane-hidden", Boolean(this.maximized));
    });
  }

  dispose() {
    if (controllers.get(this.chart) === this) controllers.delete(this.chart);
    this.disposed = true;
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    // Thành phần cha có thể đã hủy biểu đồ trước khi tháo bộ điều khiển.
    const element = this.chart.chartElement();
    if (!element.isConnected) return;
    element.querySelectorAll(".chart-pane-hidden, .chart-pane-collapsed").forEach((node) => node.classList.remove("chart-pane-hidden", "chart-pane-collapsed"));
    for (const pane of this.chart.panes()) if (this.factors.has(pane)) pane.setStretchFactor(this.factors.get(pane)!);
    if (this.autoSize !== null) {
      const container = element.parentElement;
      if (container) this.chart.resize(container.clientWidth, container.clientHeight);
      this.chart.applyOptions({ autoSize: this.autoSize });
    }
  }
}
