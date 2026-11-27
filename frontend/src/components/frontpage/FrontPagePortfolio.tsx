"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  Edit3,
  Lock,
  Share2,
  Shield,
  ShieldCheck,
  TrendingUp,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { formatAssetPrice, formatNumber, getCurrencySymbol } from "@/lib/format";
import CountryFlag from "@/components/CountryFlag";
import {
  CapitalHealthEntry,
  ClosedTradeItem,
  COUNTRY_META,
  CountryAnalytics,
  CountryTaxSummary,
  Position,
  WalletDetail,
} from "@/types/trading";

interface FrontPagePortfolioProps {
  selectedCountry: string;
  onSelectCountry: (country: string) => void;
  wallets: Record<string, number>;
  walletDetails?: Record<string, WalletDetail>;
  capitalHealth?: Record<string, CapitalHealthEntry>;
  positions: Position[];
  closedTrades: ClosedTradeItem[];
  taxSummaryByCountry: Record<string, CountryTaxSummary>;
  analyticsByCountry: Record<string, CountryAnalytics>;
  onClosePosition: (symbol: string, quantity: number, orderType: string, productType?: string) => Promise<void>;
  onSquareOffAll: (country?: string) => Promise<void>;
  onUpdateRisk: (positionId: string, sl: number | null, tp: number | null, tsl: number | null) => Promise<void>;
  onOpenSymbol: (symbol: string) => void;
  onShareIdea?: (pos: Position) => void;
}

