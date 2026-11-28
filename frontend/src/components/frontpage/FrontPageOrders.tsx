"use client";

import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Edit3, Receipt, X } from "lucide-react";
import { formatAssetPrice, formatMoney, formatNumber, formatQty, getPricePrecision } from "@/lib/format";
import { COUNTRY_META, OrderHistoryItem, PendingOrder } from "@/types/trading";
import CountryFlag from "@/components/CountryFlag";

interface FrontPageOrdersProps {
  selectedCountry: string;
  pendingOrders: PendingOrder[];
  ordersHistory: OrderHistoryItem[];
  rejectedOrders: OrderHistoryItem[];
  onCancelPending: (orderId: string) => Promise<void>;
  onModifyPending: (orderId: string, limitPrice: number, quantity: number) => Promise<void>;
  onOpenSymbol: (symbol: string) => void;
}

export default function FrontPageOrders({
  selectedCountry,
  pendingOrders,
  ordersHistory,
  rejectedOrders,
  onCancelPending,
  onModifyPending,
  onOpenSymbol,
}: FrontPageOrdersProps) {
  const [countryFilter, setCountryFilter] = useState<string>(selectedCountry === "ALL" ? "ALL" : selectedCountry);
  const [subTab, setSubTab] = useState<"pending" | "executed" | "rejected">("executed");
  const [selectedReceipt, setSelectedReceipt] = useState<OrderHistoryItem | null>(null);
  const [editingOrder, setEditingOrder] = useState<PendingOrder | null>(null);
  const [modPrice, setModPrice] = useState<string>("");
  const [modQty, setModQty] = useState<string>("");

  const matchCountry = (c?: string) => countryFilter === "ALL" || (c || "USA") === countryFilter;
  const fPending = pendingOrders.filter((o) => matchCountry(o.country));
  const fExecuted = ordersHistory.filter((o) => matchCountry(o.country));
  const fRejected = rejectedOrders.filter((o) => matchCountry(o.country));

  return (
    <div className="space-y-4">
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["ALL", "IND", "USA", "CANADA", "CHINA", "EU", "CRYPTO", "FOREX"] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setCountryFilter(code)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition ${
                countryFilter === code
                  ? "bg-[#131722] text-white"
                  : "bg-[#F8F9FD] hover:bg-[#F0F3FA] text-[#787B86] border border-[#E0E3EB]"
              }`}
            >
              <CountryFlag code={code} />
              <span>{code === "ALL" ? "All Countries" : COUNTRY_META[code].short}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => setSubTab("pending")}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1 transition ${
              subTab === "pending" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
            }`}
          >
            <Clock className="w-3.5 h-3.5" /> Open / Pending ({fPending.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab("executed")}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1 transition ${
              subTab === "executed" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Executed ({fExecuted.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab("rejected")}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1 transition ${
              subTab === "rejected" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Cancelled / Rejected ({fRejected.length})
          </button>
        </div>
      </div>

      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm">
        {subTab === "pending" && (
          <div className="overflow-x-auto">
            {fPending.length === 0 ? (
              <p className="py-10 text-center text-xs text-[#787B86]">No open or pending limit/stop orders.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#F8F9FD] border-b border-[#E0E3EB] text-[#787B86] uppercase font-mono text-[10px]">
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Side / Product</th>
                    <th className="py-2.5 px-3">Mode</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Trigger / Limit</th>
                    <th className="py-2.5 px-3 text-right">SL / TP</th>
                    <th className="py-2.5 px-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E0E3EB]">
                  {fPending.map((o) => (
                    <tr key={o.id} className="hover:bg-[#F8F9FD]">
                      <td className="py-3 px-3">
                        <button type="button" onClick={() => onOpenSymbol(o.symbol)} className="inline-flex items-center gap-1.5 font-mono font-bold text-[#131722] hover:text-[#2962FF]">
                          <CountryFlag code={o.country || "USA"} /> {o.symbol}
                        </button>
                        <span className="block text-[10px] text-[#787B86]">{o.created_at}</span>
                      </td>
                      <td className="py-3 px-3 font-bold">
                        <span className={o.order_type === "BUY" ? "text-[#089981]" : "text-[#F23645]"}>{o.order_type}</span>{" "}
                        <span className="text-[10px] font-mono text-[#787B86]">({o.product_type || "DELIVERY"})</span>
                      </td>
                      <td className="py-3 px-3 font-mono">{o.order_mode || "LIMIT"}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold">{formatQty(o.quantity)}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold">{formatAssetPrice(o.limit_price, o.currency, o.symbol)}</td>
                      <td className="py-3 px-3 text-right font-mono text-[10px] text-[#787B86]">
                        SL: {o.stop_loss ? formatNumber(o.stop_loss, getPricePrecision(o.stop_loss, o.symbol)) : "—"} · TP: {o.take_profit ? formatNumber(o.take_profit, getPricePrecision(o.take_profit, o.symbol)) : "—"}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingOrder(o);
                              setModPrice(String(o.limit_price));
                              setModQty(String(o.quantity));
                            }}
                            className="px-2.5 py-1 rounded-lg bg-[#F0F3FA] hover:bg-[#2962FF] text-[#131722] hover:text-white text-[11px] font-bold flex items-center gap-1 transition"
                          >
                            <Edit3 className="w-3 h-3" /> Modify
                          </button>
                          <button
                            type="button"
                            onClick={() => onCancelPending(o.id)}
                            className="px-2.5 py-1 rounded-lg bg-[#FFEBEE] hover:bg-[#F23645] text-[#F23645] hover:text-white text-[11px] font-bold transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {subTab === "executed" && (
          <div className="overflow-x-auto">
            {fExecuted.length === 0 ? (
              <p className="py-10 text-center text-xs text-[#787B86]">No executed orders yet.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#F8F9FD] border-b border-[#E0E3EB] text-[#787B86] uppercase font-mono text-[10px]">
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Country / Symbol</th>
                    <th className="py-2.5 px-3">Side / Product</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Fill Price</th>
                    <th className="py-2.5 px-3 text-right">Brokerage</th>
                    <th className="py-2.5 px-3 text-right">Gov Taxes &amp; Fees</th>
                    <th className="py-2.5 px-3 text-right">Total Charges</th>
                    <th className="py-2.5 px-3 text-center">Contract Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E0E3EB]">
                  {fExecuted.map((h) => {
                    const govTaxes = (h.charges || 0) - (h.brokerage || 0);
                    return (
                      <tr key={h.id} className="hover:bg-[#F8F9FD]">
                        <td className="py-2.5 px-3 font-mono text-[#787B86]">{h.timestamp}</td>
                        <td className="py-2.5 px-3">
                          <button type="button" onClick={() => onOpenSymbol(h.symbol)} className="inline-flex items-center gap-1.5 font-mono font-bold text-[#131722] hover:text-[#2962FF]">
                            <CountryFlag code={h.country || "USA"} /> {h.symbol}
                          </button>
                          <span className="block text-[10px] text-[#787B86]">{h.exchange || h.country}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`font-bold ${h.type === "BUY" ? "text-[#089981]" : "text-[#F23645]"}`}>{h.type}</span>{" "}
                          <span className="text-[10px] font-mono text-[#787B86]">· {h.product_type || "DELIVERY"}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">{formatQty(h.quantity)}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">{formatAssetPrice(h.price, h.currency, h.symbol)}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-[#787B86]">
                          {formatMoney(h.brokerage ?? 0, h.currency)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-[#787B86]">
                          {formatMoney(Math.max(0, govTaxes), h.currency)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#F23645]">
                          {formatMoney(h.charges, h.currency)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => setSelectedReceipt(h)}
                            className="px-2.5 py-1 rounded-lg bg-[#2962FF]/10 hover:bg-[#2962FF] text-[#2962FF] hover:text-white text-[11px] font-bold inline-flex items-center gap-1 transition"
                          >
                            <Receipt className="w-3 h-3" /> Receipt
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {subTab === "rejected" && (
          <div className="overflow-x-auto">
            {fRejected.length === 0 ? (
              <p className="py-10 text-center text-xs text-[#787B86]">No cancelled or rejected orders recorded.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#F8F9FD] border-b border-[#E0E3EB] text-[#787B86] uppercase font-mono text-[10px]">
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Side / Qty</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E0E3EB]">
                  {fRejected.map((r) => (
                    <tr key={r.id} className="hover:bg-[#F8F9FD]">
                      <td className="py-2.5 px-3 font-mono text-[#787B86]">{r.created_at || r.timestamp}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#131722]">{r.symbol}</td>
                      <td className="py-2.5 px-3 font-bold">{r.type} × {formatQty(r.quantity)}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#F23645]">{r.status}</td>
                      <td className="py-2.5 px-3 text-[#787B86]">{r.reject_reason || "Cancelled by trader"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Itemized Statutory Contract Note Modal */}
      {selectedReceipt && (
        <div className="fixed inset-0 z-[95] bg-[#131722]/45 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => setSelectedReceipt(null)}>
          <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E0E3EB] pb-3">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-[#2962FF]" />
                <div>
                  <h3 className="text-sm font-black text-[#131722]">Statutory Contract Note</h3>
                  <p className="text-[11px] font-mono text-[#787B86]">
                    {selectedReceipt.id} · {selectedReceipt.country} ({selectedReceipt.exchange})
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedReceipt(null)} className="p-1 rounded-lg text-[#787B86] hover:bg-[#F0F3FA]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3.5 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#787B86]">Instrument</span>
                <strong className="font-mono text-[#131722]">{selectedReceipt.symbol} ({selectedReceipt.product_type})</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[#787B86]">Execution</span>
                <strong className="font-mono text-[#131722]">
                  {selectedReceipt.type} {formatQty(selectedReceipt.quantity)} @ {formatAssetPrice(selectedReceipt.price, selectedReceipt.currency, selectedReceipt.symbol)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[#787B86]">Gross Turnover</span>
                <strong className="font-mono text-[#131722]">
                  {formatMoney(selectedReceipt.gross_amount || selectedReceipt.price * selectedReceipt.quantity, selectedReceipt.currency)}
                </strong>
              </div>
            </div>

            <div className="space-y-1.5 text-xs border-t border-[#E0E3EB] pt-3">
              <div className="flex justify-between"><span className="text-[#787B86]">Brokerage ({selectedReceipt.broker_plan})</span><span className="font-mono font-semibold">{formatMoney(selectedReceipt.brokerage ?? 0, selectedReceipt.currency)}</span></div>
              <div className="flex justify-between"><span className="text-[#787B86]">STT / SDRT / FTT</span><span className="font-mono font-semibold">{formatMoney(selectedReceipt.stt_or_ftt ?? 0, selectedReceipt.currency)}</span></div>
              <div className="flex justify-between"><span className="text-[#787B86]">Stamp Duty</span><span className="font-mono font-semibold">{formatMoney(selectedReceipt.stamp_duty ?? 0, selectedReceipt.currency)}</span></div>
              <div className="flex justify-between"><span className="text-[#787B86]">Exchange Txn Fee</span><span className="font-mono font-semibold">{formatMoney(selectedReceipt.exchange_fee ?? 0, selectedReceipt.currency)}</span></div>
              <div className="flex justify-between"><span className="text-[#787B86]">Regulator (SEBI/SEC/FINRA/CIRO/CSRC)</span><span className="font-mono font-semibold">{formatMoney(selectedReceipt.regulator_fee ?? 0, selectedReceipt.currency)}</span></div>
              <div className="flex justify-between"><span className="text-[#787B86]">GST / VAT</span><span className="font-mono font-semibold">{formatMoney(selectedReceipt.gst_vat ?? 0, selectedReceipt.currency)}</span></div>
              <div className="flex justify-between"><span className="text-[#787B86]">DP / Transfer / CAT Clearing</span><span className="font-mono font-semibold">{formatMoney(selectedReceipt.dp_or_clearing_fee ?? 0, selectedReceipt.currency)}</span></div>
              <div className="flex justify-between pt-2 border-t border-[#E0E3EB] font-black text-sm">
                <span className="text-[#131722]">Total Statutory Charges</span>
                <span className="font-mono text-[#F23645]">{formatMoney(selectedReceipt.charges, selectedReceipt.currency)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modify Pending Order Modal */}
      {editingOrder && (
        <div className="fixed inset-0 z-[95] bg-[#131722]/45 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => setEditingOrder(null)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              await onModifyPending(editingOrder.id, parseFloat(modPrice), Math.max(0.0001, parseFloat(modQty) || 1));
              setEditingOrder(null);
            }}
            className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4"
          >
            <h3 className="text-sm font-black text-[#131722]">Modify Order — {editingOrder.symbol}</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-[#787B86] block mb-1">Limit / Trigger Price</label>
                <input type="number" step="any" required value={modPrice} onChange={(e) => setModPrice(e.target.value)} className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 font-mono font-bold" />
              </div>
              <div>
                <label className="font-semibold text-[#787B86] block mb-1">Quantity / Units</label>
                <input type="number" step="any" min="0.0001" required value={modQty} onChange={(e) => setModQty(e.target.value)} className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 font-mono font-bold" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditingOrder(null)} className="px-3 py-2 rounded-xl bg-[#F0F3FA] text-xs font-bold text-[#787B86]">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-[#2962FF] text-white text-xs font-bold">Save Changes</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
