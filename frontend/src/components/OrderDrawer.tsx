"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  ChevronDown,
  ChevronUp,
  Info,
  Layers,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Zap,
} from "lucide-react";
import { formatAssetPrice, formatMoney, formatNumber, formatQty, getCurrencySymbol, getPricePrecision } from "@/lib/format";
import { apiUrl } from "@/lib/api";
import CountryFlag from "@/components/CountryFlag";
import { CapitalHealthEntry, ChargeBreakdown, OrderDraftPreset } from "@/types/trading";

function estimateClientChargesSync(
  notional: number,
  countryCode: string,
  productType: string,
  side: string,
  brokerPlan: string,
  category: string = "stocks"
): number {
  if (notional <= 0) return 0;
  const c = (countryCode || "USA").toUpperCase();
  const cat = (category || "stocks").toLowerCase();
  if (c === "CRYPTO" || cat === "crypto") {
    const isPerp = productType === "INTRADAY" || productType === "FUTURES";
    const rate = isPerp ? (brokerPlan === "PRO" ? 0.0002 : 0.0005) : (brokerPlan === "PRO" ? 0.0004 : 0.001);
    return Number((notional * rate).toFixed(2));
  }
  if (c === "FOREX") {
    return brokerPlan === "PRO" ? Number(Math.max(0.35, notional * 0.000035).toFixed(2)) : 0;
  }
  const isIntra = productType === "INTRADAY" || productType === "FUTURES";
  const isSell = side === "SELL";
  if (c === "IND") {
    if (cat === "forex") {
      const brok = Math.min(20, notional * 0.0003);
      return Number((brok + notional * 0.000005 + brok * 0.18).toFixed(2));
    }
    if (cat === "bonds" && productType === "DELIVERY") {
      return Number((brokerPlan === "PRO" ? notional * 0.001 : 0.0 + notional * 0.000003).toFixed(2));
    }
    if (cat === "commodities" && (productType === "FUTURES" || productType === "OPTIONS")) {
      const brok = 20;
      const ctt = isSell ? notional * (productType === "OPTIONS" ? 0.0005 : 0.0001) : 0;
      return Number((brok + ctt + notional * 0.000022 + brok * 0.18).toFixed(2));
    }
    const brok = isIntra
      ? Math.min(20, notional * 0.0003)
      : brokerPlan === "PRO"
      ? Math.min(250, notional * 0.001)
      : 0;
    const stt = isIntra
      ? isSell && cat !== "commodities"
        ? notional * 0.00025
        : 0
      : cat === "stocks"
      ? notional * 0.001
      : cat === "etfs" && isSell
      ? notional * 0.00001
      : 0;
    const stamp = !isSell ? notional * (isIntra ? 0.00003 : 0.00015) : 0;
    const exch = notional * 0.0000307;
    const sebi = notional * 0.000001;
    const gst = (brok + exch + sebi) * 0.18;
    return Number((brok + stt + stamp + exch + sebi + gst).toFixed(2));
  }
  if (c === "CHINA") {
    if (cat === "forex") return Number(Math.max(5, notional * 0.00005).toFixed(2));
    if (cat === "bonds") return Number(Math.max(1, notional * 0.0001).toFixed(2));
    const brok = Math.max(5, notional * 0.00025);
    const stamp = isSell && cat === "stocks" ? notional * 0.0005 : 0;
    const exch = notional * 0.0000441;
    return Number((brok + stamp + exch).toFixed(2));
  }
  if (c === "EU") {
    if (cat === "forex") return Number((brokerPlan === "PRO" ? Math.max(1, notional * 0.00002) : 0).toFixed(2));
    const brok = Math.max(2, notional * 0.0005);
    const stamp = !isSell && cat === "stocks" ? notional * 0.003 : 0;
    return Number((brok + stamp).toFixed(2));
  }
  if (c === "CANADA") {
    const brok = brokerPlan === "PRO" ? 0 : Math.min(9.95, Math.max(4.95, notional * 0.0001));
    return Number((brok + notional * 0.00005).toFixed(2));
  }
  // USA default
  if (cat === "forex" || cat === "bonds") {
    return Number((brokerPlan === "PRO" ? Math.max(1.0, notional * 0.00002) : 0).toFixed(2));
  }
  const brok = brokerPlan === "PRO" ? Math.max(1.0, notional * 0.0005) : 0;
  return Number((brok + notional * 0.00003).toFixed(2));
}

