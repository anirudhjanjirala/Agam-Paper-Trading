"use client";

import React, { useState } from "react";
import { ArrowUpRight, ArrowDownRight, ShieldCheck, Zap } from "lucide-react";
import { formatAssetPrice, formatNumber, getCurrencySymbol } from "@/lib/format";

interface OrderDrawerProps {
  symbol: string;
  name: string;
  currentPrice: number;
  currency: string;
  walletBalance: number;
  onExecuteOrder: (order: {
    symbol: string;
    quantity: number;
    order_type: "BUY" | "SELL";
    order_mode: "MARKET" | "LIMIT";
    price?: number;
    stop_loss?: number;
    take_profit?: number;
  }) => Promise<{ success: boolean; message: string }>;
}

export default function OrderDrawer({
  symbol,
  name,
  currentPrice,
  currency,
  walletBalance,
  onExecuteOrder,
}: OrderDrawerProps) {
  const [orderType, setOrderType] = useState<"BUY" | "SELL">("BUY");
  const [orderMode, setOrderMode] = useState<"MARKET" | "LIMIT">("MARKET");
  const [quantity, setQuantity] = useState<number>(10);
  const [limitPriceInput, setLimitPriceInput] = useState<string>(currentPrice > 0 ? String(currentPrice) : "");
  const [limitEdited, setLimitEdited] = useState<boolean>(false);
  const [stopLoss, setStopLoss] = useState<string>("");
  const [takeProfit, setTakeProfit] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const effectiveLimitStr = !limitEdited && currentPrice > 0 ? String(currentPrice) : limitPriceInput;
  const parsedLimit = parseFloat(effectiveLimitStr);
  const limitNum = !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : currentPrice;

  const priceToUse = orderMode === "MARKET" ? currentPrice : limitNum;
  const totalAmount = priceToUse * quantity;
  const currencySymbol = getCurrencySymbol(currency);
  const estimatedCharges = totalAmount * 0.001;
  const canExecute = currentPrice > 0 && quantity >= 1 && (orderMode === "MARKET" || (!isNaN(parsedLimit) && parsedLimit > 0));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canExecute) return;
    setLoading(true);
    setFeedback(null);
    try {
      const result = await onExecuteOrder({
        symbol,
        quantity,
        order_type: orderType,
        order_mode: orderMode,
        price: orderMode === "LIMIT" ? parsedLimit : undefined,
        stop_loss: stopLoss ? parseFloat(stopLoss) : undefined,
        take_profit: takeProfit ? parseFloat(takeProfit) : undefined,
      });
      setFeedback(result);
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to execute order";
      setFeedback({ success: false, message: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#E0E3EB]">
          <div>
            <h3 className="text-base font-bold text-[#131722]">Order: {symbol}</h3>
            <p className="text-xs text-[#787B86] truncate max-w-[180px]">{name}</p>
          </div>
          <span suppressHydrationWarning className="text-xs font-mono px-2.5 py-1 rounded bg-[#FFFFFF] border border-[#E0E3EB] text-[#131722] font-semibold">
            {currency}: {currencySymbol}{formatNumber(walletBalance, 0, 0)}
          </span>
        </div>

        {/* Buy / Sell Toggle */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl mb-4">
          <button
            type="button"
            onClick={() => setOrderType("BUY")}
            className={`py-2 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
              orderType === "BUY" ? "bg-[#089981] text-white shadow-sm" : "text-[#787B86] hover:text-[#131722]"
            }`}
          >
            <ArrowUpRight className="w-4 h-4" /> BUY (LONG)
          </button>
          <button
            type="button"
            onClick={() => setOrderType("SELL")}
            className={`py-2 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
              orderType === "SELL" ? "bg-[#F23645] text-white shadow-sm" : "text-[#787B86] hover:text-[#131722]"
            }`}
          >
            <ArrowDownRight className="w-4 h-4" /> SELL (SHORT)
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#787B86] font-semibold">Execution Mode:</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOrderMode("MARKET")}
                className={`px-3 py-1 rounded-md text-xs font-bold border transition ${
                  orderMode === "MARKET"
                    ? "bg-[#2962FF] border-[#2962FF] text-white"
                    : "bg-[#FFFFFF] border-[#E0E3EB] text-[#787B86] hover:text-[#131722]"
                }`}
              >
                Market (LTP)
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!limitEdited || limitPriceInput === "" || limitPriceInput === "0") {
                    setLimitPriceInput(currentPrice > 0 ? String(currentPrice) : "");
                  }
                  setOrderMode("LIMIT");
                }}
                className={`px-3 py-1 rounded-md text-xs font-bold border transition ${
                  orderMode === "LIMIT"
                    ? "bg-[#2962FF] border-[#2962FF] text-white"
                    : "bg-[#FFFFFF] border-[#E0E3EB] text-[#787B86] hover:text-[#131722]"
                }`}
              >
                Limit
              </button>
            </div>
          </div>

          {/* Quantity */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-[#787B86] font-semibold">Quantity (Shares/Units):</span>
              <span className="text-[#131722] font-mono font-bold">{quantity}</span>
            </div>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] font-mono font-bold text-sm outline-none focus:border-[#2962FF]"
            />
            <div className="flex gap-1.5 mt-2">
              {[5, 10, 25, 50, 100].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuantity(q)}
                  className={`flex-1 py-1 rounded-md text-[11px] font-mono font-bold border transition ${
                    quantity === q
                      ? "bg-[#2962FF]/10 border-[#2962FF] text-[#2962FF]"
                      : "bg-[#FFFFFF] border-[#E0E3EB] text-[#787B86] hover:text-[#131722]"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {orderMode === "LIMIT" && (
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-[#787B86] font-semibold">Limit Price:</span>
                <span className="text-[#131722] font-mono font-bold">
                  LTP: {currentPrice > 0 ? formatAssetPrice(currentPrice, currency) : "--"}
                </span>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                placeholder={currentPrice > 0 ? String(currentPrice) : "Enter limit price"}
                value={effectiveLimitStr}
                onChange={(e) => {
                  setLimitEdited(true);
                  setLimitPriceInput(e.target.value);
                }}
                className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] font-mono font-bold text-sm outline-none focus:border-[#2962FF]"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-[#787B86] font-semibold block mb-1">Stop Loss (SL)</label>
              <input
                type="number"
                step="0.01"
                placeholder="Optional"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-2.5 py-1.5 text-[#131722] font-mono text-xs outline-none focus:border-[#F23645]"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#787B86] font-semibold block mb-1">Take Profit (TP)</label>
              <input
                type="number"
                step="0.01"
                placeholder="Optional"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-2.5 py-1.5 text-[#131722] font-mono text-xs outline-none focus:border-[#089981]"
              />
            </div>
          </div>

          {/* Margin Preview Card */}
          <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl p-3 space-y-2 text-xs">
            <div className="flex justify-between text-[#787B86]">
              <span>Required Margin:</span>
              <span suppressHydrationWarning className="text-[#131722] font-mono font-bold">
                {formatAssetPrice(totalAmount, currency)}
              </span>
            </div>
            <div className="flex justify-between text-[#787B86] text-[11px]">
              <span>Est. Statutory Fees (0.1%):</span>
              <span className="font-mono">{formatAssetPrice(estimatedCharges, currency)}</span>
            </div>
          </div>

          {feedback && (
            <div
              className={`p-2.5 rounded-xl text-xs font-bold text-center ${
                feedback.success
                  ? "bg-[#E8F5E9] border border-[#089981]/30 text-[#089981]"
                  : "bg-[#FFEBEE] border border-[#F23645]/30 text-[#F23645]"
              }`}
            >
              {feedback.message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !canExecute}
            className={`w-full py-3 rounded-xl font-black text-sm tracking-wide transition flex items-center justify-center gap-2 shadow-sm text-white disabled:opacity-50 disabled:cursor-not-allowed ${
              orderType === "BUY" ? "bg-[#089981] hover:opacity-95" : "bg-[#F23645] hover:opacity-95"
            }`}
          >
            <Zap className="w-4 h-4 fill-current" />
            {currentPrice <= 0
              ? "Waiting for Live Quote..."
              : loading
              ? "Executing..."
              : `EXECUTE PAPER ${orderType}`}
          </button>
        </form>
      </div>

      <div className="mt-4 pt-3 border-t border-[#E0E3EB] flex items-center justify-between text-[11px] text-[#787B86]">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-[#089981]" /> Persistent SQLite Ledger
        </span>
        <span>Paper Simulation</span>
      </div>
    </div>
  );
}
