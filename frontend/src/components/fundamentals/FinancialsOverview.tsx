"use client";

import React, { useEffect, useState } from "react";
import CompanyHeader, { OverviewData } from "./CompanyHeader";
import CompanyInfoCard from "./CompanyInfoCard";
import PerformanceChart, { PerformancePoint } from "./PerformanceChart";
import WaterfallChart, { WaterfallStep } from "./WaterfallChart";
import DebtCoverageChart, { DebtCoveragePoint } from "./DebtCoverageChart";
import EpsChart, { EpsPoint } from "./EpsChart";
import CompanyNewsStream, { NewsArticle } from "../CompanyNewsStream";
import { RefreshCw, Calendar, Activity, Shield, Layers } from "lucide-react";
import { formatAssetPrice, formatNumber } from "@/lib/format";
import { apiUrl } from "@/lib/api";

interface FinancialsData {
  symbol: string;
  period: "annual" | "quarterly";
  performance: PerformancePoint[];
  waterfall: WaterfallStep[];
  debt_coverage: DebtCoveragePoint[];
  eps: EpsPoint[];
}

interface CorporateEvent {
  time: string;
  type: "E" | "D" | "S";
  label: string;
  detail: string;
}

interface TechnicalSnapshot {
  series?: Array<{ time: string | number; value: number }>;
  patterns?: Array<{ time: string | number; pattern: string; bias: string }>;
  expected_move?: { lower_1sd: number; upper_1sd: number; implied_move_pct?: number };
}

interface PeerInstrument {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  change_percent: number;
}

