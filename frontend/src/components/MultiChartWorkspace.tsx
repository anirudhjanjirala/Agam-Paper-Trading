"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  CandlestickSeries,
  LineSeries,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  Time,
} from "lightweight-charts";
import { Grid, Link2, Sliders } from "lucide-react";
import { dedupeAscByTime, getPricePrecision } from "@/lib/format";
import { apiUrl } from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";

const DEFAULT_16_SYMBOLS = [
  "BTC-USD", "ETH-USD", "EURUSD=X", "USDJPY=X",
  "RELIANCE.NS", "^NSEI", "AAPL", "NVDA",
  "SOL-USD", "GC=F", "SHOP.TO", "SPY",
  "000001.SS", "600519.SS", "ASML.AS", "SAP.DE",
];

const WORKSPACE_PRESETS: Record<string, string[]> = {
  CROSS_ASSET: DEFAULT_16_SYMBOLS,
  CRYPTO: [
    "BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD",
    "XRP-USD", "ADA-USD", "DOGE-USD", "AVAX-USD",
    "LINK-USD", "DOT-USD", "TON-USD", "TRX-USD",
    "LTC-USD", "BCH-USD", "NEAR-USD", "UNI-USD",
  ],
  FOREX: [
    "EURUSD=X", "GBPUSD=X", "USDJPY=X", "USDCHF=X",
    "USDCAD=X", "AUDUSD=X", "NZDUSD=X", "DX-Y.NYB",
    "EURGBP=X", "EURJPY=X", "GBPJPY=X", "EURCHF=X",
    "AUDJPY=X", "CADJPY=X", "CHFJPY=X", "USDINR=X",
  ],
  INDIA_NSE: [
    "^NSEI", "^NSEBANK", "^BSESN", "RELIANCE.NS",
    "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "SBIN.NS", "BHARTIARTL.NS", "GOLDBEES.NS", "NIFTYBEES.NS",
    "USDINR=X", "EURINR=X", "LT.NS", "ITC.NS",
  ],
};

