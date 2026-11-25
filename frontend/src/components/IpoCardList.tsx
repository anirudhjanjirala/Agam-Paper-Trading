"use client";

import React, { useState } from "react";
import { Rocket, Sparkles, CheckCircle2 } from "lucide-react";

export interface IpoItem {
  id: string;
  company: string;
  symbol: string;
  country: string;
  price_band: string;
  issue_size: string;
  open_date: string;
  close_date: string;
  listing_date: string;
  status: string;
  segment?: string;
  subscription: string;
}

interface IpoCardListProps {
  ipos: IpoItem[];
  onApplyBid: (ipo: IpoItem) => void;
}

export default function IpoCardList({ ipos, onApplyBid }: IpoCardListProps) {
  const [appliedIpos, setAppliedIpos] = useState<Record<string, boolean>>({});

  const handleApply = (ipo: IpoItem) => {
    setAppliedIpos((prev) => ({ ...prev, [ipo.id]: true }));
    onApplyBid(ipo);
  };

  const getCountryFlag = (c: string) => {
    if (c === "IN" || c === "IND") return "🇮🇳 India (NSE)";
    if (c === "US" || c === "USA") return "🇺🇸 USA (NASDAQ)";
    if (c === "CANADA") return "🇨🇦 Canada (TSX)";
    if (c === "CHINA") return "🇨🇳 China (SSE/SZSE)";
    if (c === "EU") return "🇪🇺 Europe";
    return "🌍 Global";
  };

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#E0E3EB]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#2962FF]/10 rounded-xl text-[#2962FF]">
            <Rocket className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#131722] flex items-center gap-2">
              Live & Upcoming IPOs
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E8F5E9] text-[#089981] font-bold">
                EXCHANGE FEED
              </span>
            </h3>
            <p className="text-xs text-[#787B86]">Real-time feed from NSE India & NASDAQ IPO Calendars</p>
          </div>
        </div>
      </div>

      {ipos.length === 0 ? (
        <div className="py-8 text-center text-xs text-[#787B86]">Loading live IPO filings from NSE & NASDAQ...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ipos.map((ipo) => {
            const isApplied = appliedIpos[ipo.id];
            const isActive =
              ipo.status.toLowerCase().includes("active") ||
              ipo.status.toLowerCase().includes("open") ||
              ipo.status.toLowerCase().includes("forthcoming");

            return (
              <div
                key={ipo.id}
                className="bg-[#F8F9FD] border border-[#E0E3EB] hover:border-[#2962FF]/40 rounded-xl p-4 flex flex-col justify-between transition"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-[#787B86]">{getCountryFlag(ipo.country)}</span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        isActive ? "bg-[#E8F5E9] text-[#089981]" : "bg-[#F0F3FA] text-[#787B86]"
                      }`}
                    >
                      {ipo.status}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-[#131722] line-clamp-2">{ipo.company}</h4>
                  <div className="flex items-center gap-2 mt-1 mb-3">
                    <span className="text-xs text-[#787B86] font-mono">{ipo.symbol}</span>
                    {ipo.segment && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FFFFFF] border border-[#E0E3EB] text-[#787B86]">
                        {ipo.segment}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between text-[#787B86]">
                      <span>Price / Band:</span>
                      <span className="font-bold text-[#131722] font-mono">{ipo.price_band}</span>
                    </div>
                    <div className="flex justify-between text-[#787B86]">
                      <span>Issue Size:</span>
                      <span className="font-semibold text-[#131722]">{ipo.issue_size}</span>
                    </div>
                    <div className="flex justify-between text-[#787B86]">
                      <span>Open / Filed:</span>
                      <span className="font-semibold text-[#131722] font-mono">{ipo.open_date}</span>
                    </div>
                    <div className="flex justify-between text-[#787B86]">
                      <span>Close / Priced:</span>
                      <span className="font-semibold text-[#131722] font-mono">{ipo.close_date}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#E0E3EB] flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#2962FF] font-mono">{ipo.subscription}</span>
                  {isApplied ? (
                    <span className="flex items-center gap-1 text-xs text-[#089981] font-bold bg-[#E8F5E9] px-3 py-1.5 rounded-lg">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Bid Applied
                    </span>
                  ) : (
                    <button
                      onClick={() => handleApply(ipo)}
                      className="flex items-center gap-1 text-xs font-bold bg-[#2962FF] hover:bg-[#1E53E5] text-white px-3 py-1.5 rounded-lg shadow-sm transition"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Apply Virtual Bid
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
