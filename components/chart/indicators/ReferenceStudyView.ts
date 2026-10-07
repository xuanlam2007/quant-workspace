import { customSeriesDefaultOptions, type CustomSeriesOptions, type CustomSeriesWhitespaceData, type ICustomSeriesPaneRenderer, type ICustomSeriesPaneView, type PaneRendererCustomData, type Time } from "lightweight-charts";
import { referenceColor, type ReferenceDefinition, type ReferenceGraphics, type ReferencePoint, type ReferenceSettings } from "@/lib/reference-studies";

export class ReferenceStudyView implements ICustomSeriesPaneView<Time, ReferencePoint>, ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, ReferencePoint> | null = null;
  graphics: ReferenceGraphics[] = [];
  selected = false;
  marksHidden = false;

  constructor(readonly definition: ReferenceDefinition, public settings: ReferenceSettings) {}

  renderer() { return this; }
  defaultOptions(): CustomSeriesOptions { return { ...customSeriesDefaultOptions, color: "#2196f3", priceLineVisible: false, baseLineVisible: false }; }
  update(data: PaneRendererCustomData<Time, ReferencePoint>) { this.data = data; }
  isWhitespace(data: ReferencePoint | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> { return !("values" in data) || !this.priceValueBuilder(data).some(Number.isFinite); }
  priceValueBuilder(point: ReferencePoint): number[] {
    const fillPlots = new Set((this.definition.metainfo.filledAreas ?? []).filter((fill) => this.settings.fills[fill.id]?.visible !== false).flatMap((fill) => [fill.objAId, fill.objBId]));
    const values = this.definition.metainfo.plots.filter((plot) => plot.type === "line" && (fillPlots.has(plot.id) || this.settings.styles[plot.id]?.visible !== false && this.settings.styles[plot.id]?.display !== 0)).map((plot) => point.values[plot.id]).filter(Number.isFinite);
    this.definition.metainfo.plots.forEach((plot) => {
      const style = this.settings.styles[plot.id];
      if (style?.visible !== false && style?.display !== 0 && [1, 5].includes(Number(style?.plottype)) && Number.isFinite(point.values[plot.id])) {
        values.push(this.definition.metainfo.styles?.[plot.id]?.histogramBase ?? 0);
      }
    });
    this.settings.bands.forEach((band) => { if (band.visible !== false && Number.isFinite(band.value)) values.push(band.value); });
    for (const graphic of this.graphics) {
      for (const group of graphic.graphicsCmds?.create?.horizlines ?? []) {
        if (this.definition.metainfo.defaults.graphics?.horizlines?.[group.styleId]?.visible === false) continue;
        for (const item of group.data) if (Number.isFinite(Number(item.level))) values.push(Number(item.level));
      }
    }
    if (!values.length && this.definition.metainfo.is_price_study) values.push(point.high, point.low);
    if (!values.length) return [NaN, NaN, NaN];
    return [Math.min(...values), Math.max(...values), values[0]];
  }

  draw(target: Parameters<ICustomSeriesPaneRenderer["draw"]>[0], convert: Parameters<ICustomSeriesPaneRenderer["draw"]>[1], hovered: boolean) {
    const data = this.data;
    if (!data?.visibleRange || !data.bars.length) return;
    const { plots, styles: metaStyles, filledAreas } = this.definition.metainfo;
    const { styles, bands, fills } = this.settings;
    const start = Math.max(0, data.visibleRange.from - 1), end = Math.min(data.bars.length, data.visibleRange.to + 1);
    const visible = data.bars.slice(start, end);
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const y = (value: number) => Number.isFinite(value) ? convert(value) : null;
      const dash = (style?: number) => ctx.setLineDash(style === 1 ? [2, 2] : style === 2 ? [6, 4] : style === 3 ? [6, 3, 2, 3] : style === 4 ? [2, 4] : []);
      const color = (id: string, point: ReferencePoint) => point.colors[id] ?? referenceColor(styles[id]?.color, styles[id]?.transparency);
      const fillValue = (id: string, point: ReferencePoint) => id.startsWith("hline_") || id.startsWith("band_") ? bands[Number(id.split("_").at(-1))]?.value : point.values[id];
      ctx.save();
      for (const fill of filledAreas ?? []) {
        const style = fills[fill.id];
        if (!style || style.visible === false) continue;
        const colored = plots.some((plot) => plot.type === "colorer" && plot.target === fill.id);
        for (let i = 1; i < visible.length; i++) {
          const previous = visible[i - 1], current = visible[i];
          const segmentColor = previous.originalData.colors[fill.id];
          if (colored && !segmentColor) continue;
          ctx.fillStyle = segmentColor ?? referenceColor(style.color, style.transparency ?? 90);
          const a = y(fillValue(fill.objAId, previous.originalData)), b = y(fillValue(fill.objBId, previous.originalData));
          const c = y(fillValue(fill.objAId, current.originalData)), d = y(fillValue(fill.objBId, current.originalData));
          if (a === null || b === null || c === null || d === null) continue;
          ctx.beginPath(); ctx.moveTo(previous.x, a); ctx.lineTo(current.x, c); ctx.lineTo(current.x, d); ctx.lineTo(previous.x, b); ctx.closePath(); ctx.fill();
        }
      }
      bands.forEach((band) => {
        const position = y(band.value);
        if (band.visible === false || position === null) return;
        ctx.strokeStyle = referenceColor(band.color ?? "#787b86", band.transparency); ctx.lineWidth = band.linewidth ?? 1; dash(band.linestyle);
        ctx.beginPath(); ctx.moveTo(0, position); ctx.lineTo(mediaSize.width, position); ctx.stroke();
      });
      for (const plot of plots) {
        const style = styles[plot.id];
        if (!style || style.visible === false || style.display === 0 || !["line", "shapes", "arrows"].includes(plot.type)) continue;
        const kind = style.plottype ?? 0, width = style.linewidth ?? 1, base = y(metaStyles?.[plot.id]?.histogramBase ?? 0) ?? mediaSize.height;
        ctx.lineWidth = width; dash(style.linestyle);
        let previous: { x: number; y: number } | null = null;
        for (let index = 0; index < visible.length; index++) {
          const bar = visible[index], point = bar.originalData, value = point.values[plot.id];
          const position = y(value);
          if (position === null) { if ([7, 8, 11].includes(Number(kind))) previous = null; continue; }
          ctx.strokeStyle = color(plot.id, point); ctx.fillStyle = ctx.strokeStyle;
          if (plot.type === "shapes" || plot.type === "arrows") {
            if (!value) continue;
            const below = style.location === "BelowBar" || String(kind).includes("up");
            const anchor = y(below ? point.low : point.high);
            const shapeY = style.location === "Absolute" ? position : (anchor ?? position) + (below ? 9 : -9);
            ctx.beginPath();
            if (String(kind).includes("circle")) ctx.arc(bar.x, shapeY, 3, 0, Math.PI * 2);
            else if (String(kind).includes("cross")) { ctx.moveTo(bar.x - 3, shapeY - 3); ctx.lineTo(bar.x + 3, shapeY + 3); ctx.moveTo(bar.x - 3, shapeY + 3); ctx.lineTo(bar.x + 3, shapeY - 3); ctx.stroke(); }
            else { const direction = below ? 1 : -1; ctx.moveTo(bar.x, shapeY - direction * 4); ctx.lineTo(bar.x - 4, shapeY + direction * 3); ctx.lineTo(bar.x + 4, shapeY + direction * 3); ctx.closePath(); }
            ctx.fill(); continue;
          }
          if (kind === 1 || kind === 5) {
            const barWidth = kind === 5 ? Math.max(1, data.barSpacing * .8) : width;
            ctx.fillRect(bar.x - barWidth / 2, Math.min(base, position), barWidth, Math.max(1, Math.abs(base - position)));
          } else if (kind === 3 || kind === 6) {
            const radius = width + 1;
            ctx.beginPath();
            if (kind === 6) { ctx.arc(bar.x, position, radius, 0, Math.PI * 2); ctx.fill(); }
            else { ctx.moveTo(bar.x - radius, position); ctx.lineTo(bar.x + radius, position); ctx.moveTo(bar.x, position - radius); ctx.lineTo(bar.x, position + radius); ctx.stroke(); }
          } else if (previous) {
            ctx.beginPath(); ctx.moveTo(previous.x, previous.y);
            if ([9, 10, 11].includes(Number(kind))) { ctx.lineTo(bar.x, previous.y); ctx.lineTo(bar.x, position); }
            else if (kind === 2) { const middle = (previous.x + bar.x) / 2; ctx.bezierCurveTo(middle, previous.y, middle, position, bar.x, position); }
            else ctx.lineTo(bar.x, position);
            ctx.stroke();
            if (kind === 4 || kind === 8) { ctx.lineTo(bar.x, base); ctx.lineTo(previous.x, base); ctx.closePath(); ctx.fill(); }
            if (kind === 10) { ctx.beginPath(); ctx.moveTo(bar.x, position - 3); ctx.lineTo(bar.x + 3, position); ctx.lineTo(bar.x, position + 3); ctx.lineTo(bar.x - 3, position); ctx.closePath(); ctx.fill(); }
          }
          if (!this.marksHidden && (this.selected || hovered) && index % Math.max(1, Math.floor(visible.length / 7)) === 0) {
            ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = "#2962ff"; ctx.fillStyle = "#131722"; ctx.beginPath(); ctx.arc(bar.x, position, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
          }
          previous = { x: bar.x, y: position };
        }
      }
      const timeX = (time: unknown) => {
        const value = Number(time), seconds = value > 1e11 ? value / 1000 : value;
        const bar = data.bars.find((item) => Number(item.originalData.time) >= seconds);
        return bar?.x ?? (seconds < Number(data.bars[0].originalData.time) ? 0 : mediaSize.width);
      };
      for (const graphic of this.graphics) {
        for (const [kind, groups] of Object.entries(graphic.graphicsCmds?.create ?? {})) {
          for (const group of groups) {
            const style = this.definition.metainfo.defaults.graphics?.[kind]?.[group.styleId];
            if (style?.visible === false) continue;
            ctx.strokeStyle = referenceColor(style?.color ?? "#787b86", style?.transparency); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = style?.linewidth ?? style?.width ?? 1; dash(style?.linestyle ?? style?.style);
            for (const item of group.data) {
              if (kind === "horizlines") {
                const position = y(Number(item.level)); if (position === null) continue;
                ctx.beginPath(); ctx.moveTo(item.extendLeft ? 0 : timeX(item.startIndex), position); ctx.lineTo(item.extendRight ? mediaSize.width : timeX(item.endIndex), position); ctx.stroke();
              } else if (kind === "vertlines") {
                const x = timeX(item.index); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mediaSize.height); ctx.stroke();
              } else if (kind === "backgrounds") {
                const left = timeX(item.start), right = timeX(item.stop); ctx.fillRect(left, 0, right - left, mediaSize.height);
              } else if (kind === "lines") {
                const first = y(Number(item.y1 ?? item.startPrice)), last = y(Number(item.y2 ?? item.endPrice));
                if (first === null || last === null) continue;
                ctx.beginPath(); ctx.moveTo(timeX(item.x1 ?? item.startIndex), first); ctx.lineTo(timeX(item.x2 ?? item.endIndex), last); ctx.stroke();
              }
            }
          }
        }
      }
      ctx.restore();
    });
  }

  hitTest(x: Parameters<NonNullable<ICustomSeriesPaneRenderer["hitTest"]>>[0], y: Parameters<NonNullable<ICustomSeriesPaneRenderer["hitTest"]>>[1], convert: Parameters<ICustomSeriesPaneRenderer["draw"]>[1]) {
    if (!this.data?.visibleRange) return null;
    const nearest = this.data.bars.slice(this.data.visibleRange.from, this.data.visibleRange.to).reduce<{ distance: number; point?: ReferencePoint }>((best, bar) => Math.abs(bar.x - x) < best.distance ? { distance: Math.abs(bar.x - x), point: bar.originalData } : best, { distance: Infinity });
    if (!nearest.point || nearest.distance > this.data.barSpacing) return null;
    const distance = Math.min(...this.definition.metainfo.plots.filter((plot) => plot.type === "line" && this.settings.styles[plot.id]?.visible !== false).map((plot) => {
      const value = nearest.point!.values[plot.id];
      const coordinate = Number.isFinite(value) ? convert(value) : null;
      return coordinate === null ? Infinity : Math.abs(coordinate - y);
    }));
    return distance <= 8 ? { distance, type: "line" as const } : null;
  }
}
