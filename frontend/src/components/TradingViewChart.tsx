"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  LineStyle,
  PriceScaleMode,
  CandlestickSeries,
  BarSeries,
  LineSeries,
  AreaSeries,
  BaselineSeries,
  HistogramSeries,
  ISeriesApi,
  IChartApi,
  IPriceLine,
  SeriesType,
  Time,
  ISeriesMarkersPluginApi,
} from "lightweight-charts";
import {
  KagiPointData,
  KagiSeriesPaneView,
  PnfColumnData,
  PointAndFigurePaneView,
} from "@/components/chartSeriesPlugins";
import {
  CalendarClock,
  RefreshCw,
  Crosshair,
  TrendingUp,
  Minus,
  Percent,
  Columns,
  Ruler,
  Trash2,
  X,
  Eye,
  EyeOff,
  Download,
  Camera,
} from "lucide-react";
import { dedupeAscByTime, formatAssetPrice, formatCompactCurrency, formatNumber, formatQty, getPricePrecision } from "@/lib/format";
import { apiUrl, authFetch } from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";
import { Position } from "@/types/trading";

export interface CandleData {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trend?: "yang" | "yin";
  pnf_type?: "X" | "O";
  box_size?: number;
}

interface EventMarkerItem {
  time: string;
  type: "E" | "D" | "S";
  label: string;
  detail: string;
}

interface DrawnShape {
  id: string;
  tool: "trend" | "ray" | "fib" | "channel" | "rr";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight?: number;
}

export type ChartStyle =
  | "candles"
  | "bar"
  | "line"
  | "area"
  | "heikin_ashi"
  | "renko"
  | "point_and_figure"
  | "kagi"
  | "line_break"
  | "range_bar"
  | "baseline";
export type TimeframeKey = "10T" | "1s" | "5s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1D" | "1W" | "1M";

interface TradingViewChartProps {
  symbol: string;
  name: string;
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;
  currency: string;
  asOf?: string;
  exchange?: string;
  isMarketOpen?: boolean;
  bid?: number;
  ask?: number;
  timeframe: TimeframeKey;
  onChangeTimeframe: (tf: TimeframeKey) => void;
  chartStyle: ChartStyle;
  indicatorsOpen: boolean;
  onCloseIndicators: () => void;
  onCatalogLoaded?: (count: number) => void;
  refreshNonce?: number;
  openPositions?: Position[];
  onQuickOrder?: (side: "BUY" | "SELL") => void;
  onOpenOverview?: () => void;
}

const OSCILLATOR_PREFIXES = ["rsi", "macd", "cci", "stoch", "adx", "atr", "mfi", "roc", "mom", "willr", "obv"];

function isOscillatorChain(chain: Array<{ fn: string; period: number }>): boolean {
  if (chain.length === 0) return false;
  return chain.some((step) => OSCILLATOR_PREFIXES.some((p) => step.fn.toLowerCase().includes(p)));
}

function mapTimeframeToParams(tf: TimeframeKey, rng: string): { interval: string; period: string } {
  if (tf === "10T" || tf === "1s" || tf === "5s") return { interval: tf, period: "1d" };
  if (tf === "1m") return { interval: "1m", period: "1d" };
  if (tf === "5m") return { interval: "5m", period: "5d" };
  if (tf === "15m") return { interval: "15m", period: "5d" };
  if (tf === "1h") return { interval: "1h", period: "1mo" };
  if (tf === "4h") return { interval: "4h", period: "3mo" };
  if (tf === "1W") {
    const p = rng === "1Y" ? "1y" : rng === "6M" ? "6mo" : rng === "5Y" ? "5y" : "max";
    return { interval: "1wk", period: p };
  }
  if (tf === "1M") return { interval: "1mo", period: "max" };
  const periodMap: Record<string, string> = {
    "1D": "5d", "5D": "1mo", "1M": "1mo", "3M": "3mo", "6M": "6mo",
    YTD: "ytd", "1Y": "1y", "5Y": "5y", ALL: "max",
  };
  return { interval: "1d", period: periodMap[rng] || "max" };
}

