"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Filter, Play, Zap } from "lucide-react";
import { formatAssetPrice, formatNumber } from "@/lib/format";
import { apiUrl } from "@/lib/api";

interface ScreenerResult {
  symbol: string;
  name: string;
  region: string;
  exchange: string;
  category: string;
  currency: string;
  price: number;
  change_percent: number;
  volume: number;
  rsi_14: number;
}

export default function ScreenerPanel({
  onSelectSymbol,
}: {
  onSelectSymbol: (symbol: string) => void;
}) {
  const [region, setRegion] = useState("ALL");
  const [category, setCategory] = useState("all");
  const [onlyPriced, setOnlyPriced] = useState(true);
  const [rsiMax, setRsiMax] = useState<string>("");
  const [chgMin, setChgMin] = useState<string>("");
  const [scanMeta, setScanMeta] = useState<{ scanned: number; matched: number; ms: number } | null>(null);
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(true);

  const runScan = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/screener/scan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region,
          category,
          only_priced: onlyPriced,
          rsi_max: rsiMax ? parseFloat(rsiMax) : null,
          change_pct_min: chgMin ? parseFloat(chgMin) : null,
          sort_by: "volume",
          descending: true,
          limit: 60,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        setScanMeta({ scanned: d.scanned_universe, matched: d.matched_count, ms: d.scan_ms });
        setResults(d.results);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [region, category, onlyPriced, rsiMax, chgMin]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(apiUrl("/api/screener/scan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          region,
          category,
          only_priced: onlyPriced,
          rsi_max: rsiMax ? parseFloat(rsiMax) : null,
          change_pct_min: chgMin ? parseFloat(chgMin) : null,
          sort_by: "volume",
          descending: true,
          limit: 60,
        }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((d) => {
          if (!controller.signal.aborted && d) {
            setScanMeta({ scanned: d.scanned_universe, matched: d.matched_count, ms: d.scan_ms });
            setResults(d.results);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [region, category, onlyPriced, rsiMax, chgMin]);

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E0E3EB]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#2962FF]/10 rounded-xl text-[#2962FF]">
            <Filter className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#131722] flex items-center gap-2">
              Full-Market Polars Columnar Screener
              {scanMeta && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#E8F5E9] text-[#089981] font-bold">
                  Scanned {formatNumber(scanMeta.scanned, 0, 0)} tickers in {scanMeta.ms} ms
                </span>
              )}
            </h3>
            <p className="text-xs text-[#787B86]">Apache Arrow / Polars vectorized scan across IND, USA, CANADA, CHINA, EU, CRYPTO &amp; FOREX</p>
          </div>
        </div>

        <button
          onClick={runScan}
          disabled={loading}
          className="px-4 py-2 rounded-xl text-xs font-bold bg-[#2962FF] hover:bg-[#1E53E5] text-white flex items-center gap-1.5 shadow-sm transition"
        >
          <Zap className="w-3.5 h-3.5 fill-current" />
          {loading ? "Scanning..." : "Run Columnar Scan"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#787B86] mr-1">Pro Presets:</span>
        <button
          type="button"
          onClick={() => { setRegion("CRYPTO"); setCategory("crypto"); setOnlyPriced(true); setRsiMax(""); setChgMin("2"); }}
          className="px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-semibold hover:bg-amber-100 transition cursor-pointer"
        >
          Crypto 24h Movers (+2%)
        </button>
        <button
          type="button"
          onClick={() => { setRegion("FOREX"); setCategory("forex"); setOnlyPriced(true); setRsiMax(""); setChgMin(""); }}
          className="px-2.5 py-1 rounded-full bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 font-semibold hover:bg-teal-100 transition cursor-pointer"
        >
          Global FX Pairs
        </button>
        <button
          type="button"
          onClick={() => { setOnlyPriced(true); setRsiMax("35"); setChgMin(""); }}
          className="px-2.5 py-1 rounded-full bg-[#F8F9FD] dark:bg-slate-800 text-[#131722] dark:text-slate-200 border border-[#E0E3EB] dark:border-slate-700 font-semibold hover:bg-[#EFF2F7] transition cursor-pointer"
        >
          Oversold (RSI &lt; 35)
        </button>
        <button
          type="button"
          onClick={() => { setRegion("ALL"); setCategory("all"); setOnlyPriced(true); setRsiMax(""); setChgMin(""); }}
          className="px-2.5 py-1 rounded-full bg-[#F8F9FD] dark:bg-slate-800 text-[#131722] dark:text-slate-200 border border-[#E0E3EB] dark:border-slate-700 font-semibold hover:bg-[#EFF2F7] transition cursor-pointer"
        >
          All 7 Markets Top Vol
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
        <select
          aria-label="Screener Region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] font-semibold outline-none min-w-0"
        >
          <option value="ALL">All 7 Regions &amp; Asset Hubs</option>
          <option value="CRYPTO">Crypto (24/7 Spot &amp; Perps)</option>
          <option value="FOREX">Forex (Majors/Minors/Exotics)</option>
          <option value="IND">India (NSE/BSE)</option>
          <option value="USA">USA (NASDAQ/NYSE)</option>
          <option value="CANADA">Canada (TSX/TSXV)</option>
          <option value="CHINA">China (SSE/SZSE)</option>
          <option value="EU">Europe &amp; UK</option>
        </select>

        <select
          aria-label="Screener Asset Class"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] font-semibold outline-none min-w-0"
        >
          <option value="all">All Asset Classes</option>
          <option value="crypto">Cryptocurrencies</option>
          <option value="forex">Forex &amp; Currencies</option>
          <option value="stocks">Equities / Stocks</option>
          <option value="etfs">ETFs</option>
          <option value="bonds">Bonds &amp; Yields</option>
          <option value="indices">Indices</option>
          <option value="commodities">Futures &amp; Commodities</option>
        </select>

        <input
          type="number"
          placeholder="RSI(14) <= 40"
          value={rsiMax}
          onChange={(e) => setRsiMax(e.target.value)}
          className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] placeholder-[#787B86] font-mono outline-none min-w-0"
        />

        <input
          type="number"
          placeholder="Min Chg % (e.g. 1)"
          value={chgMin}
          onChange={(e) => setChgMin(e.target.value)}
          className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] placeholder-[#787B86] font-mono outline-none min-w-0"
        />

        <label className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 flex items-center gap-2 cursor-pointer text-[#131722] font-semibold whitespace-nowrap">
          <input
            type="checkbox"
            checked={onlyPriced}
            onChange={(e) => setOnlyPriced(e.target.checked)}
            className="accent-[#2962FF] shrink-0"
          />
          <span>Live Priced Only</span>
        </label>
      </div>

      <div className="overflow-x-auto max-h-[400px]">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[#F8F9FD]">
            <tr className="border-b border-[#E0E3EB] text-[#787B86] uppercase font-mono">
              <th className="py-2.5 px-3">Symbol / Name</th>
              <th className="py-2.5 px-3">Region / Exch</th>
              <th className="py-2.5 px-3">Class</th>
              <th className="py-2.5 px-3 text-right">Price</th>
              <th className="py-2.5 px-3 text-right">Change %</th>
              <th className="py-2.5 px-3 text-right">RSI(14)</th>
              <th className="py-2.5 px-3 text-right">Volume</th>
              <th className="py-2.5 px-3 text-center">Chart</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E0E3EB]">
            {results.map((r) => (
              <tr key={r.symbol} className="hover:bg-[#F8F9FD] transition">
                <td className="py-2.5 px-3">
                  <span className="font-mono font-bold text-[#131722] block">{r.symbol}</span>
                  <span className="text-[11px] text-[#787B86] truncate max-w-[200px] block">{r.name}</span>
                </td>
                <td className="py-2.5 px-3 font-mono text-[#131722] whitespace-nowrap">
                  {r.region} • <span className="text-[#787B86]">{r.exchange}</span>
                </td>
                <td className="py-2.5 px-3 uppercase text-[10px] font-bold text-[#2962FF]">{r.category}</td>
                <td className="py-2.5 px-3 text-right font-mono font-bold text-[#131722]">
                  {r.price > 0 ? formatAssetPrice(r.price, r.currency, r.symbol) : "--"}
                </td>
                <td className={`py-2.5 px-3 text-right font-mono font-bold ${r.change_percent >= 0 ? "text-[#089981]" : "text-[#F23645]"}`}>
                  {r.change_percent >= 0 ? "+" : ""}{r.change_percent.toFixed(2)}%
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-[#131722]">{r.rsi_14.toFixed(1)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[#787B86]">{formatNumber(r.volume, 0, 0)}</td>
                <td className="py-2.5 px-3 text-center">
                  <button
                    onClick={() => onSelectSymbol(r.symbol)}
                    className="px-2.5 py-1 rounded-lg bg-[#2962FF]/10 hover:bg-[#2962FF] text-[#2962FF] hover:text-white font-bold text-[11px] inline-flex items-center gap-1 transition"
                  >
                    <Play className="w-3 h-3" /> Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
