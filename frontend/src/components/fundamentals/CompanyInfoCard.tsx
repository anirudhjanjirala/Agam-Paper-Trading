"use client";

import React, { useState } from "react";
import { Building2, Globe, Users, Hash, ChevronDown, ChevronUp } from "lucide-react";
import { OverviewData } from "./CompanyHeader";
import { formatAssetPrice, formatCompactCurrency, formatNumber } from "@/lib/format";

export default function CompanyInfoCard({ overview }: { overview: OverviewData }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between border-b border-[#E0E3EB] pb-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-[#2962FF]" />
          <h3 className="text-base font-bold text-[#131722]">Company Profile & Valuation Key Stats</h3>
        </div>
        <span className="text-xs font-semibold text-[#787B86]">
          {overview.sector || "Sector"} • {overview.industry || "Industry"}
        </span>
      </div>

      {/* Key Valuation Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Market Cap", value: formatCompactCurrency(overview.market_cap, overview.currency) },
          { label: "Trailing P/E", value: overview.trailing_pe ? `${overview.trailing_pe.toFixed(2)}x` : "—" },
          { label: "Forward P/E", value: overview.forward_pe ? `${overview.forward_pe.toFixed(2)}x` : "—" },
          { label: "Div Yield", value: overview.dividend_yield ? `${overview.dividend_yield.toFixed(2)}%` : "—" },
          { label: "Beta (5Y)", value: overview.beta ? overview.beta.toFixed(2) : "—" },
          { label: "52W High / Low", value: overview.week_52_high ? `${formatAssetPrice(overview.week_52_high, overview.currency)} / ${formatAssetPrice(overview.week_52_low, overview.currency)}` : "—" },
        ].map((m) => (
          <div key={m.label} className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
            <span className="text-[11px] font-semibold text-[#787B86] block">{m.label}</span>
            <span className="text-sm font-extrabold text-[#131722] font-mono mt-1 block">{m.value}</span>
          </div>
        ))}
      </div>

      {/* Executives & Identifiers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs pt-2">
        <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
          <span className="text-[#787B86] block mb-0.5">Key Executive</span>
          <span className="font-bold text-[#131722]">{overview.ceo || "Not Reported"}</span>
          {overview.ceo_title && <span className="text-[11px] text-[#787B86] block">{overview.ceo_title}</span>}
        </div>
        <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
          <span className="text-[#787B86] flex items-center gap-1 mb-0.5"><Globe className="w-3 h-3" /> Headquarters</span>
          <span className="font-bold text-[#131722]">{overview.headquarters || overview.region}</span>
        </div>
        <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
          <span className="text-[#787B86] flex items-center gap-1 mb-0.5"><Users className="w-3 h-3" /> Employees & IPO Date</span>
          <span className="font-bold text-[#131722]">
            {overview.employees ? formatNumber(overview.employees, 0, 0) : "—"} • {overview.ipo_date || "—"}
          </span>
        </div>
        <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
          <span className="text-[#787B86] flex items-center gap-1 mb-0.5"><Hash className="w-3 h-3" /> Identifiers (ISIN / Ticker)</span>
          <span className="font-mono font-bold text-[#131722]">
            {overview.isin || overview.symbol}
          </span>
        </div>
      </div>

      {/* Expandable Corporate Summary */}
      {overview.summary && (
        <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-4">
          <p className={`text-xs text-[#131722] leading-relaxed ${expanded ? "" : "line-clamp-3"}`}>
            {overview.summary}
          </p>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="mt-2 text-xs font-bold text-[#2962FF] inline-flex items-center gap-1"
          >
            {expanded ? (
              <>Show Less <ChevronUp className="w-3.5 h-3.5" /></>
            ) : (
              <>Read Full Business Profile <ChevronDown className="w-3.5 h-3.5" /></>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