export default function TradingViewChart({
  symbol,
  name,
  currentPrice,
  priceChange,
  priceChangePercent,
  currency,
  exchange,
  isMarketOpen,
  bid,
  ask,
  timeframe,
  onChangeTimeframe,
  chartStyle,
  indicatorsOpen,
  onCloseIndicators,
  onCatalogLoaded,
  refreshNonce = 0,
  openPositions = [],
  onQuickOrder,
  onOpenOverview,
}: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const overlayLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const positionLinesRef = useRef<IPriceLine[]>([]);
  const initialPriceRef = useRef<number>(currentPrice);
  useEffect(() => {
    initialPriceRef.current = currentPrice;
  }, [currentPrice]);

  const [rangePreset, setRangePreset] = useState<string>("ALL");
  const [logScale, setLogScale] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expiries, setExpiries] = useState<string[]>([]);
  const [events, setEvents] = useState<EventMarkerItem[]>([]);
  const [hoverOhlc, setHoverOhlc] = useState<CandleData | null>(null);
  const [utcClock, setUtcClock] = useState<string>("");

  const [catalog, setCatalog] = useState<Array<{ id: string; name: string; group: string }>>([]);
  const [activeChain, setActiveChain] = useState<Array<{ fn: string; period: number }>>([
    { fn: "ema", period: 20 },
  ]);
  const [indicatorSearch, setIndicatorSearch] = useState("");
  const [quantInfo, setQuantInfo] = useState<{
    emaRsi?: number;
    expectedMove?: { lower_1sd: number; upper_1sd: number };
    latestPattern?: { pattern: string; bias: string };
  }>({});

  const { theme } = useTheme();
  const themeRef = useRef(theme);
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  const [activeTool, setActiveTool] = useState<"crosshair" | "trend" | "ray" | "fib" | "channel" | "rr">("crosshair");
  const [lineWeight, setLineWeight] = useState<1 | 2 | 3 | 4>(2);
  const [hideDrawings, setHideDrawings] = useState<boolean>(false);
  const [drawingsBySymbol, setDrawingsBySymbol] = useState<Record<string, DrawnShape[]>>({});
  const [redoBySymbol, setRedoBySymbol] = useState<Record<string, DrawnShape[]>>({});
  const [draftShape, setDraftShape] = useState<DrawnShape | null>(null);
  const indicatorsLoadedRef = useRef<boolean>(false);
  const loadedDrawingSymbolsRef = useRef<Record<string, boolean>>({});

  const drawings = drawingsBySymbol[symbol] ?? [];
  const redoStack = redoBySymbol[symbol] ?? [];

  const [loadedChart, setLoadedChart] = useState<{
    symbol: string;
    requestKey: string;
    candles: CandleData[];
  }>({ symbol: "", requestKey: "", candles: [] });
  const currentRequestKey = `${symbol}|${timeframe}|${rangePreset}|${chartStyle}|${refreshNonce}`;

  useEffect(() => {
    const updateClock = () => setUtcClock(new Date().toISOString().slice(11, 19) + " UTC");
    const t0 = setTimeout(updateClock, 0);
    const t = setInterval(updateClock, 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, []);

  // Load user global indicator preference once
  useEffect(() => {
    let mounted = true;
    authFetch("/api/user/layouts?layout_name=default")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!mounted || !d) return;
        if (Array.isArray(d.active_indicators) && d.active_indicators.length > 0) {
          setActiveChain(d.active_indicators);
        }
        indicatorsLoadedRef.current = true;
      })
      .catch(() => {
        indicatorsLoadedRef.current = true;
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Save global indicator preference cleanly without touching per-symbol drawings
  useEffect(() => {
    if (!indicatorsLoadedRef.current) return;
    const t = setTimeout(() => {
      authFetch("/api/user/layouts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layout_name: "default",
          symbol,
          grid_type: "1x1",
          drawings: [],
          active_indicators: activeChain,
        }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [activeChain, symbol]);

  // Load strict per-symbol drawings (preventing any cross-symbol drawing leakage)
  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();
    const layoutKey = `chart:${symbol.slice(0, 56)}`;
    authFetch(`/api/user/layouts?layout_name=${encodeURIComponent(layoutKey)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (controller.signal.aborted) return;
        const loaded = Array.isArray(d?.drawings) ? (d.drawings as DrawnShape[]) : [];
        setDrawingsBySymbol((prev) => {
          if (prev[symbol] && prev[symbol].length > 0 && loaded.length === 0) return prev;
          return { ...prev, [symbol]: loaded };
        });
        loadedDrawingSymbolsRef.current[symbol] = true;
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          loadedDrawingSymbolsRef.current[symbol] = true;
        }
      });
    return () => {
      controller.abort();
    };
  }, [symbol]);

  // Debounced auto-save of per-symbol drawings to backend
  useEffect(() => {
    if (!symbol || !loadedDrawingSymbolsRef.current[symbol]) return;
    const symDrawings = drawingsBySymbol[symbol] ?? [];
    const layoutKey = `chart:${symbol.slice(0, 56)}`;
    const t = setTimeout(() => {
      authFetch("/api/user/layouts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layout_name: layoutKey,
          symbol,
          grid_type: "1x1",
          drawings: symDrawings,
          active_indicators: activeChain,
        }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [drawingsBySymbol, activeChain, symbol]);

  // Universal Chart Hotkeys: Alt+H (horizontal ray), Ctrl+Z (undo symbol drawing), Ctrl+Y (redo symbol drawing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.altKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setActiveTool((prev) => (prev === "ray" ? "crosshair" : "ray"));
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setDrawingsBySymbol((prev) => {
          const cur = prev[symbol] ?? [];
          if (cur.length === 0) return prev;
          const last = cur[cur.length - 1];
          setRedoBySymbol((r) => ({ ...r, [symbol]: [...(r[symbol] ?? []), last] }));
          return { ...prev, [symbol]: cur.slice(0, -1) };
        });
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        setRedoBySymbol((prev) => {
          const curRedo = prev[symbol] ?? [];
          if (curRedo.length === 0) return prev;
          const restored = curRedo[curRedo.length - 1];
          setDrawingsBySymbol((d) => ({ ...d, [symbol]: [...(d[symbol] ?? []), restored] }));
          return { ...prev, [symbol]: curRedo.slice(0, -1) };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [symbol]);

  // Instant zero-flicker Dark/Light theme application on chart instance
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
  }, [theme]);

  useEffect(() => {
    fetch(apiUrl("/api/indicators/catalog"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.indicators) {
          setCatalog(d.indicators);
          onCatalogLoaded?.(d.indicators.length);
        }
      })
      .catch(() => {});
  }, [onCatalogLoaded]);

  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();
    const { interval, period } = mapTimeframeToParams(timeframe, rangePreset);
    const derivedApiStyles = new Set<ChartStyle>([
      "heikin_ashi",
      "renko",
      "point_and_figure",
      "kagi",
      "line_break",
      "range_bar",
    ]);
    const apiStyle = derivedApiStyles.has(chartStyle) ? chartStyle : "candles";

    const reqKey = `${symbol}|${timeframe}|${rangePreset}|${chartStyle}|${refreshNonce}`;
    fetch(
      apiUrl(`/api/history/${encodeURIComponent(symbol)}?interval=${interval}&period=${period}&style=${apiStyle}`),
      { signal: controller.signal }
    )
      .then(async (res) => {
        if (controller.signal.aborted) return;
        if (res.ok) {
          const data: CandleData[] = await res.json();
          if (!controller.signal.aborted) {
            setErrorMsg(null);
            setHoverOhlc(null);
            setLoadedChart({ symbol, requestKey: reqKey, candles: data || [] });
          }
        } else if (!controller.signal.aborted) {
          setErrorMsg("Historical data unavailable for selected range/ticker.");
          setLoadedChart({ symbol, requestKey: reqKey, candles: [] });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) return;
        setErrorMsg("Connecting to market data...");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [symbol, timeframe, rangePreset, chartStyle, refreshNonce]);

  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();

    fetch(apiUrl(`/api/expiries/${encodeURIComponent(symbol)}`), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!controller.signal.aborted) setExpiries(d?.expiries ? d.expiries.slice(0, 5) : []);
      })
      .catch(() => {});

    fetch(apiUrl(`/api/asset/${encodeURIComponent(symbol)}/events`), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!controller.signal.aborted) setEvents(d?.markers || []);
      })
      .catch(() => {});

    fetch(apiUrl("/api/indicators/compute"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        symbol,
        interval: "1d",
        period: "3mo",
        chain: [{ fn: "rsi", period: 14 }, { fn: "ema", period: 9 }],
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => {
        if (!controller.signal.aborted) {
          setQuantInfo(
            q
              ? {
                  emaRsi: q.series?.[q.series.length - 1]?.value,
                  expectedMove: q.expected_move,
                  latestPattern: q.patterns?.[q.patterns.length - 1],
                }
              : {}
          );
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, [symbol]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      overlayLineRef.current = null;
      markersPluginRef.current = null;
    }

    const initW = chartContainerRef.current.clientWidth || 720;
    const initH = chartContainerRef.current.clientHeight || 420;
    const isDarkInit = themeRef.current === "dark";

    const chart = createChart(chartContainerRef.current, {
      width: initW,
      height: initH,
      layout: {
        background: { type: ColorType.Solid, color: isDarkInit ? "#0B0E14" : "#FFFFFF" },
        textColor: isDarkInit ? "#D1D4DC" : "#131722",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: isDarkInit ? "#1E222D" : "#F0F3FA" },
        horzLines: { color: isDarkInit ? "#1E222D" : "#F0F3FA" },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9598A1", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#131722" },
        horzLine: { color: "#9598A1", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#131722" },
      },
      rightPriceScale: {
        borderColor: isDarkInit ? "#2A2E39" : "#E0E3EB",
        scaleMargins: { top: 0.14, bottom: 0.22 },
      },
      leftPriceScale: {
        visible: false,
        borderColor: isDarkInit ? "#2A2E39" : "#E0E3EB",
        scaleMargins: { top: 0.16, bottom: 0.22 },
      },
      timeScale: {
        borderColor: isDarkInit ? "#2A2E39" : "#E0E3EB",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#08998133",
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    if (chartStyle === "line") {
      mainSeriesRef.current = chart.addSeries(LineSeries, { color: "#2962FF", lineWidth: 2 });
    } else if (chartStyle === "bar") {
      mainSeriesRef.current = chart.addSeries(BarSeries, {
        upColor: "#089981",
        downColor: "#F23645",
        thinBars: false,
      });
    } else if (chartStyle === "area") {
      mainSeriesRef.current = chart.addSeries(AreaSeries, {
        topColor: "rgba(41, 98, 255, 0.22)",
        bottomColor: "rgba(41, 98, 255, 0.0)",
        lineColor: "#2962FF",
        lineWidth: 2,
      });
    } else if (chartStyle === "baseline") {
      mainSeriesRef.current = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: initialPriceRef.current || 100 },
        topLineColor: "#089981",
        topFillColor1: "rgba(8, 153, 129, 0.2)",
        topFillColor2: "rgba(8, 153, 129, 0.0)",
        bottomLineColor: "#F23645",
        bottomFillColor1: "rgba(242, 54, 69, 0.0)",
        bottomFillColor2: "rgba(242, 54, 69, 0.2)",
      });
    } else if (chartStyle === "kagi") {
      mainSeriesRef.current = chart.addCustomSeries(new KagiSeriesPaneView()) as unknown as ISeriesApi<SeriesType>;
    } else if (chartStyle === "point_and_figure") {
      mainSeriesRef.current = chart.addCustomSeries(new PointAndFigurePaneView()) as unknown as ISeriesApi<SeriesType>;
    } else {
      mainSeriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: "#089981",
        downColor: "#F23645",
        borderVisible: false,
        wickUpColor: "#089981",
        wickDownColor: "#F23645",
      });
    }

    overlayLineRef.current = chart.addSeries(LineSeries, {
      color: "#2962FF",
      lineWidth: 2,
      priceLineVisible: false,
      priceScaleId: "right",
    });

    try {
      markersPluginRef.current = createSeriesMarkers(mainSeriesRef.current, []);
    } catch {
      markersPluginRef.current = null;
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData || !mainSeriesRef.current) {
        setHoverOhlc(null);
        return;
      }
      const d = param.seriesData.get(mainSeriesRef.current) as
        | { open?: number; high?: number; low?: number; close?: number; value?: number }
        | undefined;
      const v = volumeSeriesRef.current
        ? (param.seriesData.get(volumeSeriesRef.current) as { value?: number } | undefined)
        : undefined;
      if (d) {
        setHoverOhlc({
          time: param.time as string | number,
          open: d.open ?? d.value ?? 0,
          high: d.high ?? d.value ?? 0,
          low: d.low ?? d.value ?? 0,
          close: d.close ?? d.value ?? 0,
          volume: v?.value ?? 0,
        });
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current && chartRef.current) {
        const w = chartContainerRef.current.clientWidth;
        const h = chartContainerRef.current.clientHeight;
        if (w > 0 && h > 0) {
          chartRef.current.applyOptions({ width: w, height: h });
        }
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      positionLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      overlayLineRef.current = null;
      markersPluginRef.current = null;
    };
  }, [chartStyle]);

  useEffect(() => {
    const series = mainSeriesRef.current;
    if (!series) return;
    for (const line of positionLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // ignore if series recreated
      }
    }
    positionLinesRef.current = [];
    if (loadedChart.symbol !== symbol || loadedChart.candles.length === 0) return;

    const matching = openPositions.filter((p) => p.symbol === symbol);
    for (const pos of matching) {
      try {
        if (pos.avg_price > 0) {
          positionLinesRef.current.push(
            series.createPriceLine({
              price: pos.avg_price,
              color: pos.order_type === "SHORT" ? "#F59E0B" : "#2962FF",
              lineWidth: 1,
              lineStyle: LineStyle.Solid,
              axisLabelVisible: true,
              title: `${pos.order_type} ${formatQty(pos.quantity)} Avg`,
            })
          );
        }
        if (pos.stop_loss && pos.stop_loss > 0) {
          positionLinesRef.current.push(
            series.createPriceLine({
              price: pos.stop_loss,
              color: "#F23645",
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: "SL",
            })
          );
        }
        if (pos.take_profit && pos.take_profit > 0) {
          positionLinesRef.current.push(
            series.createPriceLine({
              price: pos.take_profit,
              color: "#089981",
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: "TP",
            })
          );
        }
      } catch {
        // ignore custom series plugins without price lines
      }
    }
  }, [symbol, loadedChart, openPositions, chartStyle]);

  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [logScale]);

  useEffect(() => {
    if (loadedChart.symbol !== symbol || loadedChart.candles.length === 0 || !mainSeriesRef.current) return;

    const bars = dedupeAscByTime(loadedChart.candles);
    const samplePx = currentPrice || bars[bars.length - 1]?.close || 100;
    const prec = getPricePrecision(samplePx, symbol);
    try {
      mainSeriesRef.current.applyOptions({
        priceFormat: {
          type: "price",
          precision: prec,
          minMove: Number((10 ** -prec).toFixed(prec)),
        },
      });
    } catch {
      // custom plugins handle own axis scale
    }
    if (chartStyle === "line" || chartStyle === "area" || chartStyle === "baseline") {
      mainSeriesRef.current.setData(bars.map((c) => ({ time: c.time as Time, value: c.close })));
      if (chartStyle === "baseline" && bars.length > 0) {
        mainSeriesRef.current.applyOptions({ baseValue: { type: "price", price: bars[0].open } });
      }
    } else if (chartStyle === "kagi") {
      const kagiRows: KagiPointData[] = bars.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        trend: c.trend,
      }));
      (mainSeriesRef.current as unknown as ISeriesApi<"Custom">).setData(kagiRows);
    } else if (chartStyle === "point_and_figure") {
      const pnfRows: PnfColumnData[] = bars.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        pnf_type: c.pnf_type,
        box_size: c.box_size,
      }));
      (mainSeriesRef.current as unknown as ISeriesApi<"Custom">).setData(pnfRows);
    } else {
      mainSeriesRef.current.setData(
        bars.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close }))
      );
    }

    volumeSeriesRef.current?.setData(
      bars.map((c) => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? "#08998133" : "#F2364533",
      }))
    );

    if (markersPluginRef.current) {
      if (events.length > 0 && typeof bars[0].time === "string") {
        const candleTimes = new Set(bars.map((b) => String(b.time)));
        const matched = events
          .filter((ev) => candleTimes.has(ev.time))
          .map((ev) => ({
            time: ev.time as Time,
            position: "belowBar" as const,
            color: ev.type === "E" ? "#2962FF" : ev.type === "D" ? "#089981" : "#F59E0B",
            shape: "circle" as const,
            text: ev.type,
          }));
        try {
          markersPluginRef.current.setMarkers(matched);
        } catch {
          // ignore if non-daily
        }
      } else {
        try {
          markersPluginRef.current.setMarkers([]);
        } catch {
          // ignore
        }
      }
    }

    const isDerivedBrickStyle =
      chartStyle === "renko" ||
      chartStyle === "point_and_figure" ||
      chartStyle === "kagi" ||
      chartStyle === "line_break" ||
      chartStyle === "range_bar";

    const controller = new AbortController();
    const isOsc = isOscillatorChain(activeChain);
    chartRef.current?.applyOptions({
      leftPriceScale: { visible: !isDerivedBrickStyle && isOsc, borderColor: "#E0E3EB", scaleMargins: { top: 0.16, bottom: 0.22 } },
    });
    overlayLineRef.current?.applyOptions({
      priceScaleId: isOsc ? "left" : "right",
      color: isOsc ? "#F59E0B" : "#2962FF",
    });

    if (!isDerivedBrickStyle && activeChain.length > 0 && overlayLineRef.current) {
      const { interval, period } = mapTimeframeToParams(timeframe, rangePreset);
      fetch(apiUrl("/api/indicators/compute"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ symbol, interval, period, chain: activeChain }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => {
          if (!controller.signal.aborted && res?.series && overlayLineRef.current) {
            overlayLineRef.current.setData(
              dedupeAscByTime(res.series as Array<{ time: string | number; value: number }>) as Array<{
                time: Time;
                value: number;
              }>
            );
          }
        })
        .catch(() => {});
    } else {
      overlayLineRef.current?.setData([]);
    }

    chartRef.current?.timeScale().fitContent();
    return () => controller.abort();
  }, [loadedChart, chartStyle, symbol, events, activeChain, timeframe, rangePreset]);

  useEffect(() => {
    if (loading || loadedChart.symbol !== symbol || loadedChart.candles.length === 0 || !currentPrice || !mainSeriesRef.current) {
      return;
    }
    if (
      chartStyle === "renko" ||
      chartStyle === "point_and_figure" ||
      chartStyle === "kagi" ||
      chartStyle === "line_break" ||
      chartStyle === "range_bar"
    ) {
      return;
    }
    const last = loadedChart.candles[loadedChart.candles.length - 1];
    try {
      if (chartStyle === "line" || chartStyle === "area" || chartStyle === "baseline") {
        mainSeriesRef.current.update({ time: last.time as Time, value: currentPrice });
      } else {
        mainSeriesRef.current.update({
          time: last.time as Time,
          open: last.open,
          high: Math.max(last.high, currentPrice),
          low: Math.min(last.low, currentPrice),
          close: currentPrice,
        });
      }
    } catch {
      // ignore
    }
  }, [currentPrice, chartStyle, symbol, loadedChart, loading]);

  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool === "crosshair") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDraftShape({ id: `drw-${Date.now()}`, tool: activeTool, x1: x, y1: y, x2: x, y2: y, weight: lineWeight });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draftShape) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setDraftShape({ ...draftShape, x2: e.clientX - rect.left, y2: e.clientY - rect.top });
  };

  const handleCanvasMouseUp = () => {
    if (draftShape) {
      const completed = draftShape;
      setDrawingsBySymbol((prev) => ({
        ...prev,
        [symbol]: [...(prev[symbol] ?? []), completed],
      }));
      setRedoBySymbol((prev) => ({ ...prev, [symbol]: [] }));
      setDraftShape(null);
    }
  };

  const handleAutoFit = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  const isBullish = priceChange >= 0;
  const displayBar = hoverOhlc || loadedChart.candles[loadedChart.candles.length - 1];
  const pxPrec = getPricePrecision(currentPrice || displayBar?.close, symbol);
  const liveBid = bid ?? Number((currentPrice * 0.9998).toFixed(pxPrec));
  const liveAsk = ask ?? Number((currentPrice * 1.0002).toFixed(pxPrec));
  const spreadVal = Math.max(0, liveAsk - liveBid);
  const monogram = symbol.replace(/[^A-Z0-9]/gi, "").slice(0, 2).toUpperCase() || "AG";
  const activeChainLabel = activeChain.map((c) => `${c.fn.toUpperCase()}(${c.period})`).join(" → ");

  return (
    <div className="flex-1 min-h-0 flex gap-[4px] bg-[#EBECEF]">
      {/* TradingView Left Drawing Toolbar (42px mobile / 52px desktop) */}
      <aside
        aria-label="Chart Drawing Tools"
        className="w-[42px] sm:w-[52px] bg-[#FFFFFF] flex flex-col items-center py-2 gap-1 shrink-0 select-none"
      >
        {(
          [
            { id: "crosshair", icon: Crosshair, title: "Crosshair" },
            { id: "trend", icon: TrendingUp, title: "Trend Line" },
            { id: "ray", icon: Minus, title: "Horizontal Ray" },
            { id: "fib", icon: Percent, title: "Fib Retracement" },
            { id: "channel", icon: Columns, title: "Parallel Channel" },
            { id: "rr", icon: Ruler, title: "Long / Short Position Ruler" },
          ] as const
        ).map((tool) => {
          const Icon = tool.icon;
          const isAct = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => setActiveTool(tool.id)}
              aria-label={tool.title}
              title={tool.title}
              className={`w-[38px] h-[38px] rounded-lg flex items-center justify-center transition ${
                isAct
                  ? "bg-[#F0F3FA] text-[#2962FF]"
                  : "text-[#6A6D78] hover:bg-[#F8F9FD] hover:text-[#131722]"
              }`}
            >
              <Icon className="w-[18px] h-[18px]" />
            </button>
          );
        })}

        <div className="w-6 h-[1px] bg-[#E0E3EB] my-1.5" />

        {/* Line Weight Selector (1px - 4px) */}
        <div className="flex flex-col items-center gap-1 py-0.5" role="group" aria-label="Line Weight">
          {([1, 2, 3, 4] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setLineWeight(w)}
              aria-label={`Line Weight ${w}px`}
              title={`Line Weight ${w}px`}
              className={`w-[32px] h-[18px] rounded flex items-center justify-center transition ${
                lineWeight === w ? "bg-[#F0F3FA] ring-1 ring-[#2962FF]" : "hover:bg-[#F8F9FD]"
              }`}
            >
              <span
                className="w-4 rounded-full bg-current block"
                style={{
                  height: `${w}px`,
                  color: lineWeight === w ? "#2962FF" : "#6A6D78",
                }}
              />
            </button>
          ))}
        </div>

        <div className="w-6 h-[1px] bg-[#E0E3EB] my-1" />

        <button
          type="button"
          onClick={() => setHideDrawings((v) => !v)}
          aria-label={hideDrawings ? "Show All Drawings" : "Hide All Drawings"}
          title={hideDrawings ? "Show Drawings" : "Hide Drawings"}
          className={`w-[38px] h-[38px] rounded-lg flex items-center justify-center transition ${
            hideDrawings ? "bg-[#F0F3FA] text-[#2962FF]" : "text-[#6A6D78] hover:bg-[#F8F9FD] hover:text-[#131722]"
          }`}
        >
          {hideDrawings ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
        </button>

        <button
          type="button"
          onClick={() => {
            setDrawingsBySymbol((prev) => ({ ...prev, [symbol]: [] }));
            setRedoBySymbol((prev) => ({ ...prev, [symbol]: [] }));
            setActiveTool("crosshair");
          }}
          aria-label="Remove Objects"
          title={`Remove ${symbol} Drawings (${drawings.length} active, ${redoStack.length} redo)`}
          className="w-[38px] h-[38px] rounded-lg flex items-center justify-center text-[#6A6D78] hover:bg-[#FFEBEE] hover:text-[#F23645] transition"
        >
          <Trash2 className="w-[18px] h-[18px]" />
        </button>
      </aside>

      {/* Center Canvas + Floating Overlay Legend + Bottom 36px Range Bar */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-[1px] bg-[#E0E3EB]">
        <div className="relative flex-1 min-h-[260px] bg-[#FFFFFF] overflow-hidden">
          {/* TradingView Floating Top-Left OHLCV Legend & Inline Bid/Ask Buttons */}
          <div className="absolute top-2.5 left-3 right-16 z-30 pointer-events-none space-y-1.5">
            {/* Row 1: Monogram + Title + Market Status + Colored OHLC */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs leading-tight pointer-events-auto">
              <div className="flex items-center gap-1.5 bg-[#FFFFFF]/90 backdrop-blur-[2px] pr-1.5 rounded">
                <span className="w-5 h-5 rounded-full bg-[#131722] text-white text-[9px] font-black flex items-center justify-center shrink-0">
                  {monogram}
                </span>
                <button
                  type="button"
                  onClick={onOpenOverview}
                  className="font-bold text-[#131722] hover:text-[#2962FF] transition text-left"
                  title="Open Symbol Overview"
                >
                  {name} · {timeframe} · {exchange || "MKT"}
                </button>
                <span className="text-[11px] font-mono font-bold text-[#131722]">
                  {formatAssetPrice(currentPrice, currency, symbol)}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    isMarketOpen ? "bg-[#E8F5E9] text-[#089981]" : "bg-[#F0F3FA] text-[#787B86]"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isMarketOpen ? "bg-[#089981] live-pulse" : "bg-[#9598A1]"}`} />
                  {isMarketOpen ? "OPEN" : "CLOSED"}
                </span>
              </div>

              {displayBar && (
                <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums text-[11px] bg-[#FFFFFF]/90 backdrop-blur-[2px] px-1 rounded">
                  <span className="text-[#787B86]">
                    O<strong className={`ml-0.5 ${isBullish ? "text-[#089981]" : "text-[#F23645]"}`}>{formatNumber(displayBar.open, pxPrec, pxPrec)}</strong>
                  </span>
                  <span className="text-[#787B86]">
                    H<strong className={`ml-0.5 ${isBullish ? "text-[#089981]" : "text-[#F23645]"}`}>{formatNumber(displayBar.high, pxPrec, pxPrec)}</strong>
                  </span>
                  <span className="text-[#787B86]">
                    L<strong className={`ml-0.5 ${isBullish ? "text-[#089981]" : "text-[#F23645]"}`}>{formatNumber(displayBar.low, pxPrec, pxPrec)}</strong>
                  </span>
                  <span className="text-[#787B86]">
                    C<strong className={`ml-0.5 ${isBullish ? "text-[#089981]" : "text-[#F23645]"}`}>{formatNumber(displayBar.close, pxPrec, pxPrec)}</strong>
                  </span>
                  <span className={`font-bold ${isBullish ? "text-[#089981]" : "text-[#F23645]"}`}>
                    {isBullish ? "+" : ""}{formatNumber(priceChange, pxPrec, pxPrec)} ({isBullish ? "+" : ""}{(priceChangePercent ?? 0).toFixed(2)}%)
                  </span>
                </div>
              )}
            </div>

            {/* Row 2: TradingView Instant Floating SELL | Spread | BUY Order Chips */}
            {onQuickOrder && currentPrice > 0 && (
              <div className="flex items-center gap-1.5 pointer-events-auto w-fit">
                <button
                  type="button"
                  onClick={() => onQuickOrder("SELL")}
                  className="px-2 py-0.5 rounded bg-[#FFFFFF]/95 hover:bg-[#F23645] text-[#F23645] hover:text-white border border-[#F23645] text-[11px] font-mono tabular-nums font-bold shadow-xs transition flex items-center gap-1.5"
                >
                  <span>{formatNumber(liveBid, pxPrec, pxPrec)}</span>
                  <span className="text-[9px] uppercase tracking-wider">Sell</span>
                </button>
                <span className="text-[10px] font-mono text-[#787B86] bg-[#FFFFFF]/90 px-1 rounded tabular-nums">
                  {formatNumber(spreadVal, pxPrec, pxPrec)}
                </span>
                <button
                  type="button"
                  onClick={() => onQuickOrder("BUY")}
                  className="px-2 py-0.5 rounded bg-[#FFFFFF]/95 hover:bg-[#2962FF] text-[#2962FF] hover:text-white border border-[#2962FF] text-[11px] font-mono tabular-nums font-bold shadow-xs transition flex items-center gap-1.5"
                >
                  <span className="text-[9px] uppercase tracking-wider">Buy</span>
                  <span>{formatNumber(liveAsk, pxPrec, pxPrec)}</span>
                </button>
              </div>
            )}

            {/* Row 3: Volume, Active Indicator Overlay & Quant Readouts */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#787B86] pointer-events-auto w-fit bg-[#FFFFFF]/85 px-1 rounded">
              <span>
                Vol{" "}
                <strong className="text-[#131722]">
                  {displayBar ? formatCompactCurrency(displayBar.volume, "PERCENT").replace("%", "") : "—"}
                </strong>
              </span>
              {activeChain.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[#2962FF] font-semibold">
                  • {activeChainLabel}
                  <button
                    type="button"
                    onClick={() => setActiveChain([])}
                    aria-label="Remove Overlay"
                    className="hover:text-[#F23645]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {quantInfo.emaRsi !== undefined && (
                <span className="text-[#787B86]">• RSI(14) EMA: <strong className="text-[#131722]">{quantInfo.emaRsi.toFixed(1)}</strong></span>
              )}
              {quantInfo.latestPattern && (
                <span className="text-[#131722]">• {quantInfo.latestPattern.pattern}</span>
              )}
              {expiries.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="w-3 h-3 text-[#2962FF]" /> Exp {expiries[0]}
                </span>
              )}
            </div>
          </div>

          {(loading || (loadedChart.requestKey !== currentRequestKey && !errorMsg)) && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#FFFFFF]/80 backdrop-blur-[1px]">
              <div className="flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 text-[#2962FF] animate-spin" />
                <span className="text-xs text-[#787B86] font-mono">Loading {symbol} chart...</span>
              </div>
            </div>
          )}

          {!loading && errorMsg && loadedChart.candles.length === 0 && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#FFFFFF]">
              <span className="text-xs text-[#F23645] font-mono">{errorMsg}</span>
            </div>
          )}

          <div ref={chartContainerRef} className="w-full h-full" />

          {/* Interactive SVG Drawing Layer */}
          <svg
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            className={`absolute inset-0 w-full h-full z-10 ${
              activeTool === "crosshair" ? "pointer-events-none" : "cursor-crosshair"
            }`}
          >
            {!hideDrawings &&
              [...drawings, ...(draftShape ? [draftShape] : [])].map((d) => {
                const sw = d.weight || 2;
                if (d.tool === "trend") {
                  return <line key={d.id} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke="#2962FF" strokeWidth={sw} />;
                }
                if (d.tool === "ray") {
                  return <line key={d.id} x1={d.x1} y1={d.y1} x2={2400} y2={d.y1} stroke="#089981" strokeWidth={sw} strokeDasharray="4 4" />;
                }
                if (d.tool === "channel") {
                  return (
                    <g key={d.id}>
                      <line x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke="#2962FF" strokeWidth={sw} />
                      <line x1={d.x1} y1={d.y1 + 36} x2={d.x2} y2={d.y2 + 36} stroke="#2962FF" strokeWidth={Math.max(1, sw - 0.5)} strokeDasharray="3 3" />
                    </g>
                  );
                }
                if (d.tool === "fib") {
                  const dy = d.y2 - d.y1;
                  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 1];
                  return (
                    <g key={d.id}>
                      {ratios.map((r) => (
                        <g key={r}>
                          <line x1={Math.min(d.x1, d.x2)} y1={d.y1 + dy * r} x2={Math.max(d.x1, d.x2)} y2={d.y1 + dy * r} stroke="#2962FF" strokeWidth={Math.max(1, sw - 0.5)} strokeOpacity={0.7} />
                          <text x={Math.min(d.x1, d.x2) + 4} y={d.y1 + dy * r - 3} fill="#2962FF" fontSize={10}>
                            {(r * 100).toFixed(1)}%
                          </text>
                        </g>
                      ))}
                    </g>
                  );
                }
                const topY = Math.min(d.y1, d.y2);
                const h = Math.abs(d.y2 - d.y1);
                const w = Math.max(40, Math.abs(d.x2 - d.x1));
                return (
                  <g key={d.id}>
                    <rect x={Math.min(d.x1, d.x2)} y={topY} width={w} height={h * 0.65} fill="rgba(8,153,129,0.18)" stroke="#089981" strokeWidth={sw} />
                    <rect x={Math.min(d.x1, d.x2)} y={topY + h * 0.65} width={w} height={h * 0.35} fill="rgba(242,54,69,0.18)" stroke="#F23645" strokeWidth={sw} />
                  </g>
                );
              })}
          </svg>
        </div>

        {/* Bottom Range Bar (TradingView 36px Footer) */}
        <div className="h-[36px] bg-[#FFFFFF] px-3 flex items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none">
            {(["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "ALL"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  onChangeTimeframe("1D");
                  setRangePreset(r);
                }}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition ${
                  rangePreset === r ? "bg-[#F0F3FA] text-[#2962FF]" : "text-[#131722] hover:bg-[#F8F9FD]"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5 text-[11px] font-mono text-[#787B86] shrink-0">
            <span className="hidden lg:inline">
              <strong className="text-[#2962FF]">E</strong> • <strong className="text-[#089981]">D</strong> • <strong className="text-amber-600">S</strong>
            </span>
            <span suppressHydrationWarning className="text-[#131722] font-semibold tabular-nums">
              {utcClock}
            </span>
            <span className="text-[#E0E3EB]">|</span>
            <button
              type="button"
              onClick={() => setLogScale((v) => !v)}
              className={`px-1.5 py-0.5 rounded font-sans text-[11px] font-semibold transition ${
                logScale ? "bg-[#F0F3FA] text-[#2962FF]" : "text-[#787B86] hover:text-[#131722]"
              }`}
            >
              log
            </button>
            <button
              type="button"
              onClick={handleAutoFit}
              className="px-1.5 py-0.5 rounded font-sans text-[11px] font-semibold text-[#2962FF] hover:bg-[#F0F3FA] transition"
            >
              auto
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  const canvas = chartRef.current?.takeScreenshot();
                  if (!canvas) return;
                  const a = document.createElement("a");
                  a.href = canvas.toDataURL("image/png");
                  a.download = `${symbol.replace(/[^a-zA-Z0-9._-]/g, "_")}_${timeframe}.png`;
                  a.click();
                } catch {
                  // ignore
                }
              }}
              aria-label="Download Chart Snapshot PNG"
              title="Snapshot Chart PNG"
              className="p-1 rounded text-[#787B86] hover:text-[#2962FF] hover:bg-[#F0F3FA] transition"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
            <a
              href={apiUrl(
                `/api/export/history/${encodeURIComponent(symbol)}.csv?interval=${mapTimeframeToParams(timeframe, rangePreset).interval}&period=${mapTimeframeToParams(timeframe, rangePreset).period}`
              )}
              download
              aria-label="Export Chart OHLCV CSV"
              title="Export Chart OHLCV CSV"
              className="p-1 rounded text-[#787B86] hover:text-[#2962FF] hover:bg-[#F0F3FA] transition"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Indicators Modal (55+ Catalog & Chained Builder) */}
      {indicatorsOpen && (
        <div className="fixed inset-0 z-[70] bg-[#131722]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl shadow-2xl max-w-lg w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E0E3EB] pb-3">
              <h3 className="text-base font-bold text-[#131722]">Indicators &amp; Strategies ({catalog.length})</h3>
              <button
                type="button"
                aria-label="Close Indicators Modal"
                title="Close Indicators Modal"
                onClick={onCloseIndicators}
                className="text-[#787B86] hover:text-[#131722]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setActiveChain([{ fn: "ema", period: 20 }]);
                  onCloseIndicators();
                }}
                className="px-3 py-1.5 rounded-lg bg-[#F8F9FD] border border-[#E0E3EB] hover:border-[#2962FF] font-semibold text-[#131722]"
              >
                EMA (20)
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveChain([{ fn: "vwap", period: 14 }]);
                  onCloseIndicators();
                }}
                className="px-3 py-1.5 rounded-lg bg-[#F8F9FD] border border-[#E0E3EB] hover:border-[#2962FF] font-semibold text-[#131722]"
              >
                VWAP
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveChain([{ fn: "rsi", period: 14 }, { fn: "ema", period: 9 }]);
                  onCloseIndicators();
                }}
                className="px-3 py-1.5 rounded-lg bg-[#2962FF]/10 border border-[#2962FF]/30 text-[#2962FF] font-bold"
              >
                Chain: EMA(9) of RSI(14)
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveChain([]);
                  onCloseIndicators();
                }}
                className="px-3 py-1.5 rounded-lg bg-[#FFEBEE] text-[#F23645] font-semibold"
              >
                Clear Overlay
              </button>
            </div>

            <input
              value={indicatorSearch}
              onChange={(e) => setIndicatorSearch(e.target.value)}
              placeholder="Search 55+ technical indicators..."
              className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 text-xs text-[#131722] outline-none focus:border-[#2962FF]"
            />

            <div className="max-h-60 overflow-y-auto divide-y divide-[#F0F3FA]">
              {catalog
                .filter((c) => c.name.toLowerCase().includes(indicatorSearch.toLowerCase()) || c.id.includes(indicatorSearch.toLowerCase()))
                .map((ind) => (
                  <button
                    key={ind.id}
                    type="button"
                    onClick={() => {
                      setActiveChain([{ fn: ind.id, period: 14 }]);
                      onCloseIndicators();
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[#F0F3FA] flex items-center justify-between text-xs"
                  >
                    <span className="font-semibold text-[#131722]">{ind.name}</span>
                    <span className="text-[10px] font-mono text-[#787B86] uppercase">{ind.group}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