interface OrderDrawerProps {
  symbol: string;
  name: string;
  currentPrice: number;
  currency: string;
  country?: string;
  exchange?: string;
  category?: string;
  walletBalance: number;
  capitalHealth?: CapitalHealthEntry;
  preset?: OrderDraftPreset | null;
  onExecuteOrder: (order: {
    symbol: string;
    quantity: number;
    order_type: "BUY" | "SELL";
    order_mode: "MARKET" | "LIMIT" | "STOP";
    product_type?: "DELIVERY" | "INTRADAY" | "FUTURES" | "OPTIONS";
    broker_plan?: "DISCOUNT" | "PRO";
    price?: number;
    stop_loss?: number;
    take_profit?: number;
    trailing_sl?: number;
    notes?: string;
  }) => Promise<{ success: boolean; message: string }>;
  onPlaceLadder?: (ladder: {
    symbol: string;
    total_quantity: number;
    order_type: "BUY" | "SELL";
    product_type?: "DELIVERY" | "INTRADAY" | "FUTURES" | "OPTIONS";
    broker_plan?: "DISCOUNT" | "PRO";
    price_start: number;
    price_end: number;
    rungs: number;
    stop_loss?: number;
    take_profit?: number;
    notes?: string;
  }) => Promise<{ success: boolean; message: string }>;
}

