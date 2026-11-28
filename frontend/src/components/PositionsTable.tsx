"use client";

import React, { useState } from "react";
import { Briefcase, ArrowUpRight, ArrowDownRight, XCircle, Clock, History, AlertTriangle, ArrowLeftRight } from "lucide-react";
import { formatAssetPrice, formatMoney, formatQty, getCurrencySymbol, formatNumber, getPricePrecision } from "@/lib/format";
import { OrderHistoryItem, PendingOrder, Position } from "@/types/trading";
import CountryFlag from "@/components/CountryFlag";

export type { Position, PendingOrder, OrderHistoryItem };

interface PositionsTableProps {
  positions: Position[];
  pendingOrders?: PendingOrder[];
  ordersHistory?: OrderHistoryItem[];
  rejectedOrders?: OrderHistoryItem[];
  onClosePosition: (symbol: string, quantity: number, orderType: string, productType?: string) => void;
  onReversePosition?: (positionId: string) => void;
  onCancelPending?: (orderId: string) => void | Promise<unknown>;
  onSquareOffAll?: () => void;
}

export default function PositionsTable({
  positions,
  pendingOrders = [],
  ordersHistory = [],
  rejectedOrders = [],
  onClosePosition,
  onReversePosition,
  onCancelPending,
  onSquareOffAll,
}: PositionsTableProps) {
  const [tab, setTab] = useState<"positions" | "pending" | "history" | "rejected">("positions");
  const [cancellingIds, setCancellingIds] = useState<Record<string, boolean>>({});

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-[#E0E3EB]">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-[#2962FF]" />
          <h3 className="text-sm font-bold text-[#131722]">Positions, Orders &amp; Contract Ledger</h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {positions.length > 0 && onSquareOffAll && (
            <button
              type="button"
              onClick={onSquareOffAll}
              className="px-2.5 py-1 rounded-lg bg-[#FFEBEE] hover:bg-[#F23645] text-[#F23645] hover:text-white text-[11px] font-bold transition"
            >
              Exit All ({positions.length})
            </button>
          )}

          <div className="flex items-center gap-1 bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-1 text-[11px] font-bold">
            <button
              type="button"
              onClick={() => setTab("positions")}
              className={`px-2.5 py-1 rounded-lg transition ${
                tab === "positions" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
              }`}
            >
              Positions ({positions.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("pending")}
              className={`px-2.5 py-1 rounded-lg transition flex items-center gap-1 ${
                tab === "pending" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
              }`}
            >
              <Clock className="w-3 h-3" /> Pending ({pendingOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("history")}
              className={`px-2.5 py-1 rounded-lg transition flex items-center gap-1 ${
                tab === "history" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
              }`}
            >
              <History className="w-3 h-3" /> Executed ({ordersHistory.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("rejected")}
              className={`px-2.5 py-1 rounded-lg transition flex items-center gap-1 ${
                tab === "rejected" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
              }`}
            >
              <AlertTriangle className="w-3 h-3" /> Rejected ({rejectedOrders.length})
            </button>
          </div>
        </div>
      </div>

      {tab === "positions" && (
        <>
          {!positions || positions.length === 0 ? (
            <div className="py-5 text-center">
              <Briefcase className="w-6 h-6 text-[#787B86] mx-auto mb-1.5" />
              <p className="text-xs font-bold text-[#131722]">No Open Positions</p>
              <p className="text-[11px] text-[#787B86] mt-0.5">
                Place a paper Delivery or Intraday trade with live country taxes &amp; brokerage.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#F8F9FD] border-b border-[#E0E3EB] text-[#787B86] uppercase tracking-wider font-mono text-[10px]">
                    <th className="py-2 px-2">Asset</th>
                    <th className="py-2 px-1.5">Type</th>
                    <th className="py-2 px-1.5 text-right">Qty</th>
                    <th className="py-2 px-1.5 text-right">Avg</th>
                    <th className="py-2 px-1.5 text-right">LTP</th>
                    <th className="py-2 px-1.5 text-right">SL / TP</th>
                    <th className="py-2 px-1.5 text-right">Net P&amp;L</th>
                    <th className="py-2 px-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E0E3EB]">
                  {positions.map((pos) => {
                    const netVal = pos.net_pnl ?? pos.pnl;
                    const isProfit = netVal >= 0;
                    const currSymbol = getCurrencySymbol(pos.currency);
                    const isShort = pos.order_type === "SHORT";
                    const isFrac = pos.country === "CRYPTO" || pos.country === "FOREX";
                    const canTrimHalf = isFrac ? pos.quantity >= 0.00002 : pos.quantity > 1;

                    return (
                      <tr key={pos.id} className="hover:bg-[#F8F9FD] transition">
                        <td className="py-2 px-2">
                          <span className="font-bold text-[#131722] flex items-center gap-1">
                            <CountryFlag code={pos.country || "USA"} />
                            <span className="truncate max-w-[105px]">{pos.name}</span>
                          </span>
                          <span className="text-[10px] text-[#787B86] font-mono">
                            {pos.symbol} · {pos.exchange || pos.country}
                          </span>
                        </td>
                        <td className="py-2 px-1.5">
                          <div className="flex flex-col gap-0.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold w-fit ${
                                !isShort ? "bg-[#E8F5E9] text-[#089981]" : "bg-[#FFEBEE] text-[#F23645]"
                              }`}
                            >
                              {pos.order_type}
                            </span>
                            <span className="text-[9px] font-mono text-[#787B86]">
                              {pos.product_type || "DELIVERY"}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-1.5 text-right font-mono font-bold text-[#131722]">{formatQty(pos.quantity)}</td>
                        <td className="py-2 px-1.5 text-right font-mono text-[#787B86]">
                          {formatAssetPrice(pos.avg_price, pos.currency, pos.symbol)}
                        </td>
                        <td className="py-2 px-1.5 text-right font-mono font-bold text-[#131722]">
                          {formatAssetPrice(pos.current_price, pos.currency, pos.symbol)}
                        </td>
                        <td className="py-2 px-1.5 text-right font-mono text-[10px] text-[#787B86]">
                          <div>SL: {pos.stop_loss ? formatNumber(pos.stop_loss, getPricePrecision(pos.stop_loss, pos.symbol)) : "—"}</div>
                          <div>TP: {pos.take_profit ? formatNumber(pos.take_profit, getPricePrecision(pos.take_profit, pos.symbol)) : "—"}</div>
                        </td>
                        <td className="py-2 px-1.5 text-right font-mono font-bold">
                          <span className={`inline-flex items-center gap-0.5 ${isProfit ? "text-[#089981]" : "text-[#F23645]"}`}>
                            {isProfit ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                            {isProfit ? "+" : "-"}{currSymbol}
                            {formatNumber(Math.abs(netVal), 2)} ({pos.pnl >= 0 ? "+" : ""}
                            {(pos.pnl_percent ?? 0).toFixed(2)}%)
                          </span>
                          <span className="block text-[9px] text-[#787B86] font-normal">
                            Gross {pos.pnl >= 0 ? "+" : ""}{formatNumber(pos.pnl, 2)} · Fee {currSymbol}{formatNumber((pos.entry_charges || 0) + (pos.est_exit_charges || 0), 2)}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            {canTrimHalf && (
                              <button
                                type="button"
                                onClick={() => {
                                  const half = isFrac ? Number((pos.quantity / 2).toFixed(6)) : Math.max(1, Math.floor(pos.quantity / 2));
                                  onClosePosition(pos.symbol, half, pos.order_type, pos.product_type);
                                }}
                                title="Trim 50% of position"
                                className="px-1.5 py-1 rounded-md text-[10px] font-mono font-bold bg-[#F0F3FA] hover:bg-[#2962FF] text-[#2962FF] hover:text-white transition"
                              >
                                50%
                              </button>
                            )}
                            {onReversePosition && (
                              <button
                                type="button"
                                onClick={() => onReversePosition(pos.id)}
                                title="Flip Long <-> Short at Live Market"
                                className="px-1.5 py-1 rounded-md text-[10px] font-bold bg-[#F0F3FA] hover:bg-[#131722] text-[#131722] hover:text-white transition inline-flex items-center gap-0.5"
                              >
                                <ArrowLeftRight className="w-3 h-3" /> Flip
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onClosePosition(pos.symbol, pos.quantity, pos.order_type, pos.product_type)}
                              aria-label={`${isShort ? "Cover" : "Close"} ${pos.symbol}`}
                              className="px-1.5 py-1 rounded-md text-[10px] font-bold bg-[#FFEBEE] hover:bg-[#F23645] text-[#F23645] hover:text-white transition inline-flex items-center gap-0.5"
                            >
                              <XCircle className="w-3 h-3" /> {isShort ? "Cover" : "Exit"}
                            </button>
                          </div>
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
            <p className="py-6 text-center text-xs text-[#787B86]">No pending Limit/Stop orders queued.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#F8F9FD] border-b border-[#E0E3EB] text-[#787B86] uppercase font-mono text-[10px]">
                  <th className="py-2 px-3">Asset</th>
                  <th className="py-2 px-3">Side / Product</th>
                  <th className="py-2 px-3 text-right">Qty</th>
                  <th className="py-2 px-3 text-right">Trigger / Limit</th>
                  <th className="py-2 px-3 text-right">Queued</th>
                  <th className="py-2 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E0E3EB]">
                {pendingOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-[#F8F9FD]">
                    <td className="py-2 px-3 font-mono font-bold text-[#131722]">{ord.symbol}</td>
                    <td className="py-2 px-3 font-bold text-[#2962FF]">
                      {ord.order_type} · {ord.product_type || "DELIVERY"}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{formatQty(ord.quantity)}</td>
                    <td className="py-2 px-3 text-right font-mono font-bold">{formatAssetPrice(ord.limit_price, ord.currency, ord.symbol)}</td>
                    <td className="py-2 px-3 text-right font-mono text-[#787B86]">{ord.created_at}</td>
                    <td className="py-2 px-3 text-center">
                      {onCancelPending && (
                        <button
                          type="button"
                          disabled={Boolean(cancellingIds[ord.id])}
                          onClick={() => {
                            if (cancellingIds[ord.id]) return;
                            setCancellingIds((prev) => ({ ...prev, [ord.id]: true }));
                            Promise.resolve(onCancelPending(ord.id)).finally(() => {
                              setTimeout(() => {
                                setCancellingIds((prev) => {
                                  if (!prev[ord.id]) return prev;
                                  const next = { ...prev };
                                  delete next[ord.id];
                                  return next;
                                });
                              }, 600);
                            });
                          }}
                          className="px-2.5 py-1 rounded bg-[#FFEBEE] hover:bg-[#F23645] disabled:opacity-50 disabled:pointer-events-none text-[#F23645] hover:text-white text-[11px] font-bold transition"
                        >
                          {cancellingIds[ord.id] ? "..." : "Cancel"}
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
                <tr className="bg-[#F8F9FD] border-b border-[#E0E3EB] text-[#787B86] uppercase font-mono text-[10px]">
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Country / Symbol</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3 text-right">Qty</th>
                  <th className="py-2 px-3 text-right">Fill Price</th>
                  <th className="py-2 px-3 text-right">Taxes &amp; Brok</th>
                  <th className="py-2 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E0E3EB]">
                {ordersHistory.map((h) => (
                  <tr key={h.id} className="hover:bg-[#F8F9FD]">
                    <td className="py-2 px-3 font-mono text-[#787B86]">{h.timestamp}</td>
                    <td className="py-2 px-3 font-mono font-bold text-[#131722]">
                      <span className="inline-flex items-center gap-1.5">
                        <CountryFlag code={h.country || "USA"} />
                        <span>{h.symbol}</span>
                      </span>
                    </td>
                    <td className={`py-2 px-3 font-bold ${h.type === "BUY" ? "text-[#089981]" : "text-[#F23645]"}`}>
                      {h.type} ({h.product_type || "DELIVERY"})
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{formatQty(h.quantity)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatAssetPrice(h.price, h.currency, h.symbol)}</td>
                    <td className="py-2 px-3 text-right font-mono text-[#F23645]">{formatMoney(h.charges, h.currency)}</td>
                    <td className="py-2 px-3 text-right font-mono text-[#089981]">{h.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "rejected" && (
        <div className="overflow-x-auto max-h-64">
          {rejectedOrders.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#787B86]">No cancelled or rejected orders.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#F8F9FD] border-b border-[#E0E3EB] text-[#787B86] uppercase font-mono text-[10px]">
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E0E3EB]">
                {rejectedOrders.map((r) => (
                  <tr key={r.id} className="hover:bg-[#F8F9FD]">
                    <td className="py-2 px-3 font-mono text-[#787B86]">{r.created_at || r.timestamp}</td>
                    <td className="py-2 px-3 font-mono font-bold text-[#131722]">{r.symbol}</td>
                    <td className="py-2 px-3 font-bold">{r.type} × {formatQty(r.quantity)}</td>
                    <td className="py-2 px-3 font-mono text-[#F23645] font-bold">{r.status}</td>
                    <td className="py-2 px-3 text-[#787B86]">{r.reject_reason || "Cancelled by trader"}</td>
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
