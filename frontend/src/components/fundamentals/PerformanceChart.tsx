"use client";

import React, { useState } from "react";
import { formatCompactCurrency } from "@/lib/format";

export interface PerformancePoint {
  period: string;
  revenue: number;
  net_income: number;
  net_margin_pct: number;
}

export default function PerformanceChart({
  data,
  currency,
}: {
  data: PerformancePoint[];
  currency: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 text-xs text-[#787B86] flex items-center justify-center h-72">
        Income Statement performance data not available for this instrument.
      </div>
    );
  }

  const w = 520;
  const h = 240;
  const padL = 48;
  const padR = 44;
  const padT = 20;
  const padB = 34;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxVal = Math.max(...data.flatMap((d) => [d.revenue, d.net_income, 1]));
  const maxMargin = Math.max(...data.map((d) => d.net_margin_pct), 10);
  const minMargin = Math.min(...data.map((d) => d.net_margin_pct), 0);
  const marginSpan = Math.max(maxMargin - minMargin, 1);

  const groupW = plotW / data.length;
  const barW = Math.min(20, groupW * 0.28);

  const linePts = data.map((d, i) => {
    const cx = padL + i * groupW + groupW / 2;
    const cy = padT + plotH - ((d.net_margin_pct - minMargin) / marginSpan) * plotH;
    return { cx, cy, val: d.net_margin_pct };
  });

  const pathD = linePts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.cx} ${p.cy}`).join(" ");
  const active = hoverIdx !== null ? data[hoverIdx] : data[data.length - 1];

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-[#131722]">Performance (Revenue vs Net Income & Margin %)</h4>
          <p className="text-[11px] text-[#787B86]">Dual-axis fiscal comparison</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-semibold">
          <span className="flex items-center gap-1 text-[#131722]"><span className="w-2.5 h-2.5 rounded-sm bg-[#2962FF]" /> Revenue</span>
          <span className="flex items-center gap-1 text-[#131722]"><span className="w-2.5 h-2.5 rounded-sm bg-[#089981]" /> Net Income</span>
          <span className="flex items-center gap-1 text-[#131722]"><span className="w-3 h-0.5 bg-[#F59E0B]" /> Net Margin %</span>
        </div>
      </div>

      {/* Live Hover Callout */}
      <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-1.5 flex flex-wrap items-center justify-between text-xs font-mono">
        <span className="font-bold text-[#131722]">{active.period}</span>
        <span>Rev: <strong className="text-[#2962FF]">{formatCompactCurrency(active.revenue, currency)}</strong></span>
        <span>Net Inc: <strong className="text-[#089981]">{formatCompactCurrency(active.net_income, currency)}</strong></span>
        <span>Margin: <strong className="text-amber-600">{active.net_margin_pct.toFixed(2)}%</strong></span>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-56 overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + plotH * (1 - t);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#F0F3FA" strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#787B86">
                {formatCompactCurrency(maxVal * t, currency)}
              </text>
              <text x={w - padR + 6} y={y + 3} textAnchor="start" fontSize={9} fill="#787B86">
                {(minMargin + marginSpan * t).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const cx = padL + i * groupW + groupW / 2;
          const revH = Math.max(2, (Math.max(0, d.revenue) / maxVal) * plotH);
          const niH = Math.max(2, (Math.max(0, d.net_income) / maxVal) * plotH);
          return (
            <g key={d.period} onMouseEnter={() => setHoverIdx(i)} className="cursor-pointer">
              <rect x={cx - barW - 2} y={padT + plotH - revH} width={barW} height={revH} rx={3} fill="#2962FF" />
              <rect x={cx + 2} y={padT + plotH - niH} width={barW} height={niH} rx={3} fill="#089981" />
              <text x={cx} y={h - 10} textAnchor="middle" fontSize={10} fill="#787B86">
                {d.period}
              </text>
            </g>
          );
        })}

        <path d={pathD} fill="none" stroke="#F59E0B" strokeWidth={2.5} />
        {linePts.map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={3.5} fill="#FFFFFF" stroke="#F59E0B" strokeWidth={2} />
        ))}
      </svg>
    </div>
  );
}
