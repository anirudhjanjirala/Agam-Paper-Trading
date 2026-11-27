"use client";

import React, { useEffect, useState } from "react";
import { Award, Calculator, Landmark, RefreshCw, ShieldCheck } from "lucide-react";
import { formatAssetPrice, formatMoney, formatNumber, getCurrencySymbol } from "@/lib/format";
import { apiUrl } from "@/lib/api";
import { ChargeBreakdown, COUNTRY_META, CountryAnalytics, CountryTaxSummary } from "@/types/trading";
import CountryFlag from "@/components/CountryFlag";

interface FrontPageTaxCenterProps {
  selectedCountry: string;
  taxSummaryByCountry: Record<string, CountryTaxSummary>;
  analyticsByCountry: Record<string, CountryAnalytics>;
}

const CALC_DEFAULTS: Record<string, { symbol: string; buyPx: string; sellPx: string; qty: string }> = {
  IND: { symbol: "RELIANCE.NS", buyPx: "1400", sellPx: "1450", qty: "50" },
  USA: { symbol: "AAPL", buyPx: "230", sellPx: "242", qty: "25" },
  CANADA: { symbol: "SHOP.TO", buyPx: "140", sellPx: "152", qty: "25" },
  CHINA: { symbol: "600519.SS", buyPx: "1500", sellPx: "1560", qty: "100" },
  EU_UK: { symbol: "SHEL.L", buyPx: "2600", sellPx: "2700", qty: "100" },
  EU_FR: { symbol: "MC.PA", buyPx: "620", sellPx: "645", qty: "10" },
  EU_DE: { symbol: "SAP.DE", buyPx: "220", sellPx: "232", qty: "20" },
};

