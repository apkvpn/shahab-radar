import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from "lightweight-charts";

export interface ZonePoint {
  /** candle time in seconds */
  t: number;
  s: number; // support level
  m: number; // midline
  r: number; // resistance level
}

type DrawTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

const THICKNESS = 0.3; // zone depth as a fraction of (mid - support)

function fillBand(
  ctx: CanvasRenderingContext2D,
  xs: number[],
  a: number[],
  b: number[],
  color: string,
  hr: number,
  vr: number,
) {
  if (xs.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(xs[0] * hr, a[0] * vr);
  for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i] * hr, a[i] * vr);
  for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(xs[i] * hr, b[i] * vr);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

class ZonesRenderer implements IPrimitivePaneRenderer {
  constructor(private owner: ZonesPrimitive) {}

  draw(target: DrawTarget) {
    const { chart, series, points } = this.owner;
    if (!chart || !series || points.length < 2) return;
    const ts = chart.timeScale();
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const xs: number[] = [];
      const sup: number[] = [];
      const supOut: number[] = [];
      const res: number[] = [];
      const resOut: number[] = [];
      for (const p of points) {
        const x = ts.timeToCoordinate(p.t as UTCTimestamp);
        if (x === null) continue;
        const d = (p.m - p.s) * THICKNESS;
        const ys = series.priceToCoordinate(p.s);
        const yso = series.priceToCoordinate(p.s - d);
        const yr = series.priceToCoordinate(p.r);
        const yro = series.priceToCoordinate(p.r + d);
        if (ys === null || yso === null || yr === null || yro === null) continue;
        xs.push(x);
        sup.push(ys);
        supOut.push(yso);
        res.push(yr);
        resOut.push(yro);
      }
      fillBand(context, xs, sup, supOut, "rgba(34,197,94,0.20)", hr, vr);
      fillBand(context, xs, res, resOut, "rgba(239,68,68,0.17)", hr, vr);
    });
  }
}

class ZonesView implements IPrimitivePaneView {
  private _renderer: ZonesRenderer;
  constructor(owner: ZonesPrimitive) {
    this._renderer = new ZonesRenderer(owner);
  }
  zOrder() {
    return "bottom" as const;
  }
  renderer() {
    return this._renderer;
  }
}

/** Draws the green support zone and the red resistance zone behind the candles. */
export class ZonesPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<"Candlestick"> | null = null;
  points: ZonePoint[] = [];
  private _request: (() => void) | null = null;
  private _views: ZonesView[];

  constructor() {
    this._views = [new ZonesView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.series = param.series as ISeriesApi<"Candlestick">;
    this._request = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this._request = null;
  }

  paneViews() {
    return this._views;
  }

  setData(points: ZonePoint[]) {
    this.points = points;
    this._request?.();
  }
}