interface SyncBar {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface WorkerPoint {
  time: Time;
  value: number;
}

interface SyncChartTileProps {
  index: number;
  symbol: string;
  timeframe: "1d" | "5d" | "1mo" | "1y";
  indicatorPreset: "none" | "ema20" | "bb" | "ema_of_rsi";
  syncCrosshairTime: { sourceIndex: number; time: Time } | null;
  syncedPriceLine: number | null;
  onCrosshairMove: (idx: number, time: Time) => void;
  onChangeSymbol: (idx: number, sym: string) => void;
  workerRef: React.MutableRefObject<Worker | null>;
}

function SyncChartTile({
  index,
  symbol,
  timeframe,
  indicatorPreset,
  syncCrosshairTime,
  syncedPriceLine,
  onCrosshairMove,
  onChangeSymbol,
  workerRef,
}: SyncChartTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlayRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const barsRef = useRef<SyncBar[]>([]);
  const isSyncingRef = useRef(false);

  const [symDraft, setSymDraft] = useState<{ base: string; val: string } | null>(null);
  const editSym = symDraft?.base === symbol ? symDraft.val : symbol;
  const { theme } = useTheme();
  const [tileStatus, setTileStatus] = useState<"loading" | "ready" | "error">("loading");
  const onCrosshairMoveRef = useRef(onCrosshairMove);

  useEffect(() => {
    onCrosshairMoveRef.current = onCrosshairMove;
  }, [onCrosshairMove]);

  useEffect(() => {
    if (!containerRef.current) return;
    const initW = containerRef.current.clientWidth || 320;
    const initH = containerRef.current.clientHeight || 195;
    const chart = createChart(containerRef.current, {
      width: initW,
      height: initH,
      layout: { background: { type: ColorType.Solid, color: "#FFFFFF" }, textColor: "#131722", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: "#F0F3FA" }, horzLines: { color: "#F0F3FA" } },
      rightPriceScale: { borderColor: "#E0E3EB" },
      leftPriceScale: { visible: false, borderColor: "#E0E3EB" },
      timeScale: { borderColor: "#E0E3EB", timeVisible: true },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9598A1", style: LineStyle.Dotted },
        horzLine: { color: "#9598A1", style: LineStyle.Dotted },
      },
    });
    chartRef.current = chart;
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#089981",
      downColor: "#F23645",
      borderVisible: false,
      wickUpColor: "#089981",
      wickDownColor: "#F23645",
    });
    overlayRef.current = chart.addSeries(LineSeries, {
      color: "#2962FF",
      lineWidth: 2,
      priceLineVisible: false,
    });

    chart.subscribeCrosshairMove((param) => {
      if (isSyncingRef.current) return;
      if (param.time) onCrosshairMoveRef.current(index, param.time);
    });

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight || 195;
        if (w > 0) {
          chartRef.current.applyOptions({ width: w, height: h });
          chartRef.current.timeScale().fitContent();
        }
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      overlayRef.current = null;
    };
  }, [index]);

  useEffect(() => {
    if (!chartRef.current) return;
    const isDark = theme === "dark";
    chartRef.current.applyOptions({
      layout: { background: { type: ColorType.Solid, color: isDark ? "#0B0E14" : "#FFFFFF" }, textColor: isDark ? "#D1D4DC" : "#131722" },
      grid: { vertLines: { color: isDark ? "#1E222D" : "#F0F3FA" }, horzLines: { color: isDark ? "#1E222D" : "#F0F3FA" } },
      rightPriceScale: { borderColor: isDark ? "#2A2E39" : "#E0E3EB" },
      leftPriceScale: { borderColor: isDark ? "#2A2E39" : "#E0E3EB" },
      timeScale: { borderColor: isDark ? "#2A2E39" : "#E0E3EB" },
    });
  }, [theme, index]);

  useEffect(() => {
    const controller = new AbortController();
    const interval = timeframe === "1d" ? "5m" : timeframe === "5d" ? "15m" : "1d";
    fetch(
      apiUrl(`/api/history/${encodeURIComponent(symbol)}?interval=${interval}&period=${timeframe}`),
      { signal: controller.signal }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((bars) => {
        if (controller.signal.aborted || !candleRef.current) return;
        if (!Array.isArray(bars) || bars.length === 0) {
          setTileStatus("error");
          return;
        }
        setTileStatus("ready");
        const cleanBars = dedupeAscByTime(bars as Array<{ time: string | number; open: number; high: number; low: number; close: number }>) as SyncBar[];
        barsRef.current = cleanBars;
        const lastPx = cleanBars[cleanBars.length - 1]?.close || 100;
        const prec = getPricePrecision(lastPx, symbol);
        candleRef.current.applyOptions({
          priceFormat: { type: "price", precision: prec, minMove: Number((10 ** -prec).toFixed(prec)) },
        });
        candleRef.current.setData(cleanBars);
        chartRef.current?.timeScale().fitContent();

        if (!overlayRef.current) return;
        const isOsc = indicatorPreset === "ema_of_rsi";
        overlayRef.current.applyOptions({ priceScaleId: isOsc ? "left" : "right" });
        chartRef.current?.applyOptions({ leftPriceScale: { visible: isOsc, borderColor: "#E0E3EB" } });

        if (indicatorPreset === "none") {
          overlayRef.current.setData([]);
          return;
        }
        const chain =
          indicatorPreset === "ema20"
            ? [{ fn: "ema", period: 20 }]
            : indicatorPreset === "bb"
            ? [{ fn: "bb_upper", period: 20, mult: 2 }]
            : [{ fn: "rsi", period: 14 }, { fn: "ema", period: 9 }];

        if (workerRef.current) {
          const reqId = `${index}-${symbol}-${Date.now()}`;
          const handler = (ev: MessageEvent<{ reqId: string; points: WorkerPoint[] }>) => {
            if (ev.data.reqId === reqId) {
              workerRef.current?.removeEventListener("message", handler);
              overlayRef.current?.setData(
                dedupeAscByTime(ev.data.points as Array<{ time: string | number; value: number }>) as WorkerPoint[]
              );
            }
          };
          workerRef.current.addEventListener("message", handler);
          workerRef.current.postMessage({ reqId, bars: cleanBars, chain });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setTileStatus("error");
      });

    return () => controller.abort();
  }, [symbol, timeframe, indicatorPreset, index, workerRef]);

  useEffect(() => {
    if (!syncCrosshairTime || !chartRef.current || !candleRef.current) return;
    if (syncCrosshairTime.sourceIndex === index) return;
    const match = barsRef.current.find((b) => b.time === syncCrosshairTime.time);
    if (!match) return;
    try {
      isSyncingRef.current = true;
      chartRef.current.setCrosshairPosition(match.close, syncCrosshairTime.time, candleRef.current);
    } catch {
      // ignore
    } finally {
      isSyncingRef.current = false;
    }
  }, [syncCrosshairTime, index]);

  useEffect(() => {
    if (!candleRef.current) return;
    if (priceLineRef.current) {
      candleRef.current.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
    }
    if (syncedPriceLine !== null && barsRef.current.length > 0) {
      const lastClose = barsRef.current[barsRef.current.length - 1].close;
      priceLineRef.current = candleRef.current.createPriceLine({
        price: syncedPriceLine > 0 ? lastClose * syncedPriceLine : lastClose,
        color: "#2962FF",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Synced Level",
      });
    }
  }, [syncedPriceLine]);

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl p-2 flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-1.5 px-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editSym.trim()) {
              setTileStatus("loading");
              onChangeSymbol(index, editSym.trim().toUpperCase());
            }
          }}
        >
          <input
            aria-label={`Chart tile ${index + 1} symbol`}
            value={editSym}
            onChange={(e) => setSymDraft({ base: symbol, val: e.target.value })}
            className="w-28 bg-[#F8F9FD] border border-[#E0E3EB] rounded px-1.5 py-0.5 text-[11px] font-mono font-bold text-[#131722] outline-none focus:border-[#2962FF]"
          />
        </form>
        <span className="text-[10px] font-mono text-[#787B86] uppercase">#{index + 1} • {timeframe}</span>
      </div>
      <div className="relative w-full h-[195px]">
        <div ref={containerRef} className="w-full h-full" />
        {tileStatus === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#FFFFFF]/80 text-[11px] font-mono text-[#787B86]">
            Loading {symbol}...
          </div>
        )}
        {tileStatus === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#FFFFFF]/90 text-[11px] font-mono text-[#787B86]">
            Data unavailable for {symbol}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MultiChartWorkspace() {
  const [chartCount, setChartCount] = useState<1 | 2 | 4 | 8 | 12 | 16>(4);
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_16_SYMBOLS);
  const [timeframe, setTimeframe] = useState<"1d" | "5d" | "1mo" | "1y">("1mo");
  const [indicatorPreset, setIndicatorPreset] = useState<"none" | "ema20" | "bb" | "ema_of_rsi">("ema20");
  const [syncCrosshair, setSyncCrosshair] = useState(true);
  const [crosshairState, setCrosshairState] = useState<{ sourceIndex: number; time: Time } | null>(null);
  const [syncedLevelMult, setSyncedLevelMult] = useState<number | null>(null);

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    try {
      workerRef.current = new Worker(new URL("../workers/quantWorker.ts", import.meta.url));
    } catch {
      workerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const handleCrosshair = useCallback(
    (idx: number, time: Time) => {
      if (syncCrosshair) setCrosshairState({ sourceIndex: idx, time });
    },
    [syncCrosshair]
  );

  const handleChangeSymbol = useCallback((idx: number, sym: string) => {
    setSymbols((prev) => {
      const next = [...prev];
      next[idx] = sym;
      return next;
    });
  }, []);

  const gridCols =
    chartCount === 1
      ? "grid-cols-1"
      : chartCount <= 4
      ? "grid-cols-1 md:grid-cols-2"
      : "grid-cols-1 md:grid-cols-2 xl:grid-cols-4";

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E0E3EB]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#2962FF]/10 rounded-xl text-[#2962FF]">
            <Grid className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#131722]">16-Chart Synchronized Canvas (Web Worker Powered)</h3>
            <p className="text-xs text-[#787B86]">Crosshair, Timeframe & Drawing Sync • 60 FPS Worker Indicators</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg p-1 font-bold text-[11px]">
            {(
              [
                { id: "CROSS_ASSET", label: "Cross-Asset" },
                { id: "CRYPTO", label: "Crypto Desk" },
                { id: "FOREX", label: "Forex Matrix" },
                { id: "INDIA_NSE", label: "India NSE" },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSymbols(WORKSPACE_PRESETS[p.id])}
                className="px-2 py-1 rounded text-[#787B86] hover:text-[#2962FF] transition"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg p-1 font-mono font-bold">
            {([1, 2, 4, 8, 12, 16] as const).map((n) => (
              <button
                key={n}
                onClick={() => setChartCount(n)}
                className={`px-2.5 py-1 rounded transition ${
                  chartCount === n ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
                }`}
              >
                {n}×
              </button>
            ))}
          </div>

          <select
            aria-label="Synchronized Timeframe"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as "1d" | "5d" | "1mo" | "1y")}
            className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2.5 py-1.5 text-[#131722] font-mono font-bold"
          >
            <option value="1d">Sync TF: 1D (5m)</option>
            <option value="5d">Sync TF: 5D (15m)</option>
            <option value="1mo">Sync TF: 1M (1d)</option>
            <option value="1y">Sync TF: 1Y (1d)</option>
          </select>

          <select
            aria-label="Synchronized Indicator Preset"
            value={indicatorPreset}
            onChange={(e) => setIndicatorPreset(e.target.value as "none" | "ema20" | "bb" | "ema_of_rsi")}
            className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2.5 py-1.5 text-[#2962FF] font-semibold"
          >
            <option value="ema20">Worker: EMA (20)</option>
            <option value="bb">Worker: Bollinger Upper</option>
            <option value="ema_of_rsi">Worker: EMA(9) of RSI(14) Chain</option>
            <option value="none">Worker: No Overlay</option>
          </select>

          <button
            type="button"
            onClick={() => setSyncCrosshair((s) => !s)}
            className={`px-3 py-1.5 rounded-lg border font-bold flex items-center gap-1 transition ${
              syncCrosshair ? "bg-[#2962FF]/10 border-[#2962FF]/30 text-[#2962FF]" : "bg-[#F8F9FD] border-[#E0E3EB] text-[#787B86]"
            }`}
          >
            <Link2 className="w-3.5 h-3.5" /> Crosshair Sync
          </button>

          <button
            type="button"
            onClick={() => setSyncedLevelMult((v) => (v === null ? 1.0 : null))}
            className={`px-3 py-1.5 rounded-lg border font-bold flex items-center gap-1 transition ${
              syncedLevelMult !== null ? "bg-[#E8F5E9] border-[#089981]/30 text-[#089981]" : "bg-[#F8F9FD] border-[#E0E3EB] text-[#787B86]"
            }`}
          >
            <Sliders className="w-3.5 h-3.5" /> Synced Price Line
          </button>
        </div>
      </div>

      <div className={`grid ${gridCols} gap-3`}>
        {symbols.slice(0, chartCount).map((sym, idx) => (
          <SyncChartTile
            key={`${idx}-${sym}`}
            index={idx}
            symbol={sym}
            timeframe={timeframe}
            indicatorPreset={indicatorPreset}
            syncCrosshairTime={crosshairState}
            syncedPriceLine={syncedLevelMult}
            onCrosshairMove={handleCrosshair}
            onChangeSymbol={handleChangeSymbol}
            workerRef={workerRef}
          />
        ))}
      </div>
    </div>
  );
}
