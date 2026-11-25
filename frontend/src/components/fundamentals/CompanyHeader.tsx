"use client";

import React, { useEffect, useRef, useState } from "react";
import { createChart, ColorType, BaselineSeries, LineStyle, IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { ExternalLink, Maximize2 } from "lucide-react";
import { dedupeAscByTime, formatAssetPrice, formatNumber, getCurrencySymbol } from "@/lib/format";
import { apiUrl } from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";

export interface OverviewData {
  symbol: string;
  name: string;
  exchange: string;
  region: string;
  currency: string;
  sector?: string;
  industry?: string;
  ceo?: string;
  ceo_title?: string;
  website?: string;
  headquarters?: string;
  employees?: number;
  ipo_date?: string;
  isin?: string;
  summary?: string;
  market_cap?: number;
  trailing_pe?: number;
  forward_pe?: number;
  dividend_yield?: number;
  beta?: number;
  week_52_high?: number;
  week_52_low?: number;
  shares_outstanding?: number;
  price?: number;
  prev_close?: number;
  change?: number;
  change_percent?: number;
  as_of?: string;
  returns: Record<string, number | null>;
  sparkline: Array<{ time: string; value: number }>;
  prev_close_ref?: number;
}

interface CompanyHeaderProps {
  overview: OverviewData;
  activeSubTab: string;
  onSelectSubTab: (tab: string) => void;
  onBackToSuperchart: () => void;
}

const RANGE_TO_API: Record<string, { interval: string; period: string }> = {
  "1D": { interval: "5m", period: "1d" },
  "5D": { interval: "15m", period: "5d" },
  "1M": { interval: "1d", period: "1mo" },
  "3M": { interval: "1d", period: "3mo" },
  "6M": { interval: "1d", period: "6mo" },
  YTD: { interval: "1d", period: "ytd" },
  "1Y": { interval: "1d", period: "1y" },
  "5Y": { interval: "1d", period: "5y" },
  "10Y": { interval: "1wk", period: "max" },
  ALL: { interval: "1mo", period: "max" },
};

const RETURN_LABELS: Record<string, string> = {
  "1D": "1 day",
  "5D": "5 days",
  "1M": "1 month",
  "3M": "3 months",
  "6M": "6 months",
  YTD: "Year to date",
  "1Y": "1 year",
  "5Y": "5 years",
  "10Y": "10 years",
  ALL: "All time",
};

export default function CompanyHeader({
  overview,
  activeSubTab,
  onSelectSubTab,
  onBackToSuperchart,
}: CompanyHeaderProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);

  const { theme } = useTheme();
  const [selectedRange, setSelectedRange] = useState<string>("1M");
  const [rangeSeries, setRangeSeries] = useState<Array<{ time: string | number; value: number }> | null>(null);

  useEffect(() => {
    if (!chartApiRef.current) return;
    const isDark = theme === "dark";
    chartApiRef.current.applyOptions({
      layout: { background: { type: ColorType.Solid, color: isDark ? "#0B0E14" : "#FFFFFF" }, textColor: isDark ? "#868993" : "#787B86" },
      grid: { vertLines: { color: isDark ? "#131722" : "#F8F9FD" }, horzLines: { color: isDark ? "#1E222D" : "#F0F3FA" } },
      rightPriceScale: { borderColor: isDark ? "#2A2E39" : "#E0E3EB" },
      timeScale: { borderColor: isDark ? "#2A2E39" : "#E0E3EB" },
    });
  }, [theme]);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const w = chartContainerRef.current.clientWidth || 800;
    const chart = createChart(chartContainerRef.current, {
      width: w,
      height: 220,
      layout: { background: { type: ColorType.Solid, color: "#FFFFFF" }, textColor: "#787B86", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "#F8F9FD" }, horzLines: { color: "#F0F3FA" } },
      rightPriceScale: { borderColor: "#E0E3EB" },
      timeScale: { borderColor: "#E0E3EB", timeVisible: true },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9598A1", style: LineStyle.Dotted },
        horzLine: { color: "#9598A1", style: LineStyle.Dotted },
      },
    });
    chartApiRef.current = chart;
    seriesRef.current = chart.addSeries(BaselineSeries, {
      baseValue: { type: "price", price: overview.prev_close_ref || overview.sparkline?.[0]?.value || 100 },
      topLineColor: "#089981",
      topFillColor1: "rgba(8,153,129,0.22)",
      topFillColor2: "rgba(8,153,129,0.0)",
      bottomLineColor: "#F23645",
      bottomFillColor1: "rgba(242,54,69,0.0)",
      bottomFillColor2: "rgba(242,54,69,0.22)",
      lineWidth: 2,
    });

    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current && chartApiRef.current) {
        const cw = chartContainerRef.current.clientWidth;
        if (cw > 0) chartApiRef.current.applyOptions({ width: cw, height: 220 });
      }
    });
    ro.observe(chartContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartApiRef.current = null;
      seriesRef.current = null;
    };
  }, [overview.symbol, overview.prev_close_ref, overview.sparkline]);

  useEffect(() => {
    const activeData = dedupeAscByTime(rangeSeries ?? overview.sparkline ?? []);
    if (!seriesRef.current || activeData.length === 0) return;
    const basePx = overview.prev_close_ref && !rangeSeries ? overview.prev_close_ref : activeData[0].value;
    seriesRef.current.applyOptions({ baseValue: { type: "price", price: basePx } });
    seriesRef.current.setData(activeData.map((p) => ({ time: p.time as Time, value: p.value })));
    chartApiRef.current?.timeScale().fitContent();
  }, [rangeSeries, overview.sparkline, overview.prev_close_ref]);

  const handleSelectRange = (k: string) => {
    setSelectedRange(k);
    const params = RANGE_TO_API[k] || { interval: "1d", period: "1mo" };
    fetch(
      apiUrl(`/api/history/${encodeURIComponent(overview.symbol)}?interval=${params.interval}&period=${params.period}`)
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((bars) => {
        if (Array.isArray(bars) && bars.length > 0) {
          setRangeSeries(bars.map((b: { time: string | number; close: number }) => ({ time: b.time, value: b.close })));
        }
      })
      .catch(() => {});
  };

  const price = overview.price ?? overview.sparkline?.[overview.sparkline.length - 1]?.value ?? 0;
  const chg = overview.change ?? 0;
  const pct = overview.change_percent ?? 0;
  const isBull = chg >= 0;
  const currSym = getCurrencySymbol(overview.currency);

  const subTabs = ["Overview", "Financials", "Filings", "News", "Technicals", "Options", "ETFs", "Bonds"];
  const returnKeys = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "10Y", "ALL"];
  const initials = (overview.symbol || "AG").replace(/[^A-Z0-9]/gi, "").slice(0, 2).toUpperCase();

  return (
    <div className="bg-[#FFFFFF] space-y-6">
      {/* TradingView Breadcrumbs + Back to Supercharts CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#787B86]">
        <div className="flex items-center gap-1.5">
          <span>Markets</span>
          <span>/</span>
          <span>{overview.region}</span>
          <span>/</span>
          <span>{overview.exchange}</span>
          <span>/</span>
          <strong className="text-[#131722]">{overview.symbol}</strong>
        </div>

        <button
          type="button"
          onClick={onBackToSuperchart}
          className="px-4 py-2 rounded-full bg-[#131722] hover:bg-[#2962FF] text-white text-xs font-bold inline-flex items-center gap-1.5 transition"
        >
          <Maximize2 className="w-3.5 h-3.5" /> See on Supercharts
        </button>
      </div>

      {/* TradingView Hero Identity + Dual-Size Price */}
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[#131722] text-white font-black text-xl flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-black text-[#131722] tracking-tight">{overview.name}</h1>
              <span className="text-xs px-2.5 py-1 rounded-full bg-[#F0F3FA] text-[#131722] font-mono font-bold">
                {overview.symbol} · {overview.exchange}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-[#787B86]">
              <span>{overview.sector || "Global Equities"}</span>
              {overview.website && (
                <>
                  <span>•</span>
                  <a
                    href={overview.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#2962FF] hover:underline inline-flex items-center gap-1"
                  >
                    {overview.website.replace(/^https?:\/\//, "")} <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="text-left sm:text-right">
          <div className="flex items-baseline sm:justify-end gap-2">
            <span className="text-3xl sm:text-4xl font-black text-[#131722] font-mono tabular-nums">
              {formatAssetPrice(price, overview.currency)}
            </span>
            <span className="text-xs font-semibold text-[#787B86]">{overview.currency}</span>
          </div>
          <div className="flex items-center sm:justify-end gap-2 mt-1">
            <span
              className={`text-sm font-bold font-mono tabular-nums ${
                isBull ? "text-[#089981]" : "text-[#F23645]"
              }`}
            >
              {isBull ? "+" : "-"}{currSym}{formatNumber(Math.abs(chg), 2)} ({isBull ? "+" : ""}{pct.toFixed(2)}%)
            </span>
            {overview.as_of && <span className="text-[11px] text-[#787B86] font-mono">• {overview.as_of}</span>}
          </div>
        </div>
      </div>

      {/* TradingView Signature Underline Tabs */}
      <div className="flex items-center gap-6 border-b border-[#E0E3EB] overflow-x-auto scrollbar-none">
        {subTabs.map((tab) => {
          const isAct = activeSubTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onSelectSubTab(tab)}
              className={`pb-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
                isAct
                  ? "border-[#131722] text-[#131722]"
                  : "border-transparent text-[#787B86] hover:text-[#131722]"
              }`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* TradingView Interactive Overview Chart + 10 Performance Pills */}
      <div className="border border-[#E0E3EB] rounded-2xl p-4 bg-[#FFFFFF] space-y-4">
        <div className="flex items-center justify-between text-xs text-[#787B86]">
          <span className="font-semibold text-[#131722]">Price Chart ({selectedRange})</span>
          <button
            type="button"
            onClick={onBackToSuperchart}
            className="text-xs font-semibold text-[#2962FF] hover:underline flex items-center gap-1"
          >
            Full Superchart <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        <div ref={chartContainerRef} className="w-full h-[220px]" />

        {/* 10 Horizontal Performance Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-5 xl:grid-cols-10 gap-2 pt-2 border-t border-[#F0F3FA]">
          {returnKeys.map((k) => {
            const val = overview.returns?.[k];
            const pos = val !== null && val !== undefined && val >= 0;
            const isSel = selectedRange === k;
            const fmtPct =
              val === null || val === undefined
                ? "—"
                : `${pos ? "+" : ""}${Math.abs(val) >= 1000 ? formatNumber(val, 0, 0) : val.toFixed(2)}%`;

            return (
              <button
                key={k}
                type="button"
                onClick={() => handleSelectRange(k)}
                className={`rounded-xl px-2.5 py-2 text-left transition overflow-hidden ${
                  isSel ? "bg-[#F0F3FA] ring-1 ring-[#D1D4DC]" : "bg-[#F8F9FD] hover:bg-[#F0F3FA]"
                }`}
              >
                <span className="text-[11px] font-medium text-[#787B86] block truncate">{RETURN_LABELS[k] || k}</span>
                <span
                  className={`text-xs font-mono font-bold mt-0.5 block truncate tabular-nums ${
                    val === null || val === undefined
                      ? "text-[#787B86]"
                      : pos
                      ? "text-[#089981]"
                      : "text-[#F23645]"
                  }`}
                >
                  {fmtPct}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
