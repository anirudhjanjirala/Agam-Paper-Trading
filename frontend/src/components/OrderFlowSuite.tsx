"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Layers, RefreshCw } from "lucide-react";
import { formatNumber, getPricePrecision } from "@/lib/format";
import { apiUrl } from "@/lib/api";

interface OrderFlowData {
  symbol: string;
  interval: string;
  volume_profile: {
    poc: number;
    vah: number;
    val: number;
    total_volume: number;
    buckets: Array<{
      price_low: number;
      price_high: number;
      price_mid: number;
      buy_vol: number;
      sell_vol: number;
      total_vol: number;
    }>;
  };
  tpo_profile: {
    tpo_poc: number;
    ib_high: number;
    ib_low: number;
    rows: Array<{ price: number; letters: string; tpo_count: number }>;
  };
  footprint: Array<{
    time: string | number;
    open: number;
    high: number;
    low: number;
    close: number;
    bar_delta: number;
    cumulative_delta: number;
    levels: Array<{
      price: number;
      bid_vol: number;
      ask_vol: number;
      delta: number;
      imbalance: string;
    }>;
  }>;
}

export default function OrderFlowSuite({ symbol }: { symbol: string }) {
  const [data, setData] = useState<OrderFlowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"vp" | "tpo" | "footprint">("vp");
  const [interval, setInterval] = useState<"5m" | "15m" | "1h" | "4h" | "1d">("15m");

  const periodForIv = interval === "5m" ? "2d" : interval === "15m" ? "5d" : interval === "1h" ? "1mo" : interval === "4h" ? "3mo" : "6mo";

  const loadOrderFlow = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/orderflow/${encodeURIComponent(symbol)}?interval=${interval}&period=${periodForIv}`));
      if (res.ok) setData(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, periodForIv]);

  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();
    fetch(apiUrl(`/api/orderflow/${encodeURIComponent(symbol)}?interval=${interval}&period=${periodForIv}`), {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!controller.signal.aborted && d) setData(d);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [symbol, interval, periodForIv]);

  const maxBucketVol = Math.max(...(data?.volume_profile?.buckets.map((b) => b.total_vol) || [1]), 1);
  const refPx = data?.volume_profile?.poc || data?.tpo_profile?.tpo_poc || 100;
  const pxPrec = getPricePrecision(refPx, symbol);
  const pocTol = Math.max(Math.abs(refPx) * 0.0005, 10 ** -Math.max(4, pxPrec));

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E0E3EB]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#2962FF]/10 rounded-xl text-[#2962FF]">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#131722]">Order Flow Suite — {symbol}</h3>
            <p className="text-xs text-[#787B86]">
              Volume Profile (POC/VAH/VAL) • TPO Market Profile • Bid×Ask Footprint (Lee-Ready)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Order Flow Timeframe"
            value={interval}
            onChange={(e) => setInterval(e.target.value as "5m" | "15m" | "1h" | "4h" | "1d")}
            className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2 py-1 text-xs font-mono font-bold text-[#131722] outline-none"
          >
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
            <option value="1d">1D</option>
          </select>
          <div className="flex bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg p-1 text-xs font-bold">
            <button
              onClick={() => setView("vp")}
              className={`px-3 py-1 rounded-md transition ${view === "vp" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"}`}
            >
              Volume Profile
            </button>
            <button
              onClick={() => setView("tpo")}
              className={`px-3 py-1 rounded-md transition ${view === "tpo" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"}`}
            >
              TPO Profile
            </button>
            <button
              onClick={() => setView("footprint")}
              className={`px-3 py-1 rounded-md transition ${view === "footprint" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"}`}
            >
              Bid×Ask Footprint
            </button>
          </div>
          <button
            type="button"
            onClick={loadOrderFlow}
            aria-label="Refresh Order Flow"
            title="Refresh Order Flow"
            className="p-2 bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg text-[#787B86] hover:text-[#131722]"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-[#2962FF]" : ""}`} />
          </button>
        </div>
      </div>

      {!data ? (
        <div className="py-10 text-center text-xs text-[#787B86] font-mono">Computing Order Flow matrices...</div>
      ) : (
        <>
          {view === "vp" && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
                  <span className="text-[11px] text-[#2962FF] font-bold block">POC (Point of Control)</span>
                  <span className="text-lg font-black text-[#131722] font-mono">{formatNumber(data.volume_profile.poc, pxPrec, pxPrec)}</span>
                </div>
                <div className="bg-[#E8F5E9]/60 border border-[#089981]/30 rounded-xl p-3">
                  <span className="text-[11px] text-[#089981] font-bold block">VAH (Value Area High)</span>
                  <span className="text-lg font-black text-[#131722] font-mono">{formatNumber(data.volume_profile.vah, pxPrec, pxPrec)}</span>
                </div>
                <div className="bg-[#FFEBEE]/60 border border-[#F23645]/30 rounded-xl p-3">
                  <span className="text-[11px] text-[#F23645] font-bold block">VAL (Value Area Low)</span>
                  <span className="text-lg font-black text-[#131722] font-mono">{formatNumber(data.volume_profile.val, pxPrec, pxPrec)}</span>
                </div>
              </div>

              <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3 space-y-1 max-h-[340px] overflow-y-auto">
                {[...data.volume_profile.buckets].reverse().map((b, i) => {
                  const pct = (b.total_vol / maxBucketVol) * 100;
                  const buyPct = b.total_vol > 0 ? (b.buy_vol / b.total_vol) * pct : 0;
                  const sellPct = Math.max(0, pct - buyPct);
                  const isPoc = Math.abs(b.price_mid - data.volume_profile.poc) <= pocTol;
                  return (
                    <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                      <span className={`w-24 text-right ${isPoc ? "text-[#2962FF] font-extrabold" : "text-[#787B86]"}`}>
                        {formatNumber(b.price_mid, pxPrec, pxPrec)}
                      </span>
                      <div className="flex-1 h-4 bg-[#E0E3EB]/60 rounded overflow-hidden flex">
                        <div style={{ width: `${buyPct}%` }} className="bg-[#089981] h-full" />
                        <div style={{ width: `${sellPct}%` }} className="bg-[#F23645] h-full" />
                      </div>
                      <span className="w-20 text-right text-[#787B86]">{formatNumber(b.total_vol, 0, 0)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {view === "tpo" && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
                  <span className="text-[11px] text-[#2962FF] font-bold block">TPO POC</span>
                  <span className="text-lg font-black text-[#131722] font-mono">{formatNumber(data.tpo_profile.tpo_poc, pxPrec, pxPrec)}</span>
                </div>
                <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
                  <span className="text-[11px] text-[#787B86] font-bold block">Initial Balance High</span>
                  <span className="text-lg font-black text-[#131722] font-mono">{formatNumber(data.tpo_profile.ib_high, pxPrec, pxPrec)}</span>
                </div>
                <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
                  <span className="text-[11px] text-[#787B86] font-bold block">Initial Balance Low</span>
                  <span className="text-lg font-black text-[#131722] font-mono">{formatNumber(data.tpo_profile.ib_low, pxPrec, pxPrec)}</span>
                </div>
              </div>
              <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3 space-y-1 max-h-[340px] overflow-y-auto font-mono text-xs">
                {data.tpo_profile.rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-24 text-right text-[#787B86]">{formatNumber(r.price, pxPrec, pxPrec)}</span>
                    <span className="text-[#2962FF] tracking-widest font-bold">{r.letters || "·"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === "footprint" && (
            <div className="overflow-x-auto flex gap-3 pb-2">
              {data.footprint.slice(-6).map((bar, idx) => (
                <div key={idx} className="min-w-[200px] bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3 font-mono text-[11px] space-y-1.5">
                  <div className="flex justify-between border-b border-[#E0E3EB] pb-1 text-[#787B86]">
                    <span>Bar #{idx + 1}</span>
                    <span className={bar.bar_delta >= 0 ? "text-[#089981] font-bold" : "text-[#F23645] font-bold"}>
                      Δ {bar.bar_delta >= 0 ? "+" : ""}{formatNumber(bar.bar_delta, 0, 2)}
                    </span>
                  </div>
                  {bar.levels.map((lv, li) => (
                    <div key={li} className="flex items-center justify-between gap-2 py-0.5">
                      <span className="text-[#787B86]">{formatNumber(lv.price, pxPrec, pxPrec)}</span>
                      <div className="flex items-center gap-1">
                        <span className={`px-1 rounded ${lv.imbalance === "BID_IMB" ? "bg-[#FFEBEE] text-[#F23645] font-bold" : "text-[#F23645]"}`}>
                          {lv.bid_vol}
                        </span>
                        <span className="text-[#9598A1]">×</span>
                        <span className={`px-1 rounded ${lv.imbalance === "ASK_IMB" ? "bg-[#E8F5E9] text-[#089981] font-bold" : "text-[#089981]"}`}>
                          {lv.ask_vol}
                        </span>
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-[#E0E3EB] pt-1 flex justify-between text-[10px] text-[#787B86]">
                    <span>Cum Delta:</span>
                    <span className={bar.cumulative_delta >= 0 ? "text-[#089981] font-bold" : "text-[#F23645] font-bold"}>
                      {bar.cumulative_delta}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