export default function FrontPagePortfolio({
  selectedCountry,
  onSelectCountry,
  wallets,
  walletDetails,
  capitalHealth,
  positions,
  closedTrades,
  taxSummaryByCountry,
  analyticsByCountry,
  onClosePosition,
  onSquareOffAll,
  onUpdateRisk,
  onOpenSymbol,
  onShareIdea,
}: FrontPagePortfolioProps) {
  const [countryFilter, setCountryFilter] = useState<string>(selectedCountry === "ALL" ? "IND" : selectedCountry);
  const [subTab, setSubTab] = useState<"open" | "holdings" | "intraday" | "closed">("open");
  const [editingPos, setEditingPos] = useState<Position | null>(null);
  const [slInput, setSlInput] = useState<string>("");
  const [tpInput, setTpInput] = useState<string>("");
  const [tslInput, setTslInput] = useState<string>("");
  const [savingRisk, setSavingRisk] = useState<boolean>(false);
  const [confirmExitAll, setConfirmExitAll] = useState<boolean>(false);

  const cMeta = COUNTRY_META[countryFilter] || COUNTRY_META.IND;
  const activeCurr = cMeta.currency;
  const currSym = getCurrencySymbol(activeCurr);
  const isAll = countryFilter === "ALL";

  const filteredPositions = positions.filter((p) => (isAll ? true : (p.country || "USA") === countryFilter));
  const displayPositions =
    subTab === "holdings"
      ? filteredPositions.filter((p) => (p.product_type || "DELIVERY") === "DELIVERY")
      : subTab === "intraday"
      ? filteredPositions.filter((p) => (p.product_type || "DELIVERY") !== "DELIVERY")
      : filteredPositions;

  const filteredClosed = closedTrades.filter((c) => (isAll ? true : c.country === countryFilter));

  // Country-specific wallet metrics
  const scaleToActiveCurr = (posCurr: string) => (activeCurr === "EUR" && posCurr === "GBp" ? 0.0115 : activeCurr === "GBP" && posCurr === "GBp" ? 0.01 : 1);
  const walletBal = wallets[activeCurr] ?? 0;
  const wDetail = walletDetails?.[activeCurr];
  const marginBlocked = filteredPositions.reduce((s, p) => {
    const mb = p.margin_blocked ?? (p.avg_price * p.quantity) / (p.leverage || 1);
    return s + mb * scaleToActiveCurr(p.currency);
  }, 0);
  const totalUnrealizedGross = filteredPositions.reduce(
    (s, p) => s + (p.pnl || 0) * scaleToActiveCurr(p.currency),
    0
  );
  const totalUnrealizedNet = filteredPositions.reduce(
    (s, p) => s + (p.net_pnl ?? p.pnl ?? 0) * scaleToActiveCurr(p.currency),
    0
  );
  const equityVal = (wDetail ? wDetail.equity : walletBal + marginBlocked + totalUnrealizedGross);

  const taxSummary = taxSummaryByCountry[countryFilter];
  const analytics = analyticsByCountry[countryFilter];

  const openRiskEditor = (p: Position) => {
    setEditingPos(p);
    setSlInput(p.stop_loss ? String(p.stop_loss) : "");
    setTpInput(p.take_profit ? String(p.take_profit) : "");
    setTslInput(p.trailing_sl ? String(p.trailing_sl) : "");
  };

  const handleSaveRisk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPos) return;
    setSavingRisk(true);
    try {
      await onUpdateRisk(
        editingPos.id,
        slInput ? parseFloat(slInput) : null,
        tpInput ? parseFloat(tpInput) : null,
        tslInput ? parseFloat(tslInput) : null
      );
      setEditingPos(null);
    } finally {
      setSavingRisk(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Country Jurisdiction Bar */}
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["IND", "USA", "CANADA", "CHINA", "EU"] as const).map((code) => {
            const m = COUNTRY_META[code];
            const cnt = positions.filter((p) => (p.country || "USA") === code).length;
            const active = countryFilter === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => {
                  setCountryFilter(code);
                  onSelectCountry(code);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                  active
                    ? "bg-[#2962FF] text-white shadow-sm"
                    : "bg-[#F8F9FD] hover:bg-[#F0F3FA] text-[#131722] border border-[#E0E3EB]"
                }`}
              >
                <span><CountryFlag code={code} /></span>
                <span>{m.short}</span>
                <span className={`text-[10px] font-mono px-1.5 rounded-full ${active ? "bg-white/20 text-white" : "bg-[#E0E3EB] text-[#787B86]"}`}>
                  {cnt}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCountryFilter("ALL")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              countryFilter === "ALL"
                ? "bg-[#131722] text-white"
                : "bg-[#F8F9FD] hover:bg-[#F0F3FA] text-[#787B86] border border-[#E0E3EB]"
            }`}
          >
            🌍 Global ({positions.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {confirmExitAll ? (
            <div className="flex items-center gap-1">
              {filteredPositions.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      await onSquareOffAll(isAll ? undefined : countryFilter);
                      setConfirmExitAll(false);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-[#F23645] text-white text-xs font-bold"
                  >
                    Confirm Exit All
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmExitAll(false)}
                    className="px-2 py-1.5 rounded-lg bg-[#F0F3FA] text-[#787B86] text-xs font-bold"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          ) : (
            filteredPositions.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmExitAll(true)}
                className="px-3 py-1.5 rounded-xl bg-[#FFEBEE] hover:bg-[#F23645] text-[#F23645] hover:text-white text-xs font-bold transition flex items-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5" /> Square Off All
              </button>
            )
          )}
          <span
            title="Fixed starting capital per country — wallet resets are permanently disabled"
            className="px-3 py-1.5 rounded-xl bg-[#E8F5E9] border border-[#089981]/30 text-[#089981] text-xs font-bold flex items-center gap-1.5"
          >
            <Lock className="w-3.5 h-3.5" /> Fixed Capital (No Reset)
          </span>
        </div>
      </div>

      {/* Progressive Capital Depletion Alert Banner */}
      {!isAll && capitalHealth?.[activeCurr] && capitalHealth[activeCurr].status !== "HEALTHY" && (
        <div
          className={`rounded-2xl p-3.5 border flex items-start gap-2.5 text-xs ${
            capitalHealth[activeCurr].status === "EXHAUSTED" || capitalHealth[activeCurr].status === "CRITICAL"
              ? "bg-[#FFEBEE] border-[#F23645]/40 text-[#B71C1C]"
              : "bg-amber-50 border-amber-300 text-amber-900"
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-black uppercase tracking-wide text-[11px]">
              Capital Health: {capitalHealth[activeCurr].status} ({capitalHealth[activeCurr].equity_pct.toFixed(1)}% Equity Remaining)
            </div>
            <p className="mt-0.5 font-medium">{capitalHealth[activeCurr].warning_message}</p>
          </div>
        </div>
      )}

      {/* FrontPage Portfolio Hero Summary Card */}
      {!isAll ? (
        <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-[#E0E3EB]">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[#2962FF]/10 text-[#2962FF] flex items-center justify-center">
                <CountryFlag code={countryFilter} className="w-6 h-4" />
              </div>
              <div>
                <h2 className="text-base font-black text-[#131722]">
                  {cMeta.label} Paper Portfolio
                </h2>
                <p className="text-xs text-[#787B86]">
                  FrontPage TradeLab · Isolated {activeCurr} Wallet &amp; Country Tax Ledger
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="px-3 py-1.5 rounded-xl bg-[#F8F9FD] border border-[#E0E3EB]">
                <span className="text-[#787B86] mr-1.5">Win Rate:</span>
                <strong className="font-mono text-[#131722]">{analytics?.win_rate_pct ?? 0}%</strong>
              </div>
              <div className="px-3 py-1.5 rounded-xl bg-[#F8F9FD] border border-[#E0E3EB]">
                <span className="text-[#787B86] mr-1.5">Closed Trades:</span>
                <strong className="font-mono text-[#131722]">{analytics?.closed_count ?? 0}</strong>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[10px] uppercase font-mono text-[#787B86] flex items-center gap-1">
                <Wallet className="w-3 h-3 text-[#2962FF]" /> Available Cash
              </span>
              <span className="text-base font-black font-mono text-[#131722] mt-1 block">
                {currSym}{formatNumber(walletBal, 2)}
              </span>
            </div>

            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[10px] uppercase font-mono text-[#787B86]">Invested / Margin</span>
              <span className="text-base font-black font-mono text-[#131722] mt-1 block">
                {currSym}{formatNumber(marginBlocked, 2)}
              </span>
            </div>

            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[10px] uppercase font-mono text-[#787B86]">Total Equity</span>
              <span className="text-base font-black font-mono text-[#2962FF] mt-1 block">
                {currSym}{formatNumber(equityVal, 2)}
              </span>
            </div>

            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[10px] uppercase font-mono text-[#787B86]">Open P&amp;L (Net)</span>
              <span className={`text-base font-black font-mono mt-1 block ${totalUnrealizedNet >= 0 ? "text-[#089981]" : "text-[#F23645]"}`}>
                {totalUnrealizedNet >= 0 ? "+" : "-"}{currSym}{formatNumber(Math.abs(totalUnrealizedNet), 2)}
              </span>
            </div>

            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[10px] uppercase font-mono text-[#787B86]">Realized P&amp;L (Net)</span>
              <span className={`text-base font-black font-mono mt-1 block ${(taxSummary?.net_realized_pnl ?? 0) >= 0 ? "text-[#089981]" : "text-[#F23645]"}`}>
                {(taxSummary?.net_realized_pnl ?? 0) >= 0 ? "+" : "-"}{currSym}{formatNumber(Math.abs(taxSummary?.net_realized_pnl ?? 0), 2)}
              </span>
            </div>

            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[10px] uppercase font-mono text-[#787B86]">Taxes &amp; Brokerage</span>
              <span className="text-base font-black font-mono text-[#F23645] mt-1 block">
                {currSym}{formatNumber(taxSummary?.total_charges ?? 0, 2)}
              </span>
            </div>
          </div>

          {capitalHealth?.[activeCurr] && (
            <div className="mt-4 pt-3.5 border-t border-[#E0E3EB] space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-bold text-[#131722] flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#089981]" />
                  Fixed Capital Health ({activeCurr}):{" "}
                  <span className="font-mono">
                    {currSym}{formatNumber(capitalHealth[activeCurr].equity, 2)} / {currSym}{formatNumber(capitalHealth[activeCurr].starting_capital, 0)}
                  </span>
                </span>
                <span className="font-mono text-[#787B86]">
                  Free Cash: <strong>{capitalHealth[activeCurr].cash_pct.toFixed(1)}%</strong> · Margin Used:{" "}
                  <strong>{equityVal > 0 ? ((marginBlocked / equityVal) * 100).toFixed(1) : "0.0"}%</strong>
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#F0F3FA] overflow-hidden flex">
                <div
                  className={`h-full transition-all ${
                    capitalHealth[activeCurr].status === "EXHAUSTED" || capitalHealth[activeCurr].status === "CRITICAL"
                      ? "bg-[#F23645]"
                      : capitalHealth[activeCurr].status === "WARNING"
                      ? "bg-amber-500"
                      : "bg-[#089981]"
                  }`}
                  style={{ width: `${Math.max(2, Math.min(100, capitalHealth[activeCurr].equity_pct))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {(["IND", "USA", "CANADA", "CHINA", "EU"] as const).map((code) => {
            const m = COUNTRY_META[code];
            const sym = getCurrencySymbol(m.currency);
            const bal = wallets[m.currency] ?? 0;
            const ch = capitalHealth?.[m.currency];
            const ts = taxSummaryByCountry[code];
            const posCnt = positions.filter((p) => (p.country || "USA") === code).length;
            return (
              <button
                key={code}
                type="button"
                onClick={() => setCountryFilter(code)}
                className="bg-[#FFFFFF] border border-[#E0E3EB] hover:border-[#2962FF] rounded-2xl p-4 text-left transition shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-black text-[#131722] inline-flex items-center gap-1.5">
                    <CountryFlag code={code} /> {m.short}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#F0F3FA] text-[#2962FF] font-bold">
                    {posCnt} Open
                  </span>
                </div>
                <div className="text-lg font-black font-mono text-[#131722]">{sym}{formatNumber(bal, 0)}</div>
                {ch && (
                  <div className="mt-1.5">
                    <div className="w-full h-1.5 rounded-full bg-[#F0F3FA] overflow-hidden">
                      <div
                        className={`h-full ${
                          ch.status === "CRITICAL" || ch.status === "EXHAUSTED"
                            ? "bg-[#F23645]"
                            : ch.status === "WARNING"
                            ? "bg-amber-500"
                            : "bg-[#089981]"
                        }`}
                        style={{ width: `${Math.max(3, Math.min(100, ch.equity_pct))}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="mt-2 pt-2 border-t border-[#F0F3FA] flex justify-between text-[11px] font-mono">
                  <span className="text-[#787B86]">Net P&amp;L</span>
                  <span className={(ts?.net_realized_pnl ?? 0) >= 0 ? "text-[#089981] font-bold" : "text-[#F23645] font-bold"}>
                    {(ts?.net_realized_pnl ?? 0) >= 0 ? "+" : ""}{sym}{formatNumber(ts?.net_realized_pnl ?? 0, 2)}
                  </span>
                </div>
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-[#787B86]">Taxes Paid</span>
                  <span className="text-[#F23645]">{sym}{formatNumber(ts?.total_charges ?? 0, 2)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Open / Holdings / Intraday / Closed Sub-Tabs */}
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E0E3EB] pb-3">
          <div className="flex flex-wrap items-center gap-1.5 bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-1 text-xs font-bold">
            {[
              { id: "open" as const, label: `All Open Positions (${filteredPositions.length})` },
              { id: "holdings" as const, label: `Delivery / Holdings (${filteredPositions.filter((p) => (p.product_type || "DELIVERY") === "DELIVERY").length})` },
              { id: "intraday" as const, label: `Intraday / F&O (${filteredPositions.filter((p) => (p.product_type || "DELIVERY") !== "DELIVERY").length})` },
              { id: "closed" as const, label: `Closed Trades (${filteredClosed.length})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                className={`px-3 py-1.5 rounded-lg transition ${
                  subTab === t.id ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {subTab !== "closed" ? (
          displayPositions.length === 0 ? (
            <div className="py-12 text-center">
              <Briefcase className="w-8 h-8 text-[#787B86] mx-auto mb-2" />
              <p className="text-sm font-bold text-[#131722]">No positions in this view</p>
              <p className="text-xs text-[#787B86] mt-1">
                Switch to the Trade tab to place paper Delivery or Intraday orders with live taxes.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {displayPositions.map((pos) => {
                const gross = pos.pnl || 0;
                const net = pos.net_pnl ?? gross;
                const isBull = net >= 0;
                const psym = getCurrencySymbol(pos.currency);
                const isShort = pos.order_type === "SHORT";

                return (
                  <div
                    key={pos.id}
                    className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <CountryFlag code={pos.country || "USA"} />
                          <button
                            type="button"
                            onClick={() => onOpenSymbol(pos.symbol)}
                            className="text-sm font-black text-[#131722] hover:text-[#2962FF] transition"
                          >
                            {pos.symbol}
                          </button>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              !isShort ? "bg-[#E8F5E9] text-[#089981]" : "bg-[#FFEBEE] text-[#F23645]"
                            }`}
                          >
                            {isShort ? "SHORT" : "LONG"}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[#FFFFFF] border border-[#E0E3EB] text-[10px] font-mono font-bold text-[#2962FF]">
                            {pos.product_type || "DELIVERY"} {(pos.leverage || 1) > 1 ? `(${pos.leverage}x)` : ""}
                          </span>
                        </div>
                        <p className="text-xs text-[#787B86] mt-0.5">{pos.name}</p>
                      </div>

                      <div className="text-right">
                        <div className={`text-base font-black font-mono flex items-center justify-end gap-0.5 ${isBull ? "text-[#089981]" : "text-[#F23645]"}`}>
                          {isBull ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                          {isBull ? "+" : "-"}{psym}{formatNumber(Math.abs(net), 2)}
                        </div>
                        <span className="text-[11px] font-mono text-[#787B86]">
                          Gross {gross >= 0 ? "+" : ""}{psym}{formatNumber(gross, 2)} ({(pos.pnl_percent ?? 0).toFixed(2)}%)
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-[11px] bg-[#FFFFFF] border border-[#E0E3EB] rounded-lg p-2.5 font-mono">
                      <div>
                        <span className="text-[#787B86] block text-[10px]">Qty</span>
                        <strong className="text-[#131722]">{pos.quantity}</strong>
                      </div>
                      <div>
                        <span className="text-[#787B86] block text-[10px]">Avg Price</span>
                        <strong className="text-[#131722]">{formatAssetPrice(pos.avg_price, pos.currency)}</strong>
                      </div>
                      <div>
                        <span className="text-[#787B86] block text-[10px]">Live LTP</span>
                        <strong className="text-[#131722]">{formatAssetPrice(pos.current_price, pos.currency)}</strong>
                      </div>
                      <div>
                        <span className="text-[#787B86] block text-[10px]">Est. Total Fees</span>
                        <strong className="text-[#F23645]">
                          {psym}{formatNumber((pos.entry_charges || 0) + (pos.est_exit_charges || 0), 2)}
                        </strong>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                        <span className="px-2 py-0.5 rounded bg-[#FFFFFF] border border-[#E0E3EB] text-[#787B86]">
                          SL: <strong className="text-[#F23645]">{pos.stop_loss ? formatAssetPrice(pos.stop_loss, pos.currency) : "None"}</strong>
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#FFFFFF] border border-[#E0E3EB] text-[#787B86]">
                          Target: <strong className="text-[#089981]">{pos.take_profit ? formatAssetPrice(pos.take_profit, pos.currency) : "None"}</strong>
                        </span>
                        {pos.trailing_sl && (
                          <span className="px-2 py-0.5 rounded bg-[#2962FF]/10 text-[#2962FF] font-bold flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" /> TSL: {formatNumber(pos.trailing_sl, 2)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openRiskEditor(pos)}
                          className="px-2.5 py-1 rounded-lg bg-[#FFFFFF] border border-[#E0E3EB] hover:border-[#2962FF] text-[#131722] text-[11px] font-bold flex items-center gap-1 transition"
                        >
                          <Edit3 className="w-3 h-3 text-[#2962FF]" /> Edit SL/TP
                        </button>
                        {onShareIdea && (
                          <button
                            type="button"
                            onClick={() => onShareIdea(pos)}
                            className="px-2.5 py-1 rounded-lg bg-[#FFFFFF] border border-[#E0E3EB] hover:border-[#2962FF] text-[#2962FF] text-[11px] font-bold flex items-center gap-1 transition"
                            title="Post trade idea to FrontPage Feed"
                          >
                            <Share2 className="w-3 h-3" /> Post
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onClosePosition(pos.symbol, pos.quantity, pos.order_type, pos.product_type)}
                          className="px-3 py-1 rounded-lg bg-[#F23645] hover:opacity-90 text-white text-[11px] font-bold transition"
                        >
                          {isShort ? "Cover" : "Exit"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : filteredClosed.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#787B86]">
            No closed trades recorded for this selection yet. Exit a position to see exact Net P&amp;L &amp; Tax Breakdown.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#F8F9FD] border-b border-[#E0E3EB] text-[#787B86] uppercase font-mono text-[10px]">
                  <th className="py-2.5 px-3">Closed</th>
                  <th className="py-2.5 px-3">Asset</th>
                  <th className="py-2.5 px-3">Side / Prod</th>
                  <th className="py-2.5 px-3 text-right">Qty</th>
                  <th className="py-2.5 px-3 text-right">Entry → Exit</th>
                  <th className="py-2.5 px-3 text-right">Gross P&amp;L</th>
                  <th className="py-2.5 px-3 text-right">Charges (Entry+Exit)</th>
                  <th className="py-2.5 px-3 text-right">Net P&amp;L</th>
                  <th className="py-2.5 px-3 text-right">Est. Cap Gains Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E0E3EB]">
                {filteredClosed.map((ct) => {
                  const bull = ct.net_pnl >= 0;
                  const sym = getCurrencySymbol(ct.currency);
                  return (
                    <tr key={ct.id} className="hover:bg-[#F8F9FD]">
                      <td className="py-2.5 px-3 font-mono text-[#787B86]">{ct.closed_time}</td>
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-[#131722] inline-flex items-center gap-1.5">
                          <CountryFlag code={ct.country} /> {ct.symbol}
                        </span>
                        {ct.journal_note && <span className="block text-[10px] text-[#787B86]">{ct.journal_note}</span>}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#2962FF]">{ct.side} · {ct.product_type}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{ct.quantity}</td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {formatAssetPrice(ct.entry_price, ct.currency)} → {formatAssetPrice(ct.exit_price, ct.currency)}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-mono font-bold ${ct.gross_pnl >= 0 ? "text-[#089981]" : "text-[#F23645]"}`}>
                        {ct.gross_pnl >= 0 ? "+" : ""}{sym}{formatNumber(ct.gross_pnl, 2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[#F23645]">
                        -{sym}{formatNumber(ct.total_charges, 2)}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-mono font-black ${bull ? "text-[#089981]" : "text-[#F23645]"}`}>
                        {bull ? "+" : "-"}{sym}{formatNumber(Math.abs(ct.net_pnl), 2)} ({ct.pnl_percent.toFixed(2)}%)
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[#787B86]">
                        {sym}{formatNumber(ct.est_tax, 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit SL / Target / Trailing SL Modal */}
      {editingPos && (
        <div className="fixed inset-0 z-[95] bg-[#131722]/45 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => setEditingPos(null)}>
          <form
            onSubmit={handleSaveRisk}
            onClick={(e) => e.stopPropagation()}
            className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#E0E3EB] pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#2962FF]" />
                <div>
                  <h3 className="text-sm font-black text-[#131722]">Modify Risk — {editingPos.symbol}</h3>
                  <p className="text-[11px] text-[#787B86]">
                    LTP: {formatAssetPrice(editingPos.current_price, editingPos.currency)} · Entry: {formatAssetPrice(editingPos.avg_price, editingPos.currency)}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setEditingPos(null)} className="p-1 rounded-lg text-[#787B86] hover:bg-[#F0F3FA]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-semibold text-[#787B86] block mb-1">Stop Loss (SL)</label>
                <input
                  type="number"
                  step="any"
                  value={slInput}
                  onChange={(e) => setSlInput(e.target.value)}
                  placeholder="Clear if empty"
                  className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 font-mono font-bold text-[#131722]"
                />
              </div>
              <div>
                <label className="font-semibold text-[#787B86] block mb-1">Target Price (TP)</label>
                <input
                  type="number"
                  step="any"
                  value={tpInput}
                  onChange={(e) => setTpInput(e.target.value)}
                  placeholder="Clear if empty"
                  className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 font-mono font-bold text-[#131722]"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="font-semibold text-[#787B86] block mb-1">Trailing Stop-Loss Step (Price Points)</label>
              <input
                type="number"
                step="any"
                min="0"
                value={tslInput}
                onChange={(e) => setTslInput(e.target.value)}
                placeholder="e.g. 15.0 (leave blank to disable)"
                className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 font-mono font-bold text-[#131722]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingPos(null)}
                className="px-4 py-2 rounded-xl bg-[#F0F3FA] text-[#787B86] text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingRisk}
                className="px-4 py-2 rounded-xl bg-[#2962FF] text-white text-xs font-bold flex items-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> {savingRisk ? "Saving..." : "Update SL / Target"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
