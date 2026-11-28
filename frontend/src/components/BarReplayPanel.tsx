"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createChart, ColorType, CandlestickSeries, IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Shield, FastForward } from "lucide-react";
import { dedupeAscByTime, formatAssetPrice, formatNumber, formatQty, getPricePrecision } from "@/lib/format";
import { apiUrl } from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";

interface ReplaySnapshot {
  session_id: string;
  symbol: string;
  interval: string;
  currency: string;
  total_bars: number;
  cursor: number;
  has_next: boolean;
  has_prev: boolean;
  visible_bars: Array<{ time: string | number; open: number; high: number; low: number; close: number }>;
  current_price: number;
  current_time: string | number;
  isolated_wallet: {
    cash: number;
    initial_cash: number;
    position_qty: number;
    avg_entry_price: number;
    realized_pnl: number;
    unrealized_pnl: number;
    total_equity: number;
    return_pct?: number;
    max_drawdown_pct?: number;
    win_rate_pct?: number;
    closed_trades?: number;
    trades: Array<{ side: string; qty: number; price: number; bar_time: string | number }>;
  };
}

export default function BarReplayPanel({ defaultSymbol }: { defaultSymbol: string }) {
  const { theme } = useTheme();
  const symbol = defaultSymbol;
  const [session, setSession] = useState<ReplaySnapshot | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(900);
  const [qtyStr, setQtyStr] = useState("1");
  const [tradeErr, setTradeErr] = useState<string | null>(null);

  const chartEl = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const startSession = useCallback(async () => {
    setPlaying(false);
    const res = await fetch(apiUrl("/api/replay/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, interval: "1d", period: "6mo", start_ratio: 0.45, initial_cash: 100000 }),
    });
    if (res.ok) setSession(await res.json());
  }, [symbol]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl("/api/replay/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ symbol, interval: "1d", period: "6mo", start_ratio: 0.45, initial_cash: 100000 }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!controller.signal.aborted && d) {
          setPlaying(false);
          setSession(d);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [symbol]);

  const stepBar = useCallback(async (sessionId: string, delta: number) => {
    const res = await fetch(apiUrl(`/api/replay/${sessionId}/step?delta=${delta}`), { method: "POST" });
    if (res.ok) {
      const next: ReplaySnapshot = await res.json();
      setSession(next);
      if (!next.has_next) setPlaying(false);
    }
  }, []);

  const tradeReplay = async (side: "BUY" | "SELL") => {
    if (!session) return;
    const q = Math.max(0.0001, parseFloat(qtyStr) || 1);
    setTradeErr(null);
    const res = await fetch(apiUrl(`/api/replay/${session.session_id}/trade`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side, quantity: q }),
    });
    if (res.ok) {
      setSession(await res.json());
    } else {
      const errBody = await res.json().catch(() => null);
      setTradeErr(errBody?.detail || "Replay trade failed");
    }
  };

  useEffect(() => {
    if (!chartRef.current) return;
    const isDark = theme === "dark";
    chartRef.current.applyOptions({
      layout: { background: { type: ColorType.Solid, color: isDark ? "#0B0E14" : "#FFFFFF" }, textColor: isDark ? "#D1D4DC" : "#131722" },
      grid: { vertLines: { color: isDark ? "#1E222D" : "#F0F3FA" }, horzLines: { color: isDark ? "#1E222D" : "#F0F3FA" } },
      rightPriceScale: { borderColor: isDark ? "#2A2E39" : "#E0E3EB" },
      timeScale: { borderColor: isDark ? "#2A2E39" : "#E0E3EB" },
    });
  }, [theme]);

  useEffect(() => {
    if (!playing || !session?.session_id) return;
    const sid = session.session_id;
    const t = setInterval(() => stepBar(sid, 1), speedMs);
    return () => clearInterval(t);
  }, [playing, speedMs, session?.session_id, stepBar]);

  useEffect(() => {
    if (!chartEl.current) return;
    const chart = createChart(chartEl.current, {
      layout: { background: { type: ColorType.Solid, color: "#FFFFFF" }, textColor: "#131722", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "#F0F3FA" }, horzLines: { color: "#F0F3FA" } },
      rightPriceScale: { borderColor: "#E0E3EB" },
      timeScale: { borderColor: "#E0E3EB", timeVisible: true },
    });
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#089981",
      downColor: "#F23645",
      borderVisible: false,
      wickUpColor: "#089981",
      wickDownColor: "#F23645",
    });

    const ro = new ResizeObserver(() => {
      if (chartEl.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartEl.current.clientWidth, height: 340 });
      }
    });
    ro.observe(chartEl.current);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!session || !seriesRef.current) return;
    const prec = getPricePrecision(session.current_price, session.symbol);
    seriesRef.current.applyOptions({
      priceFormat: { type: "price", precision: prec, minMove: Number((10 ** -prec).toFixed(prec)) },
    });
    seriesRef.current.setData(
      dedupeAscByTime(
        session.visible_bars.map((b) => ({
          time: b.time as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        })) as Array<{ time: string | number; open: number; high: number; low: number; close: number }>
      ) as Array<{ time: Time; open: number; high: number; low: number; close: number }>
    );
    chartRef.current?.timeScale().fitContent();
  }, [session]);

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E0E3EB]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#2962FF]/10 rounded-xl text-[#2962FF]">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#131722] flex items-center gap-2">
              Isolated Bar Replay Studio — {symbol}
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F0F3FA] text-[#2962FF] font-mono font-bold">
                ISOLATED FROM LIVE PORTFOLIO
              </span>
            </h3>
            <p className="text-xs text-[#787B86]">Historical bar-by-bar simulation with independent replay wallet & P&L</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => session && stepBar(session.session_id, -1)}
            disabled={!session?.has_prev}
            aria-label="Step Backward"
            title="Step Backward"
            className="p-2 bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg text-[#131722] hover:bg-[#F0F3FA] disabled:opacity-40"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="px-3.5 py-2 rounded-lg bg-[#2962FF] hover:bg-[#1E53E5] text-white font-bold text-xs flex items-center gap-1"
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => session && stepBar(session.session_id, 1)}
            disabled={!session?.has_next}
            aria-label="Step Forward"
            title="Step Forward 1 Bar"
            className="p-2 bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg text-[#131722] hover:bg-[#F0F3FA] disabled:opacity-40"
          >
            <SkipForward className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => session && stepBar(session.session_id, 5)}
            disabled={!session?.has_next}
            title="Skip +5 Bars"
            className="px-2 py-1.5 bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg text-[11px] font-mono font-bold text-[#131722] hover:bg-[#F0F3FA] disabled:opacity-40 inline-flex items-center gap-0.5"
          >
            <FastForward className="w-3 h-3" />+5
          </button>
          <select
            aria-label="Replay Playback Speed"
            value={speedMs}
            onChange={(e) => setSpeedMs(Number(e.target.value))}
            className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-[#131722]"
          >
            <option value={900}>1x Speed</option>
            <option value={300}>3x Speed</option>
            <option value={100}>10x Speed</option>
          </select>
          <button
            type="button"
            onClick={startSession}
            aria-label="Restart Replay Session"
            title="Restart Replay Session"
            className="p-2 bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg text-[#787B86] hover:text-[#131722]"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl p-2">
          <div ref={chartEl} className="w-full h-[340px]" />
        </div>

        <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-4 flex flex-col justify-between space-y-3 text-xs">
          <div className="space-y-2">
            <div className="flex justify-between text-[#787B86]">
              <span>Bar Cursor:</span>
              <span className="font-mono text-[#131722] font-bold">
                {session ? `${session.cursor + 1} / ${session.total_bars}` : "--"}
              </span>
            </div>
            <div className="flex justify-between text-[#787B86]">
              <span>Replay Price:</span>
              <span className="font-mono text-[#2962FF] font-bold">
                {session ? formatAssetPrice(session.current_price, session.currency, session.symbol) : "--"}
              </span>
            </div>
            <div className="flex justify-between text-[#787B86]">
              <span>Isolated Cash:</span>
              <span className="font-mono text-[#131722] font-bold">
                {session ? formatAssetPrice(session.isolated_wallet.cash, session.currency) : "--"}
              </span>
            </div>
            <div className="flex justify-between text-[#787B86]">
              <span>Position (Long/Short):</span>
              <span className={`font-mono font-bold ${(session?.isolated_wallet.position_qty ?? 0) < 0 ? "text-[#F23645]" : "text-[#131722]"}`}>
                {formatQty(session?.isolated_wallet.position_qty ?? 0)}
                {(session?.isolated_wallet.position_qty ?? 0) !== 0
                  ? ` ${(session?.isolated_wallet.position_qty ?? 0) > 0 ? "LONG" : "SHORT"}`
                  : ""}
              </span>
            </div>
            <div className="flex justify-between text-[#787B86]">
              <span>Unrealized P&amp;L:</span>
              <span className={`font-mono font-bold ${(session?.isolated_wallet.unrealized_pnl ?? 0) >= 0 ? "text-[#089981]" : "text-[#F23645]"}`}>
                {formatNumber(session?.isolated_wallet.unrealized_pnl ?? 0, 2)}
              </span>
            </div>
            <div className="flex justify-between text-[#787B86]">
              <span>Realized P&amp;L:</span>
              <span className={`font-mono font-bold ${(session?.isolated_wallet.realized_pnl ?? 0) >= 0 ? "text-[#089981]" : "text-[#F23645]"}`}>
                {formatNumber(session?.isolated_wallet.realized_pnl ?? 0, 2)}
              </span>
            </div>
            <div className="flex justify-between text-[#787B86] text-[10px] pt-1 border-t border-[#E0E3EB]">
              <span>Ret: <strong>{session?.isolated_wallet.return_pct ?? 0}%</strong></span>
              <span>Win: <strong>{session?.isolated_wallet.win_rate_pct ?? 0}%</strong></span>
              <span>DD: <strong className="text-[#F23645]">-{session?.isolated_wallet.max_drawdown_pct ?? 0}%</strong></span>
            </div>
          </div>

          <div className="space-y-2 pt-3 border-t border-[#E0E3EB]">
            <div className="flex gap-1 text-[10px] font-mono">
              {["0.01", "0.1", "1", "10", "1000"].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQtyStr(q)}
                  className="flex-1 py-0.5 rounded bg-[#FFFFFF] border border-[#E0E3EB] text-[#787B86] hover:text-[#2962FF] font-bold"
                >
                  {q}
                </button>
              ))}
            </div>
            <input
              type="number"
              step="any"
              min="0.0001"
              value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value)}
              className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-lg px-3 py-1.5 text-[#131722] font-mono"
            />
            {tradeErr && (
              <div className="px-2.5 py-1.5 rounded-lg bg-[#FFEBEE] text-[#F23645] text-[11px] font-semibold">
                {tradeErr}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => tradeReplay("BUY")}
                className="py-2 rounded-lg bg-[#089981] hover:opacity-95 text-white font-bold"
              >
                Buy / Cover
              </button>
              <button
                onClick={() => tradeReplay("SELL")}
                className="py-2 rounded-lg bg-[#F23645] hover:opacity-95 text-white font-bold"
              >
                Sell / Short
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
