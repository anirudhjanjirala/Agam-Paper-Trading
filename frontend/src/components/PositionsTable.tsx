"use client";

import React, { useState } from "react";
import { Briefcase, ArrowUpRight, ArrowDownRight, XCircle, Clock, History } from "lucide-react";
import { formatAssetPrice, getCurrencySymbol, formatNumber } from "@/lib/format";

export interface Position {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_price: number;
  current_price: number;
  currency: string;
  order_type: string;
  pnl: number;
  pnl_percent: number;
}

export interface PendingOrder {
  id: string;
  symbol: string;
  name: string;
  currency: string;
  quantity: number;
  order_type: string;
  limit_price: number;
  created_at: string;
}

export interface OrderHistoryItem {
  id: string;
  symbol: string;
  type: string;
  quantity: number;
  price: number;
  currency: string;
  charges: number;
  status: string;
  timestamp: string;
}

interface PositionsTableProps {
  positions: Position[];
  pendingOrders?: PendingOrder[];
  ordersHistory?: OrderHistoryItem[];
  onClosePosition: (symbol: string, quantity: number, orderType: string) => void;
  onCancelPending?: (orderId: string) => void;
}

export default function PositionsTable({
  positions,
  pendingOrders = [],
  ordersHistory = [],
  onClosePosition,
  onCancelPending,
}: PositionsTableProps) {
  const [tab, setTab] = useState<"positions" | "pending" | "history">("positions");

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-[#E0E3EB]">
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-[#2962FF]" />
          <h3 className="text-base font-bold text-[#131722]">Portfolio, Pending Orders & History</h3>
        </div>

        <div className="flex items-center gap-1.5 bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => setTab("positions")}
            className={`px-3 py-1 rounded-lg transition ${
              tab === "positions" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
            }`}
          >
            Positions ({positions.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("pending")}
            className={`px-3 py-1 rounded-lg transition flex items-center gap-1 ${
              tab === "pending" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
            }`}
          >
            <Clock className="w-3 h-3" /> Pending ({pendingOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("history")}
            className={`px-3 py-1 rounded-lg transition flex items-center gap-1 ${
              tab === "history" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
            }`}
          >
            <History className="w-3 h-3" /> History ({ordersHistory.length})
          </button>
        </div>
      </div>

      {tab === "positions" && (
        <>
          {!positions || positions.length === 0 ? (
            <div className="py-6 text-center">
              <Briefcase className="w-7 h-7 text-[#787B86] mx-auto mb-2" />
              <p className="text-sm font-bold text-[#131722]">No Open Positions</p>
              <p className="text-xs text-[#787B86] mt-1">
                Select any stock, ETF, future, or bond and execute a paper trade to monitor live P&L here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#F8F9FD] border-b border-[#E0E3EB] text-[#787B86] uppercase tracking-wider font-mono">
                    <th className="py-2.5 px-3">Asset</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Avg Price</th>
                    <th className="py-2.5 px-3 text-right">LTP</th>
                    <th className="py-2.5 px-3 text-right">Unrealized P&L</th>
                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E0E3EB]">
                  {positions.map((pos) => {
                    const isProfit = pos.pnl >= 0;
                    const currSymbol = getCurrencySymbol(pos.currency);
                    const isShort = pos.order_type === "SHORT";

                    return (
                      <tr key={pos.id} className="hover:bg-[#F8F9FD] transition">
                        <td className="py-3 px-3">
                          <span className="font-bold text-[#131722] block">{pos.name}</span>
                          <span className="text-[11px] text-[#787B86] font-mono">{pos.symbol}</span>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              !isShort ? "bg-[#E8F5E9] text-[#089981]" : "bg-[#FFEBEE] text-[#F23645]"
                            }`}
                          >
                            {pos.order_type}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-[#131722]">{pos.quantity}</td>
                        <td className="py-3 px-3 text-right font-mono text-[#787B86]">
                          {formatAssetPrice(pos.avg_price, pos.currency)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-[#131722]">
                          {formatAssetPrice(pos.current_price, pos.currency)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold">
                          <span className={`inline-flex items-center gap-0.5 ${isProfit ? "text-[#089981]" : "text-[#F23645]"}`}>
                            {isProfit ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                            {isProfit ? "+" : "-"}{currSymbol}{formatNumber(Math.abs(pos.pnl), 2)} ({isProfit ? "+" : ""}
                            {(pos.pnl_percent ?? 0).toFixed(2)}%)
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => onClosePosition(pos.symbol, pos.quantity, pos.order_type)}
                            aria-label={`${isShort ? "Cover" : "Close"} ${pos.symbol}`}
                            className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-[#FFEBEE] hover:bg-[#F23645] text-[#F23645] hover:text-white transition flex items-center gap-1 mx-auto"
                          >
                            <XCircle className="w-3.5 h-3.5" /> {isShort ? "Cover" : "Close"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "pending" && (
        <div className="overflow-x-auto">
          {pendingOrders.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#787B86]">No pending Limit orders queued.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#F8F9FD] border-b border-[#E0E3EB] text-[#787B86] uppercase font-mono">
                  <th className="py-2 px-3">Asset</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3 text-right">Qty</th>
                  <th className="py-2 px-3 text-right">Limit Price</th>
                  <th className="py-2 px-3 text-right">Queued</th>
                  <th className="py-2 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E0E3EB]">
                {pendingOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-[#F8F9FD]">
                    <td className="py-2.5 px-3 font-mono font-bold text-[#131722]">{ord.symbol}</td>
                    <td className="py-2.5 px-3 font-bold text-[#2962FF]">{ord.order_type}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{ord.quantity}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold">{formatAssetPrice(ord.limit_price, ord.currency)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-[#787B86]">{ord.created_at}</td>
                    <td className="py-2.5 px-3 text-center">
                      {onCancelPending && (
                        <button
                          type="button"
                          onClick={() => onCancelPending(ord.id)}
                          className="px-2.5 py-1 rounded bg-[#FFEBEE] hover:bg-[#F23645] text-[#F23645] hover:text-white text-[11px] font-bold transition"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="overflow-x-auto max-h-64">
          {ordersHistory.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#787B86]">No executed paper orders recorded yet.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#F8F9FD] border-b border-[#E0E3EB] text-[#787B86] uppercase font-mono">
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3 text-right">Qty</th>
                  <th className="py-2 px-3 text-right">Fill Price</th>
                  <th className="py-2 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E0E3EB]">
                {ordersHistory.map((h) => (
                  <tr key={h.id} className="hover:bg-[#F8F9FD]">
                    <td className="py-2 px-3 font-mono text-[#787B86]">{h.timestamp}</td>
                    <td className="py-2 px-3 font-mono font-bold text-[#131722]">{h.symbol}</td>
                    <td className={`py-2 px-3 font-bold ${h.type === "BUY" ? "text-[#089981]" : "text-[#F23645]"}`}>{h.type}</td>
                    <td className="py-2 px-3 text-right font-mono">{h.quantity}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatAssetPrice(h.price, h.currency)}</td>
                    <td className="py-2 px-3 text-right font-mono text-[#089981]">{h.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
