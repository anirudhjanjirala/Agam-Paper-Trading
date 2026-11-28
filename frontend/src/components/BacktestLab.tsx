"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createChart, ColorType, LineSeries, LineStyle, IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { FlaskConical, Play, TrendingUp } from "lucide-react";
import { dedupeAscByTime, formatAssetPrice, formatNumber } from "@/lib/format";
import { apiUrl } from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";

interface BacktestTrade {
  side: "LONG" | "SHORT";
  entry_time: string | number;
  exit_time: string | number;
  entry_price: number;
  exit_price: number;
  return_pct: number;
  pnl: number;
  open?: boolean;
}

interface BacktestResult {
  symbol: string;
  interval: string;
  period: string;
  currency: string;
  strategy: string;
  bars_tested: number;
  initial_capital: number;
  final_equity: number;
  total_return_pct: number;
  buy_hold_return_pct: number;
  alpha_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  profit_factor: number;
  win_rate_pct: number;
  total_trades: number;
  equity_curve: Array<{ time: string | number; strategy_equity: number; benchmark_equity: number }>;
  trades: BacktestTrade[];
  error?: string;
}

const STRATEGIES = [
  { id: "ema_cross", label: "EMA (9/21) Trend Cross" },
  { id: "supertrend", label: "Supertrend (10, 3.0)" },
  { id: "rsi_reversion", label: "RSI (14) Mean Reversion" },
  { id: "macd_momentum", label: "MACD (12/26/9) Momentum" },
  { id: "bb_breakout", label: "Bollinger (20, 2σ) Breakout" },
] as const;

