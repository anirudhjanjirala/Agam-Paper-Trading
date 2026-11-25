"use client";

import React, { useState } from "react";
import { formatCompactCurrency } from "@/lib/format";

export interface WaterfallStep {
  step: string;
  value: number;
  start: number;
  end: number;
  kind: "total" | "subtotal" | "negative" | "positive" | "final";
}

export default function WaterfallChart({
  data,
  currency,
}: {
  data: WaterfallStep[];
  currency: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 text-xs text-[#787B86] flex items-center justify-center h-72">
        Revenue-to-Profit waterfall breakdown unavailable for this instrument.
      </div>
    );
  }

  const w = 520;
  const h = 240;
  const padL = 48;
  const padR = 16;
  const padT = 20;
  const padB = 42;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxV = Math.max(...data.flatMap((d) => [d.start, d.end, 1]));
  const minV = Math.min(...data.flatMap((d) => [d.start, d.end, 0]));
  const span = Math.max(maxV - minV, 1);

  const yPos = (v: number) => padT + plotH - ((v - minV) / span) * plotH;
  const colW = plotW / data.length;
  const barW = Math.min(36, colW * 0.6);

  const active = hoverIdx !== null ? data[hoverIdx] : data[data.length - 1];

  const getColor = (kind: WaterfallStep["kind"]) => {
    if (kind === "total" || kind === "subtotal") return "#2962FF";
    if (kind === "final" || kind === "positive") return "#089981";
    return "#F23645";
  };

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-[#131722]">Revenue to Profit Conversion (Waterfall Bridge)</h4>
          <p className="text-[11px] text-[#787B86]">Latest fiscal margin cascade</p>
        </div>
        <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded bg-[#F8F9FD] border border-[#E0E3EB] text-[#131722]">
          {active.step}: {formatCompactCurrency(active.value, currency)}
        </span>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-56 overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const val = minV + span * t;
          const y = yPos(val);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#F0F3FA" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#787B86">
                {formatCompactCurrency(val, currency)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const x = padL + i * colW + (colW - barW) / 2;
          const y1 = yPos(d.end);
          const y2 = yPos(d.start);
          const top = Math.min(y1, y2);
          const bh = Math.max(3, Math.abs(y2 - y1));
          const next = data[i + 1];
          const connectorY = d.kind === "negative" ? yPos(d.start) : yPos(d.end);
          return (
            <g key={d.step} onMouseEnter={() => setHoverIdx(i)} className="cursor-pointer">
              <rect x={x} y={top} width={barW} height={bh} rx={3} fill={getColor(d.kind)} />
              {next && (
                <line
                  x1={x + barW}
                  y1={connectorY}
                  x2={padL + (i + 1) * colW + (colW - barW) / 2}
                  y2={connectorY}
                  stroke="#D1D4DC"
                  strokeDasharray="3 3"
                />
              )}
              <text x={x + barW / 2} y={h - 14} textAnchor="middle" fontSize={9} fill="#787B86">
                {d.step.split(" ")[0]}
              </text>
              <text x={x + barW / 2} y={h - 4} textAnchor="middle" fontSize={8} fill="#787B86">
                {d.step.split(" ").slice(1).join(" ")}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
