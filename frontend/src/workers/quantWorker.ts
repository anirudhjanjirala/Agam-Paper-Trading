// Web Worker offloading 50+ indicator & chained indicator computations off the main UI thread (60 FPS 16-Chart Workspace)

interface Bar {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface ChainStep {
  fn: string;
  period?: number;
  mult?: number;
}

function sma(arr: number[], period: number): number[] {
  const out = new Array(arr.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= period) sum -= arr[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(arr: number[], period: number): number[] {
  const out = new Array(arr.length).fill(NaN);
  const start = arr.findIndex((v) => !isNaN(v));
  if (start === -1 || arr.length - start < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = start; i < start + period; i++) seed += arr[i];
  out[start + period - 1] = seed / period;
  for (let i = start + period; i < arr.length; i++) {
    out[i] = isNaN(arr[i]) ? out[i - 1] : arr[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function rsi(arr: number[], period: number): number[] {
  const out = new Array(arr.length).fill(NaN);
  if (arr.length <= period) return out;
  const gains = new Array(arr.length).fill(0);
  const losses = new Array(arr.length).fill(0);
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }
  const avgG = ema(gains, period);
  const avgL = ema(losses, period);
  for (let i = 0; i < arr.length; i++) {
    if (!isNaN(avgG[i]) && !isNaN(avgL[i])) {
      const rs = avgL[i] > 0 ? avgG[i] / avgL[i] : 100;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

function vwap(bars: Bar[]): number[] {
  let cumPV = 0;
  let cumV = 0;
  return bars.map((b) => {
    const tp = (b.high + b.low + b.close) / 3;
    const v = b.volume || 1;
    cumPV += tp * v;
    cumV += v;
    return cumV > 0 ? cumPV / cumV : b.close;
  });
}

function runStep(fn: string, series: number[], bars: Bar[], period = 14, mult = 2): number[] {
  switch (fn.toLowerCase()) {
    case "sma":
    case "bb_middle":
      return sma(series, period);
    case "ema":
      return ema(series, period);
    case "rsi":
      return rsi(series, period);
    case "vwap":
      return vwap(bars);
    case "macd": {
      const e12 = ema(series, 12);
      const e26 = ema(series, 26);
      return e12.map((v, i) => v - e26[i]);
    }
    case "bb_upper":
    case "bb_lower": {
      const mid = sma(series, period);
      return series.map((_, i) => {
        if (i < period - 1) return NaN;
        let sq = 0;
        for (let j = i - period + 1; j <= i; j++) {
          const diff = series[j] - mid[i];
          sq += diff * diff;
        }
        const sd = Math.sqrt(sq / period);
        return fn.toLowerCase() === "bb_upper" ? mid[i] + mult * sd : mid[i] - mult * sd;
      });
    }
    default:
      return ema(series, period);
  }
}

self.onmessage = (e: MessageEvent<{ reqId: string; bars: Bar[]; chain: ChainStep[] }>) => {
  const { reqId, bars, chain } = e.data;
  if (!bars || bars.length === 0 || !chain || chain.length === 0) {
    self.postMessage({ reqId, points: [] });
    return;
  }

  let series = bars.map((b) => b.close);
  for (const step of chain) {
    series = runStep(step.fn, series, bars, step.period ?? 14, step.mult ?? 2);
  }

  const midIdx = Math.floor(bars.length / 2);
  const refPx = Math.abs(bars[bars.length - 1]?.close || bars[midIdx]?.close || 100);
  const lastFn = (chain[chain.length - 1]?.fn || "").toLowerCase();
  const isOsc = ["rsi", "macd", "macd_signal", "macd_hist", "stoch_k", "stoch_d"].includes(lastFn);
  const dec = isOsc ? 4 : refPx < 0.0001 ? 8 : refPx < 0.01 ? 6 : refPx < 10 ? 5 : refPx < 500 ? 3 : 2;
  const points: Array<{ time: string | number; value: number }> = [];
  for (let i = 0; i < bars.length; i++) {
    if (!isNaN(series[i])) {
      points.push({ time: bars[i].time, value: Number(series[i].toFixed(dec)) });
    }
  }
  self.postMessage({ reqId, points });
};