export default function OrderDrawer({
  symbol,
  name,
  currentPrice,
  currency,
  country,
  exchange,
  category,
  walletBalance,
  capitalHealth,
  preset,
  onExecuteOrder,
  onPlaceLadder,
}: OrderDrawerProps) {
  const symU = symbol.toUpperCase();
  const isCrypto = country === "CRYPTO" || category === "crypto" || /-(USD|USDT|EUR|GBP|BTC|ETH)$/i.test(symU);
  const isForex = !isCrypto && (country === "FOREX" || category === "forex" || symU.endsWith("=X"));
  const isFo = symU.includes("-FO") || category === "commodities";
  const defaultQtyStr = isForex
    ? "1000"
    : isCrypto
    ? currentPrice >= 10000
      ? "0.01"
      : currentPrice >= 500
      ? "0.25"
      : currentPrice >= 10
      ? "5"
      : "100"
    : "10";

  const [orderType, setOrderType] = useState<"BUY" | "SELL">(preset?.side || "BUY");
  const [productType, setProductType] = useState<"DELIVERY" | "INTRADAY" | "FUTURES" | "OPTIONS">(
    preset?.product_type || (isForex ? "INTRADAY" : isFo ? "FUTURES" : "DELIVERY")
  );
  const [orderMode, setOrderMode] = useState<"MARKET" | "LIMIT" | "STOP" | "LADDER">("MARKET");
  const [brokerPlan, setBrokerPlan] = useState<"DISCOUNT" | "PRO">("DISCOUNT");
  const [qtyStr, setQtyStr] = useState<string>(defaultQtyStr);
  const [limitPriceInput, setLimitPriceInput] = useState<string>(currentPrice > 0 ? String(currentPrice) : "");
  const [limitEdited, setLimitEdited] = useState<boolean>(false);
  const [ladderEndInput, setLadderEndInput] = useState<string>("");
  const [ladderRungs, setLadderRungs] = useState<number>(4);
  const [stopLoss, setStopLoss] = useState<string>(preset?.stop_loss ? String(preset.stop_loss) : "");
  const [takeProfit, setTakeProfit] = useState<string>(preset?.take_profit ? String(preset.take_profit) : "");
  const [trailingEnabled, setTrailingEnabled] = useState<boolean>(false);
  const [trailingSl, setTrailingSl] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [showBreakdown, setShowBreakdown] = useState<boolean>(true);
  const [previewState, setPreviewState] = useState<{ symbol: string; breakdown: ChargeBreakdown } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const parsedQty = parseFloat(qtyStr);
  const quantity = !isNaN(parsedQty) && parsedQty > 0 ? (isCrypto || isForex ? parsedQty : Math.max(1, Math.round(parsedQty))) : 0;

  const effectiveLimitStr = !limitEdited && currentPrice > 0 ? String(currentPrice) : limitPriceInput;
  const parsedLimit = parseFloat(effectiveLimitStr);
  const limitNum = !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : currentPrice;

  const priceToUse = orderMode === "MARKET" ? currentPrice : limitNum;
  const fxApproxScale = isForex && symU.startsWith("USD") && !symU.includes("INR") && currency === "USD" && priceToUse > 0 ? 1 / priceToUse : 1;
  const totalNotional = priceToUse * quantity * fxApproxScale;
  const currencySymbol = getCurrencySymbol(currency);
  const pxPrec = getPricePrecision(priceToUse || currentPrice, symbol);

  const leverage = isCrypto
    ? productType === "FUTURES"
      ? 20
      : productType === "INTRADAY"
      ? 10
      : 1
    : isForex
    ? productType === "INTRADAY" || productType === "FUTURES"
      ? country === "FOREX" || !country
        ? 20
        : 5
      : 1
    : productType === "INTRADAY" || productType === "FUTURES"
    ? country === "IND"
      ? 5
      : country === "USA"
      ? 4
      : country === "CANADA" || country === "EU"
      ? 3
      : 2
    : 1;
  const fallbackMargin = totalNotional / leverage;

  // Fetch exact live country-specific tax & brokerage preview
  useEffect(() => {
    if (priceToUse <= 0 || quantity <= 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(apiUrl("/api/charges/preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          symbol,
          quantity,
          price: priceToUse,
          order_type: orderType,
          product_type: productType,
          broker_plan: brokerPlan,
          country,
          exchange,
          currency,
          category,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: ChargeBreakdown | null) => {
          if (!controller.signal.aborted && d) setPreviewState({ symbol, breakdown: d });
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [symbol, quantity, priceToUse, orderType, productType, brokerPlan, country, exchange, currency, category]);

  const parsedLadderEnd = parseFloat(ladderEndInput);
  const canExecute =
    currentPrice > 0 &&
    quantity > 0 &&
    (orderMode === "MARKET" ||
      (orderMode === "LADDER"
        ? !isNaN(parsedLimit) && parsedLimit > 0 && !isNaN(parsedLadderEnd) && parsedLadderEnd > 0
        : !isNaN(parsedLimit) && parsedLimit > 0));

  const applyQuickPct = (kind: "sl" | "tp", pct: number) => {
    const base = priceToUse > 0 ? priceToUse : currentPrice;
    if (base <= 0) return;
    const dec = getPricePrecision(base, symbol);
    if (kind === "tp") {
      const mult = orderType === "BUY" ? 1 + pct / 100 : 1 - pct / 100;
      setTakeProfit((base * mult).toFixed(dec));
    } else {
      const mult = orderType === "BUY" ? 1 - pct / 100 : 1 + pct / 100;
      setStopLoss((base * mult).toFixed(dec));
    }
  };

  const formatSizedQty = (rawQty: number): string => {
    if (isCrypto) {
      if (rawQty < 0.1) return Number(rawQty.toFixed(5)).toString();
      if (rawQty < 10) return Number(rawQty.toFixed(3)).toString();
      return String(Math.max(1, Math.floor(rawQty)));
    }
    return String(Math.max(1, Math.floor(rawQty)));
  };

  const applyCapitalFraction = (frac: number) => {
    if (priceToUse <= 0 || walletBalance <= 0) return;
    const estCostPerUnit = ((priceToUse * fxApproxScale) / leverage) * 1.006;
    const rawQty = (walletBalance * frac) / estCostPerUnit;
    setQtyStr(formatSizedQty(rawQty));
  };

  const applyRiskSizer = (riskPct: number) => {
    if (priceToUse <= 0 || walletBalance <= 0) return;
    const slParsed = parseFloat(stopLoss);
    const slDist =
      !isNaN(slParsed) && slParsed > 0 && Math.abs(priceToUse - slParsed) > priceToUse * 0.0005
        ? Math.abs(priceToUse - slParsed) * fxApproxScale
        : priceToUse * fxApproxScale * 0.015;
    const riskBudget = walletBalance * riskPct;
    const riskQty = riskBudget / slDist;
    const maxAffordable = (walletBalance * 0.95) / (((priceToUse * fxApproxScale) / leverage) * 1.006);
    setQtyStr(formatSizedQty(Math.min(riskQty || 1, Math.max(0.0001, maxAffordable))));
  };

  const applyUsdNotional = (usdTarget: number) => {
    if (priceToUse <= 0) return;
    const rawQty = usdTarget / (priceToUse * fxApproxScale);
    setQtyStr(formatSizedQty(rawQty));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canExecute) return;
    setLoading(true);
    setFeedback(null);
    try {
      const result =
        orderMode === "LADDER" && onPlaceLadder
          ? await onPlaceLadder({
              symbol,
              total_quantity: quantity,
              order_type: orderType,
              product_type: productType,
              broker_plan: brokerPlan,
              price_start: parsedLimit,
              price_end: parsedLadderEnd,
              rungs: ladderRungs,
              stop_loss: stopLoss ? parseFloat(stopLoss) : undefined,
              take_profit: takeProfit ? parseFloat(takeProfit) : undefined,
              notes: notes.trim(),
            })
          : await onExecuteOrder({
              symbol,
              quantity,
              order_type: orderType,
              order_mode: orderMode === "LADDER" ? "LIMIT" : orderMode,
              product_type: productType,
              broker_plan: brokerPlan,
              price: orderMode !== "MARKET" ? parsedLimit : undefined,
              stop_loss: stopLoss ? parseFloat(stopLoss) : undefined,
              take_profit: takeProfit ? parseFloat(takeProfit) : undefined,
              trailing_sl: trailingEnabled && trailingSl ? parseFloat(trailingSl) : undefined,
              notes: notes.trim(),
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

  const chargePreview = previewState?.breakdown ?? null;
  const previewMatchesCurrent =
    previewState !== null &&
    previewState.symbol === symbol &&
    previewState.breakdown.quantity === quantity &&
    previewState.breakdown.side === orderType &&
    previewState.breakdown.product_type === productType &&
    previewState.breakdown.broker_plan === brokerPlan;
  const matchedBreakdown = previewMatchesCurrent && previewState ? previewState.breakdown : null;
  const resolvedCountry = (chargePreview?.country || country || "USA").toUpperCase();
  const estTotalCharges = matchedBreakdown
    ? matchedBreakdown.total_charges
    : estimateClientChargesSync(totalNotional, resolvedCountry, productType, orderType, brokerPlan, category);
  const reqMargin = matchedBreakdown ? matchedBreakdown.margin_required : fallbackMargin;
  const totalCashRequired = reqMargin + estTotalCharges;

  const isLowCapital = capitalHealth && capitalHealth.status !== "HEALTHY";
  const isConcentrationRisk = walletBalance > 0 && totalCashRequired > walletBalance * 0.25;
  const isUnhedgedLeverage = leverage > 1 && !stopLoss.trim() && !trailingEnabled;

  // Risk : Reward ratio & Liquidation Price estimates
  const slNum = parseFloat(stopLoss);
  const tpNum = parseFloat(takeProfit);
  const slDistVal = !isNaN(slNum) && slNum > 0 && priceToUse > 0 ? Math.abs(priceToUse - slNum) : 0;
  const tpDistVal = !isNaN(tpNum) && tpNum > 0 && priceToUse > 0 ? Math.abs(tpNum - priceToUse) : 0;
  const rrRatio = slDistVal > 0 && tpDistVal > 0 ? tpDistVal / slDistVal : null;
  const estLiqPrice =
    leverage > 1 && priceToUse > 0
      ? orderType === "BUY"
        ? priceToUse * Math.max(0.05, 1 - 0.9 / leverage)
        : priceToUse * (1 + 0.9 / leverage)
      : null;

  // Forex pip value calculation (1 pip = 0.01 JPY or 0.0001 other)
  const fxPipSize = isForex ? (priceToUse >= 50 || symU.includes("JPY") ? 0.01 : 0.0001) : 0;
  const fxPipValueUsd = isForex && quantity > 0 ? quantity * fxPipSize * fxApproxScale : 0;
  const fxLots = isForex ? quantity / 100000 : 0;

  // Simulated L2 indicative order book steps around priceToUse
  const depthStep = isForex
    ? fxPipSize * 0.5
    : priceToUse > 5000
    ? 5.0
    : priceToUse > 500
    ? 0.5
    : priceToUse > 10
    ? 0.05
    : Number((10 ** -Math.max(2, pxPrec - 1)).toFixed(pxPrec));
  const simBids = priceToUse > 0
    ? [1, 2, 3].map((i) => ({
        px: Number((priceToUse - depthStep * i).toFixed(pxPrec)),
        sz: isCrypto
          ? Number((Math.max(0.05, ((quantity * (4 - i) * 1.7) % 12) + 0.25)).toFixed(quantity < 1 ? 3 : 2))
          : Math.max(10, Math.round((quantity * (4 - i) * 7) % 850) + 45),
      }))
    : [];
  const simAsks = priceToUse > 0
    ? [1, 2, 3].map((i) => ({
        px: Number((priceToUse + depthStep * i).toFixed(pxPrec)),
        sz: isCrypto
          ? Number((Math.max(0.05, ((quantity * (i + 2) * 1.4) % 10) + 0.20)).toFixed(quantity < 1 ? 3 : 2))
          : Math.max(10, Math.round((quantity * (i + 2) * 9) % 790) + 38),
      }))
    : [];

  const productOptions: Array<{ id: "DELIVERY" | "INTRADAY" | "FUTURES"; label: string }> = isCrypto
    ? [
        { id: "DELIVERY", label: "Spot (1x)" },
        { id: "INTRADAY", label: "Margin (10x)" },
        { id: "FUTURES", label: "Perp (20x)" },
      ]
    : isForex
    ? [
        { id: "DELIVERY", label: "Spot FX (1x)" },
        { id: "INTRADAY", label: `FX Margin (${country === "IND" ? "5x" : "20x"})` },
      ]
    : [
        { id: "DELIVERY", label: "Delivery (1x)" },
        { id: "INTRADAY", label: `Intraday (${country === "IND" ? "5x" : country === "USA" ? "4x" : "3x"} MIS)` },
      ];

  return (
    <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-2xl p-4 shadow-sm flex flex-col justify-between">
      <div>
        {/* FrontPage Header with Country Flag + Available Margin */}
        <div className="flex items-start justify-between gap-2 mb-3 pb-2.5 border-b border-[#E0E3EB]">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <CountryFlag code={resolvedCountry} />
              <h3 className="text-sm font-black text-[#131722] truncate">{symbol}</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FFFFFF] border border-[#E0E3EB] font-mono text-[#787B86]">
                {exchange || chargePreview?.exchange || "MKT"}
              </span>
            </div>
            <p className="text-[11px] text-[#787B86] truncate max-w-[180px]">{name}</p>
          </div>
          <div className="text-right shrink-0">
            <span className="text-[9px] uppercase font-mono text-[#787B86] block">Available Cash</span>
            <span
              suppressHydrationWarning
              className={`text-xs font-mono px-2 py-0.5 rounded border font-bold inline-block ${
                isLowCapital
                  ? "bg-[#FFEBEE] border-[#F23645]/40 text-[#F23645]"
                  : "bg-[#FFFFFF] border-[#E0E3EB] text-[#131722]"
              }`}
            >
              {currencySymbol}
              {formatNumber(walletBalance, 2)}
            </span>
          </div>
        </div>

        {isLowCapital && capitalHealth && (
          <div className="mb-2.5 p-2 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-[10px] flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
            <span>
              <strong>{capitalHealth.status}:</strong> {capitalHealth.cash_pct.toFixed(1)}% free cash left (no wallet reset allowed).
            </span>
          </div>
        )}

        {/* Buy / Sell Bold FrontPage Toggle */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl mb-3">
          <button
            type="button"
            onClick={() => setOrderType("BUY")}
            className={`py-2 rounded-lg text-xs font-black flex items-center justify-center gap-1 transition ${
              orderType === "BUY" ? "bg-[#089981] text-white shadow-sm" : "text-[#787B86] hover:text-[#131722]"
            }`}
          >
            <ArrowUpRight className="w-4 h-4" /> BUY
          </button>
          <button
            type="button"
            onClick={() => setOrderType("SELL")}
            className={`py-2 rounded-lg text-xs font-black flex items-center justify-center gap-1 transition ${
              orderType === "SELL" ? "bg-[#F23645] text-white shadow-sm" : "text-[#787B86] hover:text-[#131722]"
            }`}
          >
            <ArrowDownRight className="w-4 h-4" /> SELL / SHORT
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Product Type (Crypto Spot/Perps | Forex Spot/Margin | Equity Delivery/Intraday) */}
          <div className={`grid gap-1.5 text-[11px] ${productOptions.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {productOptions.map((prod) => (
              <button
                key={prod.id}
                type="button"
                onClick={() => setProductType(prod.id)}
                className={`py-1.5 px-2 rounded-lg font-bold border transition ${
                  productType === prod.id
                    ? "bg-[#2962FF]/10 border-[#2962FF] text-[#2962FF]"
                    : "bg-[#FFFFFF] border-[#E0E3EB] text-[#787B86] hover:text-[#131722]"
                }`}
              >
                {prod.label}
              </button>
            ))}
          </div>

          {/* Order Mode + Brokerage Plan */}
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <div className="flex gap-1 flex-wrap">
              {(["MARKET", "LIMIT", "STOP", "LADDER"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    if (m !== "MARKET" && (!limitEdited || !limitPriceInput)) {
                      setLimitPriceInput(currentPrice > 0 ? String(currentPrice) : "");
                    }
                    if (m === "LADDER" && currentPrice > 0 && !ladderEndInput) {
                      const mult = orderType === "BUY" ? 0.97 : 1.03;
                      setLadderEndInput((currentPrice * mult).toFixed(getPricePrecision(currentPrice, symbol)));
                    }
                    setOrderMode(m);
                  }}
                  className={`px-2 py-1 rounded-md font-bold border transition ${
                    orderMode === m
                      ? "bg-[#131722] border-[#131722] text-white"
                      : "bg-[#FFFFFF] border-[#E0E3EB] text-[#787B86] hover:text-[#131722]"
                  }`}
                >
                  {m === "MARKET" ? "Market" : m === "LIMIT" ? "Limit" : m === "STOP" ? "SL Trigger" : "Ladder"}
                </button>
              ))}
            </div>

            <select
              aria-label="Brokerage Plan"
              value={brokerPlan}
              onChange={(e) => setBrokerPlan(e.target.value as "DISCOUNT" | "PRO")}
              className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-md px-1.5 py-1 text-[10px] font-bold text-[#131722] outline-none cursor-pointer"
              title="Select Broker Commission Tier"
            >
              <option value="DISCOUNT">{isCrypto ? "Taker (0.10%/0.05%)" : isForex ? "Raw Spread ($0)" : "Discount Broker"}</option>
              <option value="PRO">{isCrypto ? "VIP Maker (0.04%/0.02%)" : isForex ? "ECN Pro ($3.50/lot)" : "Pro / Full-Service"}</option>
            </select>
          </div>

          {/* Quantity / Crypto Fractional Notional / Forex Lots */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[#787B86] font-semibold">
                {isCrypto ? "Coin Qty (Fractional):" : isForex ? `Units (${fxLots.toFixed(2)} Lots):` : "Quantity:"}
              </span>
              <div className="flex items-center gap-1.5">
                {[0.25, 0.5, 0.95].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => applyCapitalFraction(f)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-[#FFFFFF] border border-[#E0E3EB] hover:border-[#2962FF] text-[#2962FF] font-bold"
                  >
                    {f === 0.95 ? "MAX" : `${f * 100}%`}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="number"
              step={isCrypto ? "any" : "1"}
              min={isCrypto ? "0.00001" : "1"}
              value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value)}
              className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] font-mono font-bold text-sm outline-none focus:border-[#2962FF]"
            />

            {isCrypto ? (
              <div className="grid grid-cols-4 gap-1 mt-1.5">
                {[100, 500, 1000, 5000].map((usd) => (
                  <button
                    key={usd}
                    type="button"
                    onClick={() => applyUsdNotional(usd)}
                    className="py-1 rounded-md text-[10px] font-mono font-bold border bg-[#FFFFFF] border-[#E0E3EB] text-[#787B86] hover:border-[#2962FF] hover:text-[#2962FF] transition"
                    title={`Size ${usd} ${currency} notional at market`}
                  >
                    {currencySymbol}{usd >= 1000 ? `${usd / 1000}K` : usd}
                  </button>
                ))}
              </div>
            ) : isForex ? (
              <div className="space-y-1 mt-1.5">
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { u: 1000, lbl: "0.01 Lot" },
                    { u: 10000, lbl: "0.10 Mini" },
                    { u: 50000, lbl: "0.50 Lot" },
                    { u: 100000, lbl: "1.00 Std" },
                  ].map((lot) => (
                    <button
                      key={lot.u}
                      type="button"
                      onClick={() => setQtyStr(String(lot.u))}
                      className={`py-1 rounded-md text-[10px] font-mono font-bold border transition ${
                        quantity === lot.u
                          ? "bg-[#2962FF]/10 border-[#2962FF] text-[#2962FF]"
                          : "bg-[#FFFFFF] border-[#E0E3EB] text-[#787B86] hover:text-[#131722]"
                      }`}
                    >
                      {lot.lbl}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] font-mono text-[#787B86] px-0.5">
                  <span>1 Pip = {fxPipSize}</span>
                  <span>Pip Value ≈ <strong className="text-[#131722]">{formatMoney(fxPipValueUsd, currency)}/pip</strong></span>
                </div>
              </div>
            ) : (
              <div className="flex gap-1 mt-1.5">
                {[1, 5, 10, 25, 50, 100].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQtyStr(String(q))}
                    className={`flex-1 py-1 rounded-md text-[10px] font-mono font-bold border transition ${
                      quantity === q
                        ? "bg-[#2962FF]/10 border-[#2962FF] text-[#2962FF]"
                        : "bg-[#FFFFFF] border-[#E0E3EB] text-[#787B86] hover:text-[#131722]"
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-1.5 mt-1.5">
              <span className="text-[10px] text-[#787B86] font-semibold">Risk Sizer:</span>
              <div className="flex gap-1">
                {[0.01, 0.02].map((rp) => (
                  <button
                    key={rp}
                    type="button"
                    onClick={() => applyRiskSizer(rp)}
                    title="Auto-calculate Qty risking % of equity based on SL (or 1.5% stop)"
                    className="text-[10px] px-2 py-0.5 rounded bg-[#E8F5E9] hover:bg-[#089981] text-[#089981] hover:text-white font-bold transition"
                  >
                    Risk {rp * 100}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {orderMode !== "MARKET" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[#787B86] font-semibold">
                  {orderMode === "LADDER" ? "Ladder Start Price:" : orderMode === "LIMIT" ? "Limit Price:" : "Trigger Price:"}
                </span>
                <span className="text-[#131722] font-mono font-bold">
                  LTP: {currentPrice > 0 ? formatAssetPrice(currentPrice, currency, symbol) : "--"}
                </span>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                placeholder={currentPrice > 0 ? String(currentPrice) : "Enter price"}
                value={effectiveLimitStr}
                onChange={(e) => {
                  setLimitEdited(true);
                  setLimitPriceInput(e.target.value);
                }}
                className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] font-mono font-bold text-sm outline-none focus:border-[#2962FF]"
              />
              {orderMode === "LADDER" && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="col-span-2">
                    <label className="text-[10px] text-[#787B86] font-semibold block mb-1">Ladder End Price</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={ladderEndInput}
                      onChange={(e) => setLadderEndInput(e.target.value)}
                      placeholder="Target zone end"
                      className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-2.5 py-1.5 text-[#131722] font-mono font-bold text-xs outline-none focus:border-[#2962FF]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#787B86] font-semibold block mb-1">Rungs (2-8)</label>
                    <select
                      aria-label="Ladder Rungs"
                      value={ladderRungs}
                      onChange={(e) => setLadderRungs(Number(e.target.value))}
                      className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-2 py-1.5 text-[#131722] font-mono font-bold text-xs outline-none"
                    >
                      {[2, 3, 4, 5, 6, 8].map((r) => (
                        <option key={r} value={r}>{r} Rungs</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3 text-[10px] font-mono text-[#2962FF] bg-[#F0F3FA] rounded-lg px-2 py-1 space-y-1">
                    <div className="flex justify-between">
                      <span>Avg Qty / Rung:</span>
                      <strong>{formatQty(quantity / ladderRungs)} units × {ladderRungs}</strong>
                    </div>
                    {(() => {
                      const ps = Number(effectiveLimitStr);
                      const pe = Number(ladderEndInput);
                      if (!(ps > 0) || !(pe > 0)) return null;
                      const dec = getPricePrecision(ps, symbol);
                      const prices = Array.from({ length: ladderRungs }, (_, i) =>
                        ps + (pe - ps) * (i / Math.max(1, ladderRungs - 1))
                      );
                      return (
                        <div className="flex flex-wrap gap-1 pt-0.5 text-[9px] text-[#131722]">
                          {prices.map((px, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 rounded bg-[#FFFFFF] border border-[#E0E3EB]">
                              R{idx + 1}: {formatNumber(px, dec)}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* FrontPage Target & Stop-Loss with Quick % Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-[#787B86] font-semibold">Stop Loss</label>
                <div className="flex gap-1">
                  {[1, 2].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => applyQuickPct("sl", p)}
                      className="text-[9px] px-1 rounded bg-[#FFEBEE] text-[#F23645] font-bold"
                    >
                      -{p}%
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="number"
                step="any"
                placeholder="Optional SL"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-2.5 py-1.5 text-[#131722] font-mono text-xs outline-none focus:border-[#F23645]"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-[#787B86] font-semibold">Target</label>
                <div className="flex gap-1">
                  {[2, 5].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => applyQuickPct("tp", p)}
                      className="text-[9px] px-1 rounded bg-[#E8F5E9] text-[#089981] font-bold"
                    >
                      +{p}%
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="number"
                step="any"
                placeholder="Optional TP"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-2.5 py-1.5 text-[#131722] font-mono text-xs outline-none focus:border-[#089981]"
              />
            </div>
          </div>

          {/* Trailing Stop-Loss (FrontPage Advanced Risk) */}
          <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-3 py-2 space-y-1.5">
            <label className="flex items-center justify-between text-[11px] font-semibold text-[#131722] cursor-pointer">
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-[#2962FF]" />
                Trailing Stop-Loss (TSL)
              </span>
              <input
                type="checkbox"
                checked={trailingEnabled}
                onChange={(e) => {
                  setTrailingEnabled(e.target.checked);
                  if (e.target.checked && !trailingSl && currentPrice > 0) {
                    setTrailingSl((currentPrice * 0.015).toFixed(pxPrec));
                  }
                }}
                className="accent-[#2962FF]"
              />
            </label>
            {trailingEnabled && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="any"
                  min="0.000001"
                  value={trailingSl}
                  onChange={(e) => setTrailingSl(e.target.value)}
                  placeholder="Trail step (pts)"
                  className="flex-1 bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2 py-1 text-xs font-mono text-[#131722] outline-none"
                />
                {[1, 2].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() =>
                      currentPrice > 0 &&
                      setTrailingSl(((currentPrice * pct) / 100).toFixed(pxPrec))
                    }
                    className="text-[10px] px-2 py-1 rounded bg-[#F0F3FA] font-mono font-bold text-[#2962FF]"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Live Country-Specific Taxes & Brokerage Breakdown Card */}
          <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl p-3 space-y-1.5 text-xs">
            <div className="flex justify-between text-[#787B86]">
              <span>Required Margin {leverage > 1 ? `(${leverage}x)` : ""}:</span>
              <span suppressHydrationWarning className="text-[#131722] font-mono font-bold">
                {formatMoney(reqMargin, currency)}
              </span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <button
                type="button"
                onClick={() => setShowBreakdown((v) => !v)}
                className="text-[#2962FF] font-bold flex items-center gap-1 hover:underline"
              >
                <span>Live {chargePreview?.country || country || "Market"} Taxes &amp; Brokerage</span>
                {showBreakdown ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              <span className="font-mono font-bold text-[#131722]">
                {formatMoney(estTotalCharges, currency)}
              </span>
            </div>

            {showBreakdown && chargePreview && (
              <div className="pt-1.5 mt-1 border-t border-[#F0F3FA] space-y-1 text-[10px]">
                {chargePreview.line_items.map((item, idx) => (
                  <div key={`${item.label}-${idx}`} className="flex justify-between text-[#787B86]">
                    <span>
                      {item.label} <span className="opacity-75">({item.rate})</span>
                    </span>
                    <span className="font-mono text-[#131722] font-semibold">
                      {formatMoney(item.amount, currency)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-1 border-t border-[#F0F3FA] text-[#131722] font-bold">
                  <span>Breakeven Move (Round-Trip)</span>
                  <span className="font-mono text-[#2962FF]">
                    ±{formatAssetPrice(chargePreview.breakeven_delta, currency, symbol)} ({chargePreview.effective_rate_pct.toFixed(3)}%)
                  </span>
                </div>
                {chargePreview.tax_notes[0] && (
                  <p className="text-[9px] text-[#787B86] flex items-start gap-1 pt-0.5 leading-snug">
                    <Info className="w-3 h-3 shrink-0 text-[#2962FF] mt-0.5" />
                    <span>{chargePreview.tax_notes[0]}</span>
                  </p>
                )}
              </div>
            )}

            {(rrRatio !== null || estLiqPrice !== null) && (
              <div className="flex items-center justify-between pt-1.5 border-t border-[#F0F3FA] text-[10px] font-mono">
                {rrRatio !== null ? (
                  <span className="text-[#787B86]">
                    Reward : Risk = <strong className={rrRatio >= 1.5 ? "text-[#089981]" : "text-amber-600"}>1 : {rrRatio.toFixed(2)}</strong>
                  </span>
                ) : (
                  <span />
                )}
                {estLiqPrice !== null && (
                  <span className="text-[#F23645]">
                    Est. Liq: <strong>{formatNumber(estLiqPrice, pxPrec, pxPrec)}</strong>
                  </span>
                )}
              </div>
            )}

            <div className="flex justify-between pt-1.5 border-t border-[#E0E3EB] text-[11px] font-bold text-[#131722]">
              <span>Est. Total Cash Impact ({formatQty(quantity)}):</span>
              <span className="font-mono">{formatMoney(totalCashRequired, currency)}</span>
            </div>
          </div>

          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Trade journal tag / setup note (optional)"
            className="w-full bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl px-2.5 py-1.5 text-[11px] text-[#131722] outline-none focus:border-[#2962FF]"
          />

          {/* Pre-Trade Risk Guardrails */}
          {(isConcentrationRisk || isUnhedgedLeverage) && (
            <div className="rounded-xl border border-amber-300 bg-amber-50/90 p-2 text-[10px] text-amber-900 space-y-0.5">
              {isUnhedgedLeverage && (
                <div className="flex items-start gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span>Unhedged Intraday ({leverage}x) order without Stop-Loss increases wipeout risk.</span>
                </div>
              )}
              {isConcentrationRisk && (
                <div className="flex items-start gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span>Concentration alert: uses &gt;25% of remaining cash (capital is non-resettable).</span>
                </div>
              )}
            </div>
          )}

          {/* Simulated L2 Indicative Depth Strip */}
          {simBids.length > 0 && (
            <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl p-2 text-[10px]">
              <div className="flex items-center justify-between text-[#787B86] font-bold mb-1">
                <span className="flex items-center gap-1">
                  <Layers className="w-3 h-3 text-[#2962FF]" /> Indicative Depth (Simulated L2)
                </span>
                <span className="font-mono">Bid / Ask</span>
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono">
                <div className="space-y-0.5">
                  {simBids.map((b, idx) => (
                    <div key={`b-${idx}`} className="flex justify-between text-[#089981] bg-[#E8F5E9]/50 px-1.5 py-0.5 rounded">
                      <span>{b.sz}</span>
                      <span className="font-bold">{formatAssetPrice(b.px, currency, symbol)}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-0.5">
                  {simAsks.map((a, idx) => (
                    <div key={`a-${idx}`} className="flex justify-between text-[#F23645] bg-[#FFEBEE]/50 px-1.5 py-0.5 rounded">
                      <span className="font-bold">{formatAssetPrice(a.px, currency, symbol)}</span>
                      <span>{a.sz}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

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
            className={`w-full py-2.5 rounded-xl font-black text-xs tracking-wide transition flex items-center justify-center gap-2 shadow-sm text-white disabled:opacity-50 disabled:cursor-not-allowed ${
              orderType === "BUY" ? "bg-[#089981] hover:opacity-95" : "bg-[#F23645] hover:opacity-95"
            }`}
          >
            <Zap className="w-4 h-4 fill-current" />
            {currentPrice <= 0
              ? "Waiting for Live Quote..."
              : loading
              ? "Executing..."
              : orderMode === "LADDER"
              ? `PLACE ${ladderRungs}-RUNG ${orderType} LADDER`
              : `PLACE PAPER ${orderType} (${productType})`}
          </button>
        </form>
      </div>

      <div className="mt-3 pt-2.5 border-t border-[#E0E3EB] flex items-center justify-between text-[10px] text-[#787B86]">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-[#089981]" /> Real Country Tax Ledger
        </span>
        <span>FrontPage TradeLab</span>
      </div>
    </div>
  );
}