export default function BacktestLab({ defaultSymbol }: { defaultSymbol: string }) {
  const { theme } = useTheme();
  const [symDraft, setSymDraft] = useState<{ base: string; val: string } | null>(null);
  const symbol = symDraft?.base === defaultSymbol ? symDraft.val : defaultSymbol;
  const [strategy, setStrategy] = useState<string>("ema_cross");
  const [interval, setIntervalVal] = useState<"15m" | "1h" | "4h" | "1d">("1d");
  const [period, setPeriod] = useState<"1mo" | "3mo" | "6mo" | "1y" | "2y">("1y");
  const [feeBps, setFeeBps] = useState("5");
  const [allowShort, setAllowShort] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const chartEl = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const stratSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bhSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const runBacktest = useCallback(async (symOverride?: string) => {
    const targetSym = (symOverride ?? symbol).trim().toUpperCase();
    if (!targetSym) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/backtest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: targetSym,
          interval,
          period,
          strategy,
          initial_capital: 100000,
          fee_bps: Math.max(0, parseFloat(feeBps) || 0),
          allow_short: allowShort,
        }),
      });
      if (res.ok) {
        setResult(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, period, strategy, feeBps, allowShort]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runBacktest(defaultSymbol);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSymbol, strategy, interval, period, allowShort]);

  useEffect(() => {
    if (!chartEl.current) return;
    const isDark = theme === "dark";
    const chart = createChart(chartEl.current, {
      layout: {
        background: { type: ColorType.Solid, color: isDark ? "#0B0E14" : "#FFFFFF" },
        textColor: isDark ? "#D1D4DC" : "#131722",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: isDark ? "#1E222D" : "#F0F3FA" },
        horzLines: { color: isDark ? "#1E222D" : "#F0F3FA" },
      },
      rightPriceScale: { borderColor: isDark ? "#2A2E39" : "#E0E3EB" },
      timeScale: { borderColor: isDark ? "#2A2E39" : "#E0E3EB", timeVisible: true },
    });
    chartRef.current = chart;
    bhSeriesRef.current = chart.addSeries(LineSeries, {
      color: "#9598A1",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
    });
    stratSeriesRef.current = chart.addSeries(LineSeries, {
      color: "#2962FF",
      lineWidth: 2,
      priceLineVisible: true,
    });
    const ro = new ResizeObserver(() => {
      if (chartEl.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartEl.current.clientWidth, height: 220 });
      }
    });
    ro.observe(chartEl.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      stratSeriesRef.current = null;
      bhSeriesRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    if (!result?.equity_curve?.length || !stratSeriesRef.current || !bhSeriesRef.current) return;
    const stratPts = dedupeAscByTime(
      result.equity_curve.map((p) => ({ time: p.time, value: p.strategy_equity }))
    ) as Array<{ time: Time; value: number }>;
    const bhPts = dedupeAscByTime(
      result.equity_curve.map((p) => ({ time: p.time, value: p.benchmark_equity }))
    ) as Array<{ time: Time; value: number }>;
    stratSeriesRef.current.setData(stratPts);
    bhSeriesRef.current.setData(bhPts);
    chartRef.current?.timeScale().fitContent();
  }, [result]);

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-4 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E0E3EB]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#2962FF]/10 rounded-xl text-[#2962FF]">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#131722]">Vectorized Strategy Backtester — Quant Lab</h3>
            <p className="text-xs text-[#787B86]">
              Test systematic strategies vs Buy &amp; Hold over live historical OHLCV bars (Equities, Crypto 24/7 &amp; Forex)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            aria-label="Backtest Symbol"
            value={symbol}
            onChange={(e) => setSymDraft({ base: defaultSymbol, val: e.target.value.toUpperCase() })}
            className="w-28 bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2.5 py-1.5 font-mono font-bold text-[#131722] outline-none"
            placeholder="BTC-USD"
          />
          <select
            aria-label="Backtest Strategy"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2.5 py-1.5 font-bold text-[#131722] outline-none"
          >
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Backtest Timeframe"
            value={interval}
            onChange={(e) => setIntervalVal(e.target.value as "15m" | "1h" | "4h" | "1d")}
            className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2 py-1.5 font-mono font-bold text-[#131722]"
          >
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
            <option value="1d">1D</option>
          </select>
          <select
            aria-label="Backtest Period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as "1mo" | "3mo" | "6mo" | "1y" | "2y")}
            className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2 py-1.5 font-mono font-bold text-[#131722]"
          >
            <option value="1mo">1M</option>
            <option value="3mo">3M</option>
            <option value="6mo">6M</option>
            <option value="1y">1Y</option>
            <option value="2y">2Y</option>
          </select>
          <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F8F9FD] border border-[#E0E3EB] font-semibold text-[#131722] cursor-pointer">
            <input type="checkbox" checked={allowShort} onChange={(e) => setAllowShort(e.target.checked)} className="accent-[#2962FF]" />
            Long+Short
          </label>
          <div className="inline-flex items-center gap-1 bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2 py-1 font-mono">
            <span className="text-[10px] text-[#787B86]">Fee bps:</span>
            <input
              type="number"
              min="0"
              step="1"
              value={feeBps}
              onChange={(e) => setFeeBps(e.target.value)}
              className="w-10 bg-transparent font-bold text-[#131722] outline-none text-right"
            />
          </div>
          <button
            type="button"
            onClick={() => runBacktest()}
            disabled={loading}
            className="px-3.5 py-1.5 rounded-lg bg-[#2962FF] hover:bg-[#1E53E5] disabled:opacity-50 text-white font-bold inline-flex items-center gap-1.5 transition"
          >
            <Play className="w-3.5 h-3.5" /> {loading ? "Running..." : "Run Backtest"}
          </button>
        </div>
      </div>

      {result?.error ? (
        <div className="py-6 text-center text-xs text-[#F23645] font-semibold">{result.error}</div>
      ) : result ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-2.5">
              <span className="text-[10px] text-[#787B86] uppercase font-mono block">Strategy Return</span>
              <span className={`text-base font-black font-mono ${result.total_return_pct >= 0 ? "text-[#089981]" : "text-[#F23645]"}`}>
                {result.total_return_pct >= 0 ? "+" : ""}{result.total_return_pct.toFixed(2)}%
              </span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-2.5">
              <span className="text-[10px] text-[#787B86] uppercase font-mono block">Alpha vs Buy&amp;Hold</span>
              <span className={`text-base font-black font-mono ${result.alpha_pct >= 0 ? "text-[#089981]" : "text-[#F23645]"}`}>
                {result.alpha_pct >= 0 ? "+" : ""}{result.alpha_pct.toFixed(2)}%
              </span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-2.5">
              <span className="text-[10px] text-[#787B86] uppercase font-mono block">Sharpe Ratio</span>
              <span className="text-base font-black font-mono text-[#2962FF]">{result.sharpe_ratio.toFixed(2)}</span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-2.5">
              <span className="text-[10px] text-[#787B86] uppercase font-mono block">Max Drawdown</span>
              <span className="text-base font-black font-mono text-[#F23645]">-{result.max_drawdown_pct.toFixed(2)}%</span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-2.5">
              <span className="text-[10px] text-[#787B86] uppercase font-mono block">Win Rate ({result.total_trades})</span>
              <span className="text-base font-black font-mono text-[#131722]">{result.win_rate_pct.toFixed(1)}%</span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-2.5">
              <span className="text-[10px] text-[#787B86] uppercase font-mono block">Profit Factor</span>
              <span className="text-base font-black font-mono text-[#089981]">{result.profit_factor.toFixed(2)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl p-2.5">
              <div className="flex items-center justify-between text-[11px] font-mono text-[#787B86] mb-1.5 px-1">
                <span className="font-bold text-[#131722] flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-[#2962FF]" />
                  Equity Curve ({result.bars_tested} bars)
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-[#2962FF] font-bold">● Strategy (${formatNumber(result.final_equity, 0)})</span>
                  <span>┈ Buy &amp; Hold ({result.buy_hold_return_pct >= 0 ? "+" : ""}{result.buy_hold_return_pct.toFixed(1)}%)</span>
                </div>
              </div>
              <div ref={chartEl} className="w-full h-[220px]" />
            </div>

            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-2.5 overflow-y-auto max-h-[260px]">
              <div className="text-[10px] font-mono font-bold uppercase text-[#787B86] mb-2">
                Simulated Trades ({result.trades.length})
              </div>
              {result.trades.length === 0 ? (
                <p className="text-xs text-[#787B86] py-6 text-center">No signals triggered over window.</p>
              ) : (
                <div className="space-y-1.5 text-[11px] font-mono">
                  {result.trades.slice(0, 20).map((t, i) => (
                    <div key={i} className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-lg px-2 py-1.5 flex items-center justify-between gap-2">
                      <div>
                        <span className={`font-bold ${t.side === "LONG" ? "text-[#089981]" : "text-[#F23645]"}`}>
                          {t.side} {t.open ? "(OPEN)" : ""}
                        </span>
                        <span className="text-[10px] text-[#787B86] block">
                          {formatAssetPrice(t.entry_price, result.currency, result.symbol)} → {formatAssetPrice(t.exit_price, result.currency, result.symbol)}
                        </span>
                      </div>
                      <span className={`font-bold ${t.return_pct >= 0 ? "text-[#089981]" : "text-[#F23645]"}`}>
                        {t.return_pct >= 0 ? "+" : ""}{t.return_pct.toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="py-8 text-center text-xs text-[#787B86] font-mono">Initializing Quant Backtest Engine...</div>
      )}
    </div>
  );
}
