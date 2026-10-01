import { BaseLineTool } from "lightweight-charts-line-tools-core";

let installed = false;
const hideTick = () => false;

export function installDrawingAxisLabels() {
  if (installed) return;
  installed = true;

  // Nhãn trục của bundle không có vạch trắng ở vị trí điểm neo.
  const priceAxisViews = BaseLineTool.prototype.priceAxisViews;
  BaseLineTool.prototype.priceAxisViews = function () {
    const views = priceAxisViews.call(this);
    for (const view of views) view.tickVisible = hideTick;
    return views;
  };

  const timeAxisViews = BaseLineTool.prototype.timeAxisViews;
  BaseLineTool.prototype.timeAxisViews = function () {
    const views = timeAxisViews.call(this);
    for (const view of views) view.tickVisible = hideTick;
    return views;
  };
}
