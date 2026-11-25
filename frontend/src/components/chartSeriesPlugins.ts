import {
  CustomData,
  CustomSeriesOptions,
  CustomSeriesPricePlotValues,
  CustomSeriesWhitespaceData,
  ICustomSeriesPaneRenderer,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  PriceToCoordinateConverter,
  Time,
  customSeriesDefaultOptions,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

export interface KagiPointData extends CustomData<Time> {
  open: number;
  high: number;
  low: number;
  close: number;
  trend?: "yang" | "yin";
}

export interface PnfColumnData extends CustomData<Time> {
  open: number;
  high: number;
  low: number;
  close: number;
  pnf_type?: "X" | "O";
  box_size?: number;
}

class KagiRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, KagiPointData> | null = null;

  update(data: PaneRendererCustomData<Time, KagiPointData>) {
    this._data = data;
  }

  draw(target: CanvasRenderingTarget2D, priceConverter: PriceToCoordinateConverter) {
    const data = this._data;
    if (!data || !data.visibleRange || data.bars.length === 0) return;
    const from = Math.max(0, data.visibleRange.from);
    const to = Math.min(data.bars.length, data.visibleRange.to);

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      let prevX: number | null = null;
      for (let i = from; i < to; i++) {
        const bar = data.bars[i];
        const d = bar.originalData;
        const yOpen = priceConverter(d.open);
        const yClose = priceConverter(d.close);
        if (yOpen === null || yClose === null) continue;

        const isYang = (d.trend ?? (d.close >= d.open ? "yang" : "yin")) === "yang";
        const color = isYang ? "#089981" : "#F23645";
        ctx.strokeStyle = color;
        ctx.lineWidth = isYang ? 2.8 : 1.4;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();
        if (prevX !== null) {
          ctx.moveTo(prevX, yOpen);
          ctx.lineTo(bar.x, yOpen);
        } else {
          ctx.moveTo(bar.x, yOpen);
        }
        ctx.lineTo(bar.x, yClose);
        ctx.stroke();

        prevX = bar.x;
      }
    });
  }
}

export class KagiSeriesPaneView implements ICustomSeriesPaneView<Time, KagiPointData, CustomSeriesOptions> {
  private _renderer = new KagiRenderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer;
  }

  update(data: PaneRendererCustomData<Time, KagiPointData>) {
    this._renderer.update(data);
  }

  priceValueBuilder(plotRow: KagiPointData): CustomSeriesPricePlotValues {
    return [
      Math.min(plotRow.low, plotRow.open, plotRow.close),
      Math.max(plotRow.high, plotRow.open, plotRow.close),
      plotRow.close,
    ];
  }

  isWhitespace(data: KagiPointData | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return (data as Partial<KagiPointData>).close === undefined;
  }

  defaultOptions(): CustomSeriesOptions {
    return { ...customSeriesDefaultOptions };
  }
}

class PointAndFigureRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, PnfColumnData> | null = null;

  update(data: PaneRendererCustomData<Time, PnfColumnData>) {
    this._data = data;
  }

  draw(target: CanvasRenderingTarget2D, priceConverter: PriceToCoordinateConverter) {
    const data = this._data;
    if (!data || !data.visibleRange || data.bars.length === 0) return;
    const from = Math.max(0, data.visibleRange.from);
    const to = Math.min(data.bars.length, data.visibleRange.to);
    const radius = Math.max(2, Math.min(6.5, data.barSpacing * 0.34));

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      for (let i = from; i < to; i++) {
        const bar = data.bars[i];
        const d = bar.originalData;
        const lo = Math.min(d.low, d.high);
        const hi = Math.max(d.low, d.high);
        const step = d.box_size && d.box_size > 0 ? d.box_size : Math.max(0.01, (hi - lo) / 4);
        const isX = (d.pnf_type ?? (d.close >= d.open ? "X" : "O")) === "X";

        ctx.strokeStyle = isX ? "#089981" : "#F23645";
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";

        let count = 0;
        for (let px = lo; px <= hi + step * 0.15 && count < 220; px += step, count++) {
          const y = priceConverter(px);
          if (y === null) continue;
          if (isX) {
            ctx.beginPath();
            ctx.moveTo(bar.x - radius, y - radius);
            ctx.lineTo(bar.x + radius, y + radius);
            ctx.moveTo(bar.x - radius, y + radius);
            ctx.lineTo(bar.x + radius, y - radius);
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(bar.x, y, radius, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    });
  }
}

export class PointAndFigurePaneView implements ICustomSeriesPaneView<Time, PnfColumnData, CustomSeriesOptions> {
  private _renderer = new PointAndFigureRenderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer;
  }

  update(data: PaneRendererCustomData<Time, PnfColumnData>) {
    this._renderer.update(data);
  }

  priceValueBuilder(plotRow: PnfColumnData): CustomSeriesPricePlotValues {
    return [plotRow.low, plotRow.high, plotRow.close];
  }

  isWhitespace(data: PnfColumnData | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return (data as Partial<PnfColumnData>).high === undefined;
  }

  defaultOptions(): CustomSeriesOptions {
    return { ...customSeriesDefaultOptions };
  }
}