export default function FrontPageTaxCenter({
  selectedCountry,
  taxSummaryByCountry,
  analyticsByCountry,
}: FrontPageTaxCenterProps) {
  const [activeCountry, setActiveCountry] = useState<string>(selectedCountry === "ALL" ? "IND" : selectedCountry);
  const [calcJurisdiction, setCalcJurisdiction] = useState<string>(selectedCountry === "EU" ? "EU_UK" : selectedCountry === "ALL" ? "IND" : selectedCountry);
  const [calcCategory, setCalcCategory] = useState<"stocks" | "etfs" | "commodities" | "forex" | "bonds">("stocks");
  const [calcProduct, setCalcProduct] = useState<"DELIVERY" | "INTRADAY" | "FUTURES" | "OPTIONS">("DELIVERY");
  const [calcPlan, setCalcPlan] = useState<"DISCOUNT" | "PRO">("DISCOUNT");
  const [buyPx, setBuyPx] = useState<string>(CALC_DEFAULTS[calcJurisdiction]?.buyPx || "1400");
  const [sellPx, setSellPx] = useState<string>(CALC_DEFAULTS[calcJurisdiction]?.sellPx || "1450");
  const [qty, setQty] = useState<string>(CALC_DEFAULTS[calcJurisdiction]?.qty || "50");

  const [buyPreview, setBuyPreview] = useState<ChargeBreakdown | null>(null);
  const [sellPreview, setSellPreview] = useState<ChargeBreakdown | null>(null);
  const [schedules, setSchedules] = useState<{ sync_status: string; last_synced_at: string; countries: Record<string, { name: string; source: string; rules: Record<string, Record<string, string>> }> } | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/charges/schedules"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setSchedules(d);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const def = CALC_DEFAULTS[calcJurisdiction] || CALC_DEFAULTS.IND;
    const bPx = parseFloat(buyPx) || 0;
    const sPx = parseFloat(sellPx) || 0;
    const q = Math.max(1, parseInt(qty, 10) || 1);
    if (bPx <= 0 || sPx <= 0) return;
    const controller = new AbortController();
    Promise.all([
      fetch(apiUrl("/api/charges/preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ symbol: def.symbol, quantity: q, price: bPx, order_type: "BUY", product_type: calcProduct, broker_plan: calcPlan, category: calcCategory }),
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(apiUrl("/api/charges/preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ symbol: def.symbol, quantity: q, price: sPx, order_type: "SELL", product_type: calcProduct, broker_plan: calcPlan, category: calcCategory }),
      }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([b, s]) => {
        if (!controller.signal.aborted) {
          if (b) setBuyPreview(b);
          if (s) setSellPreview(s);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [calcJurisdiction, calcCategory, calcProduct, calcPlan, buyPx, sellPx, qty]);

  const cMeta = COUNTRY_META[activeCountry] || COUNTRY_META.IND;
  const ts = taxSummaryByCountry[activeCountry];
  const an = analyticsByCountry[activeCountry];
  const currSym = getCurrencySymbol(ts?.currency || cMeta.currency);

  const qNum = Math.max(1, parseInt(qty, 10) || 1);
  const grossProfit = ((parseFloat(sellPx) || 0) - (parseFloat(buyPx) || 0)) * qNum;
  const totalRtCharges = (buyPreview?.total_charges || 0) + (sellPreview?.total_charges || 0);
  const netProfit = grossProfit - totalRtCharges;
  const calcCurr = buyPreview?.currency || "INR";

  return (
    <div className="space-y-5">
      {/* Separate Country Tabs */}
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["IND", "USA", "CANADA", "CHINA", "EU"] as const).map((code) => {
            const m = COUNTRY_META[code];
            const active = activeCountry === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => setActiveCountry(code)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                  active
                    ? "bg-[#2962FF] text-white shadow-sm"
                    : "bg-[#F8F9FD] hover:bg-[#F0F3FA] text-[#131722] border border-[#E0E3EB]"
                }`}
              >
                <CountryFlag code={code} />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

        <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-[#E8F5E9] text-[#089981] font-bold flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5" />
          {schedules?.sync_status || "VERIFIED_STATUTORY_2026"}
        </span>
      </div>

      {/* Country Tax & Brokerage Ledger + Analytics Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-[#E0E3EB] pb-3">
            <div className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-[#2962FF]" />
              <div>
                <h3 className="text-sm font-black text-[#131722] flex items-center gap-2">
                  <CountryFlag code={activeCountry} />
                  <span>{cMeta.label} — Statutory Tax &amp; Brokerage Ledger</span>
                </h3>
                <p className="text-[11px] text-[#787B86]">Itemized real-world charges accumulated across {ts?.orders_count ?? 0} executed orders</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            {[
              { label: "Total Turnover", val: ts?.turnover ?? 0 },
              { label: "Brokerage Paid", val: ts?.brokerage ?? 0 },
              { label: activeCountry === "IND" ? "STT Paid" : activeCountry === "EU" ? "UK SDRT / EU FTT" : "Transaction Tax", val: ts?.stt_or_ftt ?? 0 },
              { label: "Stamp Duty", val: ts?.stamp_duty ?? 0 },
              { label: "Exchange Txn Fees", val: ts?.exchange_fee ?? 0 },
              { label: "Regulator (SEBI/SEC/FINRA/CIRO/CSRC)", val: ts?.regulator_fee ?? 0 },
              { label: "GST / VAT", val: ts?.gst_vat ?? 0 },
              { label: "DP / Transfer / CAT Clearing", val: ts?.dp_or_clearing_fee ?? 0 },
            ].map((row) => (
              <div key={row.label} className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-2.5 flex justify-between items-center">
                <span className="text-[11px] text-[#787B86] truncate pr-2">{row.label}</span>
                <span className="font-mono font-bold text-[#131722] shrink-0">{currSym}{formatNumber(row.val, 2)}</span>
              </div>
            ))}
          </div>

          <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3.5 space-y-1.5 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-[#787B86]">Total Brokerage + Statutory Taxes:</span>
              <strong className="text-[#F23645]">{currSym}{formatNumber(ts?.total_charges ?? 0, 2)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-[#787B86]">Gross Realized P&amp;L:</span>
              <strong className={(ts?.gross_realized_pnl ?? 0) >= 0 ? "text-[#089981]" : "text-[#F23645]"}>
                {currSym}{formatNumber(ts?.gross_realized_pnl ?? 0, 2)}
              </strong>
            </div>
            <div className="flex justify-between">
              <span className="text-[#787B86]">Net Realized P&amp;L (After Charges):</span>
              <strong className={(ts?.net_realized_pnl ?? 0) >= 0 ? "text-[#089981]" : "text-[#F23645]"}>
                {currSym}{formatNumber(ts?.net_realized_pnl ?? 0, 2)}
              </strong>
            </div>
            <div className="flex justify-between">
              <span className="text-[#787B86]">Est. Capital Gains / Income Tax:</span>
              <strong className="text-[#131722]">-{currSym}{formatNumber(ts?.est_cap_gains_tax ?? 0, 2)}</strong>
            </div>
            <div className="flex justify-between pt-2 border-t border-[#E0E3EB] text-sm font-black">
              <span className="text-[#131722]">Post-Tax Take-Home P&amp;L:</span>
              <span className={(ts?.net_after_tax_pnl ?? 0) >= 0 ? "text-[#089981]" : "text-[#F23645]"}>
                {currSym}{formatNumber(ts?.net_after_tax_pnl ?? 0, 2)}
              </span>
            </div>
          </div>
        </div>

        {/* FrontPage Performance Analytics */}
        <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-[#E0E3EB] pb-3">
            <Award className="w-5 h-5 text-[#2962FF]" />
            <div>
              <h3 className="text-sm font-black text-[#131722] flex items-center gap-2">
                <CountryFlag code={activeCountry} />
                <span>TradeLab Performance Analytics</span>
              </h3>
              <p className="text-[11px] text-[#787B86]">Win Rate, Profit Factor, Expectancy &amp; Charge Drag</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[#787B86] block text-[10px] uppercase">Win Rate</span>
              <span className="text-xl font-black font-mono text-[#2962FF] mt-1 block">{an?.win_rate_pct ?? 0}%</span>
              <span className="text-[10px] text-[#787B86] font-mono">{an?.wins ?? 0}W / {an?.losses ?? 0}L</span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[#787B86] block text-[10px] uppercase">Profit Factor</span>
              <span className="text-xl font-black font-mono text-[#131722] mt-1 block">{an?.profit_factor ?? 0}</span>
              <span className="text-[10px] text-[#787B86]">Gross Win / Loss</span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[#787B86] block text-[10px] uppercase">Best Trade</span>
              <span className="text-xl font-black font-mono text-[#089981] mt-1 block">+{currSym}{formatNumber(an?.best_trade ?? 0, 2)}</span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[#787B86] block text-[10px] uppercase">Worst Trade</span>
              <span className="text-xl font-black font-mono text-[#F23645] mt-1 block">{currSym}{formatNumber(an?.worst_trade ?? 0, 2)}</span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[#787B86] block text-[10px] uppercase">Avg Win</span>
              <span className="text-base font-black font-mono text-[#089981] mt-1 block">+{currSym}{formatNumber(an?.avg_win ?? 0, 2)}</span>
            </div>
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3">
              <span className="text-[#787B86] block text-[10px] uppercase">Avg Loss</span>
              <span className="text-base font-black font-mono text-[#F23645] mt-1 block">{currSym}{formatNumber(an?.avg_loss ?? 0, 2)}</span>
            </div>
          </div>

          {schedules?.countries?.[activeCountry] && (
            <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3.5 space-y-2 text-[11px]">
              <div className="flex items-center justify-between font-bold text-[#131722]">
                <span>Live Statutory Rules — {schedules.countries[activeCountry].name}</span>
                <RefreshCw className="w-3.5 h-3.5 text-[#089981]" />
              </div>
              <p className="text-[10px] text-[#787B86] font-mono">{schedules.countries[activeCountry].source}</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {Object.entries(schedules.countries[activeCountry].rules).map(([seg, kv]) => (
                  <div key={seg} className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-lg p-2">
                    <strong className="text-[#2962FF] font-mono text-[10px] uppercase block mb-1">{seg}</strong>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                      {Object.entries(kv).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <span className="text-[#787B86] capitalize">{k.replace(/_/g, " ")}:</span>
                          <span className="font-mono text-[#131722] text-right">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live Multi-Country Brokerage & Statutory Tax Calculator */}
      <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E0E3EB] pb-3">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-[#2962FF]" />
            <div>
              <h3 className="text-sm font-black text-[#131722]">Live Country Brokerage &amp; Tax Simulator</h3>
              <p className="text-[11px] text-[#787B86]">Simulate exact Buy + Sell round-trip taxes &amp; breakeven across India, USA, Canada, China &amp; Europe/UK</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2.5 text-xs">
          <div>
            <label className="text-[10px] font-bold text-[#787B86] uppercase block mb-1">Country / Exchange</label>
            <select
              value={calcJurisdiction}
              onChange={(e) => {
                const k = e.target.value;
                setCalcJurisdiction(k);
                const d = CALC_DEFAULTS[k];
                if (d) {
                  setBuyPx(d.buyPx);
                  setSellPx(d.sellPx);
                  setQty(d.qty);
                }
              }}
              className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-2.5 py-2 font-bold text-[#131722]"
            >
              <option value="IND">IND · India (NSE)</option>
              <option value="USA">USA · NASDAQ/CME</option>
              <option value="CANADA">CAN · Canada (TSX)</option>
              <option value="CHINA">CHN · China (SSE)</option>
              <option value="EU_UK">UK · London (LSE)</option>
              <option value="EU_FR">FRA · France (0.4% FTT)</option>
              <option value="EU_DE">DEU · Germany (XETRA)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#787B86] uppercase block mb-1">Asset Class</label>
            <select
              value={calcCategory}
              onChange={(e) => setCalcCategory(e.target.value as "stocks" | "etfs" | "commodities" | "forex" | "bonds")}
              className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-2.5 py-2 font-bold text-[#131722]"
            >
              <option value="stocks">Stocks (Equity)</option>
              <option value="etfs">ETFs</option>
              <option value="commodities">Commodities (MCX/CME)</option>
              <option value="forex">Forex (FX Pairs)</option>
              <option value="bonds">Bonds / G-Sec / Treasury</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#787B86] uppercase block mb-1">Product Segment</label>
            <select
              value={calcProduct}
              onChange={(e) => setCalcProduct(e.target.value as "DELIVERY" | "INTRADAY" | "FUTURES" | "OPTIONS")}
              className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-2.5 py-2 font-bold text-[#131722]"
            >
              <option value="DELIVERY">Delivery (CNC)</option>
              <option value="INTRADAY">Intraday (MIS)</option>
              <option value="FUTURES">Futures (F&amp;O)</option>
              <option value="OPTIONS">Options (F&amp;O)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#787B86] uppercase block mb-1">Broker Plan</label>
            <select
              value={calcPlan}
              onChange={(e) => setCalcPlan(e.target.value as "DISCOUNT" | "PRO")}
              className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-2.5 py-2 font-bold text-[#131722]"
            >
              <option value="DISCOUNT">Discount / Zero</option>
              <option value="PRO">Pro / Full-Service</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#787B86] uppercase block mb-1">Buy Price</label>
            <input type="number" step="any" value={buyPx} onChange={(e) => setBuyPx(e.target.value)} className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-2.5 py-2 font-mono font-bold text-[#131722]" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#787B86] uppercase block mb-1">Sell Price</label>
            <input type="number" step="any" value={sellPx} onChange={(e) => setSellPx(e.target.value)} className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-2.5 py-2 font-mono font-bold text-[#131722]" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#787B86] uppercase block mb-1">Quantity</label>
            <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-2.5 py-2 font-mono font-bold text-[#131722]" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3.5 space-y-1.5">
            <span className="font-bold text-[#089981] block">BUY Leg Charges</span>
            {buyPreview?.line_items.map((l, i) => (
              <div key={i} className="flex justify-between text-[11px]">
                <span className="text-[#787B86]">{l.label}</span>
                <span className="font-mono font-semibold">{formatMoney(l.amount, calcCurr)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-1.5 border-t border-[#E0E3EB] font-bold">
              <span>Buy Total Charges</span>
              <span className="font-mono">{formatMoney(buyPreview?.total_charges ?? 0, calcCurr)}</span>
            </div>
          </div>

          <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3.5 space-y-1.5">
            <span className="font-bold text-[#F23645] block">SELL Leg Charges</span>
            {sellPreview?.line_items.map((l, i) => (
              <div key={i} className="flex justify-between text-[11px]">
                <span className="text-[#787B86]">{l.label}</span>
                <span className="font-mono font-semibold">{formatMoney(l.amount, calcCurr)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-1.5 border-t border-[#E0E3EB] font-bold">
              <span>Sell Total Charges</span>
              <span className="font-mono">{formatMoney(sellPreview?.total_charges ?? 0, calcCurr)}</span>
            </div>
          </div>

          <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-3.5 flex flex-col justify-between space-y-2">
            <div className="space-y-1.5 font-mono">
              <div className="flex justify-between"><span className="text-[#787B86]">Gross P&amp;L</span><strong className={grossProfit >= 0 ? "text-[#089981]" : "text-[#F23645]"}>{formatMoney(grossProfit, calcCurr)}</strong></div>
              <div className="flex justify-between"><span className="text-[#787B86]">Total Round-Trip Taxes &amp; Brok</span><strong className="text-[#F23645]">-{formatMoney(totalRtCharges, calcCurr)}</strong></div>
              <div className="flex justify-between"><span className="text-[#787B86]">Points to Breakeven</span><strong className="text-[#2962FF]">±{formatAssetPrice(buyPreview?.breakeven_delta ?? 0, calcCurr)}</strong></div>
            </div>
            <div className="pt-2 border-t border-[#E0E3EB] flex justify-between items-center text-sm font-black">
              <span>Net P&amp;L</span>
              <span className={`font-mono ${netProfit >= 0 ? "text-[#089981]" : "text-[#F23645]"}`}>
                {formatMoney(netProfit, calcCurr)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
