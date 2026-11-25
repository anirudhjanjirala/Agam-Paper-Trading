"use client";

import React, { useState } from "react";
import { getCurrencySymbol } from "@/lib/format";

export interface EpsPoint {
  date: string;
  estimate: number | null;
  actual: number | null;
  surprise_pct: number | null;
  is_upcoming: boolean;
}

export default function EpsChart({
  data,
  currency,
}: {
  data: EpsPoint[];
  currency: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 text-xs text-[#787B86] flex items-center justify-center h-72">
        EPS Consensus & Surprise history unavailable for this instrument.
      </div>
    );
  }

  const w = 520;
  const h = 240;
  const padL = 44;
  const padR = 16;
  const padT = 20;
  const padB = 34;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const vals = data.flatMap((d) => [d.estimate, d.actual]).filter((v): v is number => v !== null);
  const maxV = Math.max(...vals, 1) * 1.1;
  const minV = Math.min(...vals, 0) * 0.9;
  const span = Math.max(maxV - minV, 0.5);

  const yPos = (v: number) => padT + plotH - ((v - minV) / span) * plotH;
  const colW = plotW / data.length;
  const curr = getCurrencySymbol(currency);

  const upcoming = data.find((d) => d.is_upcoming);
  const active = hoverIdx !== null ? data[hoverIdx] : data[data.length - 1];

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-[#131722]">Earnings Per Share (EPS Actual vs Estimate)</h4>
          <p className="text-[11px] text-[#787B86]">
            {upcoming ? `Next Release: ${upcoming.date} (Est: ${curr}${upcoming.estimate?.toFixed(2) ?? "--"})` : "Quarterly EPS track record"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-semibold">
          <span className="flex items-center gap-1 text-[#131722]"><span className="w-2.5 h-2.5 rounded-full bg-[#089981]" /> Beat</span>
          <span className="flex items-center gap-1 text-[#131722]"><span className="w-2.5 h-2.5 rounded-full bg-[#F23645]" /> Miss</span>
          <span className="flex items-center gap-1 text-[#131722]"><span className="w-2.5 h-2.5 rounded-full border-2 border-[#2962FF]" /> Estimate</span>
        </div>
      </div>

      <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-1.5 flex flex-wrap items-center justify-between text-xs font-mono">
        <span className="font-bold text-[#131722]">{active.date}</span>
        <span>Est: <strong className="text-[#2962FF]">{active.estimate !== null ? `${curr}${active.estimate.toFixed(2)}` : "--"}</strong></span>
        <span>Actual: <strong className="text-[#131722]">{active.actual !== null ? `${curr}${active.actual.toFixed(2)}` : "Upcoming"}</strong></span>
        {active.surprise_pct !== null && (
          <span className={active.surprise_pct >= 0 ? "text-[#089981] font-bold" : "text-[#F23645] font-bold"}>
            Surprise: {active.surprise_pct >= 0 ? "+" : ""}{active.surprise_pct.toFixed(2)}%
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-56 overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const v = minV + span * t;
          const y = yPos(v);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#F0F3FA" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#787B86">
                {curr}{v.toFixed(2)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const cx = padL + i * colW + colW / 2;
          const beat = d.actual !== null && d.estimate !== null ? d.actual >= d.estimate : true;
          return (
            <g key={d.date} onMouseEnter={() => setHoverIdx(i)} className="cursor-pointer">
              {d.estimate !== null && (
                <circle cx={cx} cy={yPos(d.estimate)} r={6} fill="#FFFFFF" stroke="#2962FF" strokeWidth={2.5} />
              )}
              {d.actual !== null && (
                <circle cx={cx} cy={yPos(d.actual)} r={6.5} fill={beat ? "#089981" : "#F23645"} fillOpacity={0.88} />
              )}
              <text x={cx} y={h - 10} textAnchor="middle" fontSize={9} fill="#787B86">
                {d.date.slice(2, 7)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