export default function FinancialsOverview({
  symbol,
  onBackToSuperchart,
  incomingBreaking,
}: {
  symbol: string;
  onBackToSuperchart: () => void;
  incomingBreaking?: NewsArticle | null;
}) {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [financials, setFinancials] = useState<FinancialsData | null>(null);
  const [events, setEvents] = useState<CorporateEvent[]>([]);
  const [expiries, setExpiries] = useState<{ expiries: string[]; source: string }>({ expiries: [], source: "" });
  const [technicals, setTechnicals] = useState<TechnicalSnapshot | null>(null);
  const [peers, setPeers] = useState<PeerInstrument[]>([]);
  const [period, setPeriod] = useState<"annual" | "quarterly">("annual");
  const [subTab, setSubTab] = useState<string>("Overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(apiUrl(`/api/asset/${encodeURIComponent(symbol)}/overview`), { signal: controller.signal }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(apiUrl(`/api/asset/${encodeURIComponent(symbol)}/financials?period=${period}`), {
        signal: controller.signal,
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(apiUrl(`/api/asset/${encodeURIComponent(symbol)}/events`), { signal: controller.signal }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(apiUrl(`/api/expiries/${encodeURIComponent(symbol)}`), { signal: controller.signal }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(apiUrl("/api/indicators/compute"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ symbol, interval: "1d", period: "3mo", chain: [{ fn: "rsi", period: 14 }, { fn: "ema", period: 9 }] }),
      }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([ov, fin, ev, exp, tech]) => {
        if (!controller.signal.aborted) {
          if (ov) setOverview(ov);
          if (fin) setFinancials(fin);
          if (ev?.markers) setEvents(ev.markers);
          if (exp) setExpiries({ expiries: exp.expiries || [], source: exp.source || "Exchange Live" });
          if (tech) setTechnicals(tech);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [symbol, period]);

  useEffect(() => {
    if ((subTab !== "ETFs" && subTab !== "Bonds") || !overview?.region) return;
    const cat = subTab === "ETFs" ? "etfs" : "bonds";
    const controller = new AbortController();
    fetch(apiUrl(`/api/assets?country=${overview.region}&category=${cat}&limit=12`), {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!controller.signal.aborted && Array.isArray(rows)) setPeers(rows);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [subTab, overview?.region]);

  if (loading && !overview) {
    return (
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-12 flex flex-col items-center justify-center gap-3 shadow-sm">
        <RefreshCw className="w-7 h-7 text-[#2962FF] animate-spin" />
        <span className="text-xs font-mono text-[#787B86]">Loading corporate fundamentals & statements for {symbol}...</span>
      </div>
    );
  }

  if (!overview) return null;

  const latestRsi = technicals?.series?.[technicals.series.length - 1]?.value;

  return (
    <div className="space-y-6">
      <CompanyHeader
        overview={overview}
        activeSubTab={subTab}
        onSelectSubTab={setSubTab}
        onBackToSuperchart={onBackToSuperchart}
      />

      {(subTab === "Overview" || subTab === "Filings") && <CompanyInfoCard overview={overview} />}

      {subTab === "Filings" && (
        <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 border-b border-[#E0E3EB] pb-3">
            <Calendar className="w-4 h-4 text-[#2962FF]" />
            <h3 className="text-sm font-bold text-[#131722]">Corporate Filings, Earnings & Capital Actions ({events.length})</h3>
          </div>
          {events.length === 0 ? (
            <p className="text-xs text-[#787B86] py-4">No corporate actions or EPS dates reported for {symbol}.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {[...events].reverse().slice(0, 12).map((ev, i) => (
                <div key={`${ev.time}-${i}`} className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3 text-xs flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[#787B86] text-[11px] block">{ev.time}</span>
                    <span className="font-bold text-[#131722]">{ev.detail}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-[#2962FF]/10 text-[#2962FF] font-bold text-[10px] shrink-0">{ev.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === "Technicals" && (
        <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-[#E0E3EB] pb-3">
            <Activity className="w-4 h-4 text-[#2962FF]" />
            <h3 className="text-sm font-bold text-[#131722]">Quantitative Technicals & Pattern Recognition</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3.5">
              <span className="text-[#787B86] block">EMA(9) of RSI(14) Chain</span>
              <span className="text-xl font-black font-mono text-[#2962FF] mt-1 block">
                {latestRsi !== undefined ? latestRsi.toFixed(2) : "--"}
              </span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3.5">
              <span className="text-[#787B86] block">10-Bar 1-SD Lower Bound</span>
              <span className="text-xl font-black font-mono text-[#F23645] mt-1 block">
                {technicals?.expected_move ? formatAssetPrice(technicals.expected_move.lower_1sd, overview.currency) : "--"}
              </span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3.5">
              <span className="text-[#787B86] block">10-Bar 1-SD Upper Bound</span>
              <span className="text-xl font-black font-mono text-[#089981] mt-1 block">
                {technicals?.expected_move ? formatAssetPrice(technicals.expected_move.upper_1sd, overview.currency) : "--"}
              </span>
            </div>
          </div>
          {technicals?.patterns && technicals.patterns.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-[#787B86] uppercase font-mono">Detected Candlestick Patterns</span>
              <div className="flex flex-wrap gap-2">
                {technicals.patterns.slice(-8).map((p, idx) => (
                  <span key={idx} className="px-2.5 py-1 rounded-lg bg-[#F8F9FD] border border-[#E0E3EB] text-xs font-mono text-[#131722]">
                    {String(p.time)} • <strong>{p.pattern}</strong> ({p.bias})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === "Options" && (
        <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-[#E0E3EB] pb-3">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#2962FF]" />
              <h3 className="text-sm font-bold text-[#131722]">Options Chain Expiries & Expected Move ({expiries.source || "Exchange"})</h3>
            </div>
          </div>
          {expiries.expiries.length === 0 ? (
            <p className="text-xs text-[#787B86] py-3">Listed options expiry contracts are unavailable for {symbol}.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {expiries.expiries.map((ex) => (
                <span key={ex} className="px-3 py-1.5 rounded-xl bg-[#F8F9FD] border border-[#E0E3EB] font-mono text-xs font-bold text-[#131722]">
                  {ex}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {(subTab === "ETFs" || subTab === "Bonds") && (
        <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 border-b border-[#E0E3EB] pb-3">
            <Layers className="w-4 h-4 text-[#2962FF]" />
            <h3 className="text-sm font-bold text-[#131722]">
              {overview.region} Regional {subTab} Universe
            </h3>
          </div>
          {peers.length === 0 ? (
            <p className="text-xs text-[#787B86] py-3">Loading regional {subTab} instruments...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {peers.map((item) => (
                <div key={item.symbol} className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <span className="font-mono font-bold text-[#131722] block">{item.symbol}</span>
                    <span className="text-[11px] text-[#787B86] truncate block">{item.name}</span>
                  </div>
                  <div className="text-right shrink-0 font-mono">
                    <span className="font-bold text-[#131722] block">
                      {item.price > 0 ? formatAssetPrice(item.price, item.currency) : "--"}
                    </span>
                    <span className={item.change_percent >= 0 ? "text-[#089981] text-[11px]" : "text-[#F23645] text-[11px]"}>
                      {item.change_percent >= 0 ? "+" : ""}{formatNumber(item.change_percent, 2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Annual / Quarterly Toggle + 4 Financial Statement Charts */}
      {(subTab === "Overview" || subTab === "Financials") && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl px-5 py-3 shadow-sm">
            <div>
              <h3 className="text-base font-bold text-[#131722]">Financial Statement Visualizations</h3>
              <p className="text-xs text-[#787B86]">Income Statement, Cash Flow, Balance Sheet &amp; Consensus EPS</p>
            </div>
            <div className="flex bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-1 text-xs font-bold">
              <button
                type="button"
                onClick={() => setPeriod("annual")}
                className={`px-3.5 py-1.5 rounded-lg transition ${
                  period === "annual" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
                }`}
              >
                Annual
              </button>
              <button
                type="button"
                onClick={() => setPeriod("quarterly")}
                className={`px-3.5 py-1.5 rounded-lg transition ${
                  period === "quarterly" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
                }`}
              >
                Quarterly
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PerformanceChart data={financials?.performance || []} currency={overview.currency} />
            <WaterfallChart data={financials?.waterfall || []} currency={overview.currency} />
            <DebtCoverageChart data={financials?.debt_coverage || []} currency={overview.currency} />
            <EpsChart data={financials?.eps || []} currency={overview.currency} />
          </div>
        </div>
      )}

      {/* Live Google News Stream integrated into Overview & dedicated News tab */}
      {(subTab === "Overview" || subTab === "News") && (
        <CompanyNewsStream symbol={symbol} incomingBreaking={incomingBreaking} />
      )}
    </div>
  );
}
