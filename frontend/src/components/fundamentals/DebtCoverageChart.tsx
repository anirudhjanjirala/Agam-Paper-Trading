"use client";

import React, { useState } from "react";
import { formatCompactCurrency } from "@/lib/format";

export interface DebtCoveragePoint {
  period: string;
  total_debt: number;
  free_cash_flow: number;
  cash: number;
}

export default function DebtCoverageChart({
  data,
  currency,
}: {
  data: DebtCoveragePoint[];
  currency: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 text-xs text-[#787B86] flex items-center justify-center h-72">
        Balance sheet & FCF data unavailable for this instrument.
      </div>
    );
  }

  const w = 520;
  const h = 240;
  const padL = 48;
  const padR = 16;
  const padT = 20;
  const padB = 34;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxV = Math.max(...data.flatMap((d) => [d.total_debt, d.free_cash_flow, d.cash, 1]));
  const groupW = plotW / data.length;
  const barW = Math.min(16, groupW * 0.22);
  const active = hoverIdx !== null ? data[hoverIdx] : data[data.length - 1];

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-[#131722]">Debt Level & Coverage (Debt vs FCF vs Cash)</h4>
          <p className="text-[11px] text-[#787B86]">Liquidity & solvency balance sheet health</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-semibold">
          <span className="flex items-center gap-1 text-[#131722]"><span className="w-2.5 h-2.5 rounded-sm bg-[#F23645]" /> Debt</span>
          <span className="flex items-center gap-1 text-[#131722]"><span className="w-2.5 h-2.5 rounded-sm bg-[#089981]" /> FCF</span>
          <span className="flex items-center gap-1 text-[#131722]"><span className="w-2.5 h-2.5 rounded-sm bg-[#2962FF]" /> Cash</span>
        </div>
      </div>

      <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-1.5 flex flex-wrap items-center justify-between text-xs font-mono">
        <span className="font-bold text-[#131722]">{active.period}</span>
        <span>Debt: <strong className="text-[#F23645]">{formatCompactCurrency(active.total_debt, currency)}</strong></span>
        <span>FCF: <strong className="text-[#089981]">{formatCompactCurrency(active.free_cash_flow, currency)}</strong></span>
        <span>Cash: <strong className="text-[#2962FF]">{formatCompactCurrency(active.cash, currency)}</strong></span>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-56 overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + plotH * (1 - t);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#F0F3FA" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#787B86">
                {formatCompactCurrency(maxV * t, currency)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const cx = padL + i * groupW + groupW / 2;
          const hDebt = Math.max(2, (Math.max(0, d.total_debt) / maxV) * plotH);
          const hFcf = Math.max(2, (Math.max(0, d.free_cash_flow) / maxV) * plotH);
          const hCash = Math.max(2, (Math.max(0, d.cash) / maxV) * plotH);
          return (
            <g key={d.period} onMouseEnter={() => setHoverIdx(i)} className="cursor-pointer">
              <rect x={cx - barW * 1.6} y={padT + plotH - hDebt} width={barW} height={hDebt} rx={2} fill="#F23645" />
              <rect x={cx - barW * 0.5} y={padT + plotH - hFcf} width={barW} height={hFcf} rx={2} fill="#089981" />
              <rect x={cx + barW * 0.6} y={padT + plotH - hCash} width={barW} height={hCash} rx={2} fill="#2962FF" />
              <text x={cx} y={h - 10} textAnchor="middle" fontSize={10} fill="#787B86">
                {d.period}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
