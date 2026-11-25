"use client";

import React from "react";
import { TrendingUp, Landmark, Calendar } from "lucide-react";

export interface MacroData {
  inflation: Array<{
    country: string;
    metric: string;
    rate: string;
    target: string;
    as_of?: string;
    status: string;
  }>;
  interest_rates: Array<{
    central_bank: string;
    rate: string;
    as_of?: string;
    country: string;
  }>;
  economic_calendar?: Array<{
    date: string;
    time_gmt: string;
    country: string;
    event: string;
    actual: string;
    consensus: string;
    previous: string;
  }>;
}

export default function MacroInflation({ macro }: { macro: MacroData | null }) {
  if (!macro) {
    return (
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-8 text-center text-xs text-[#787B86] shadow-sm">
        Loading real-time FRED inflation & global economic calendar...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Live Global Inflation */}
        <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-[#E0E3EB]">
            <div className="p-2 bg-[#FFEBEE] rounded-xl text-[#F23645]">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#131722]">Live CPI Inflation Monitor (FRED)</h3>
              <p className="text-xs text-[#787B86]">Latest Official Consumer Price Index YoY</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {macro.inflation.map((inf) => (
              <div key={inf.country} className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3.5 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-semibold text-[#787B86] block">{inf.country}</span>
                  <span className="text-2xl font-black text-[#131722] font-mono mt-1 block">{inf.rate}</span>
                </div>
                <div className="mt-2.5 pt-2 border-t border-[#E0E3EB] flex items-center justify-between text-[11px]">
                  <span className="text-[#787B86] font-mono">As of {inf.as_of || "Latest"}</span>
                  <span className="font-bold px-2 py-0.5 rounded text-[#089981] bg-[#E8F5E9]">Target {inf.target}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Policy Rates */}
        <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-[#E0E3EB]">
            <div className="p-2 bg-[#2962FF]/10 rounded-xl text-[#2962FF]">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#131722]">Live Policy Rates & Treasury Yields</h3>
              <p className="text-xs text-[#787B86]">Federal Reserve Official Data Feed</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {macro.interest_rates.map((rate) => (
              <div key={rate.central_bank} className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3.5 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-[#131722] block">{rate.central_bank}</span>
                  <span className="text-[11px] text-[#787B86] font-mono">Updated: {rate.as_of || "Latest"}</span>
                </div>
                <span className="text-base font-black text-[#2962FF] font-mono bg-[#2962FF]/10 px-2.5 py-1 rounded-lg">
                  {rate.rate}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live Economic Calendar */}
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#E0E3EB]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#E8F5E9] rounded-xl text-[#089981]">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#131722]">Live Global Economic Calendar</h3>
              <p className="text-xs text-[#787B86]">Real-time macro releases across global economies</p>
            </div>
          </div>
          <span className="text-[11px] font-mono text-[#089981] bg-[#E8F5E9] px-2.5 py-1 rounded-full font-bold">
            {macro.economic_calendar?.length || 0} Live Events
          </span>
        </div>

        <div className="overflow-x-auto max-h-[380px]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#F8F9FD]">
              <tr className="border-b border-[#E0E3EB] text-[#787B86] uppercase tracking-wider font-mono">
                <th className="py-2.5 px-3">Date / GMT</th>
                <th className="py-2.5 px-3">Country</th>
                <th className="py-2.5 px-3">Economic Event</th>
                <th className="py-2.5 px-3 text-right">Actual</th>
                <th className="py-2.5 px-3 text-right">Consensus</th>
                <th className="py-2.5 px-3 text-right">Previous</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E0E3EB]">
              {(macro.economic_calendar || []).map((ev, idx) => (
                <tr key={`${ev.date}-${ev.event}-${idx}`} className="hover:bg-[#F8F9FD] transition">
                  <td className="py-2.5 px-3 font-mono text-[#787B86] whitespace-nowrap">
                    {ev.date} <span className="text-[#9598A1]">{ev.time_gmt}</span>
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-[#131722]">{ev.country}</td>
                  <td className="py-2.5 px-3 font-bold text-[#131722]">{ev.event}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-[#089981]">{ev.actual}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-[#131722]">{ev.consensus}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-[#787B86]">{ev.previous}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
