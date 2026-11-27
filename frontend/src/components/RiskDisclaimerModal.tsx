"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, Globe2, Scale, ShieldAlert, X } from "lucide-react";

interface RiskDisclaimerModalProps {
  open: boolean;
  onClose: () => void;
  requireAcknowledge?: boolean;
  onAcknowledge?: () => void;
}

export default function RiskDisclaimerModal({
  open,
  onClose,
  requireAcknowledge = false,
  onAcknowledge,
}: RiskDisclaimerModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col bg-white dark:bg-[#10141c] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-rose-50/70 dark:bg-rose-950/20">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white tracking-tight">
                Institutional Risk Disclosure, Regulatory Notices & Paper-Trading Terms
              </h2>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Mandatory disclosures for simulated global equities, intraday leverage, futures, options & statutory charge models
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-white/80 dark:hover:bg-slate-800"
            aria-label="Close risk disclosures"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/25 p-3.5">
            <div className="flex items-center gap-1.5 font-extrabold text-amber-900 dark:text-amber-300 mb-1">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              1. Educational Simulation & Fixed Non-Resettable Capital Rule
            </div>
            <p>
              Agam Terminal is an <strong>educational paper-trading simulator</strong> executing simulated fills against public quote feeds inside your local PC SQLite vault.
              <strong> No real money, securities, or exchange orders are transmitted or custody-held.</strong> Starting virtual capital per currency is permanently fixed at account creation (
              ₹10,00,000 INR · $100,000 USD · C$100,000 CAD · ¥500,000 CNY · €100,000 EUR · £100,000 GBP) and <strong>wallet resets are strictly disabled</strong> to enforce real drawdown discipline. Progressive warnings trigger below 30%, 15%, and 5% capital thresholds.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50/70 dark:bg-slate-900/40">
              <div className="font-extrabold text-slate-900 dark:text-white mb-1 flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-orange-500" />
                2. India (SEBI / NSE / BSE) Derivatives & Leverage Risk
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Per SEBI empirical studies on individual traders in equity Futures &amp; Options (F&amp;O), approximately 9 out of 10 individual F&amp;O participants incur net trading losses after statutory costs. Simulated Intraday (5x), Futures (5x), and Options trades amplify drawdown speed and incur STT/CTT, Stamp Duty, Exchange Transaction Charges, SEBI Turnover Fee, GST (18%), and DP charges.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50/70 dark:bg-slate-900/40">
              <div className="font-extrabold text-slate-900 dark:text-white mb-1 flex items-center gap-1.5">
                <Globe2 className="w-3.5 h-3.5 text-sky-500" />
                3. USA / Canada / China / Europe &amp; UK Jurisdiction Notes
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                • <strong>USA (SEC/FINRA)</strong>: SEC Section 31 &amp; FINRA TAF models reflect current schedules; real margin accounts are subject to Reg-T &amp; Pattern Day Trader ($25k) rules.<br />
                • <strong>China (SSE/SZSE)</strong>: Stamp duty &amp; transfer fees modeled; real A-shares obey T+1 delivery rules &amp; daily price bands.<br />
                • <strong>EU/UK (ESMA/FCA)</strong>: UK Stamp Duty Reserve Tax (0.5%) &amp; FR/IT/BE FTT models apply; real leveraged CFDs carry high rapid-loss risk.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50/70 dark:bg-slate-900/40 space-y-1.5">
            <div className="font-extrabold text-slate-900 dark:text-white">
              4. Market Data, Liquidity, Slippage &amp; Tax Calculation Disclaimer
            </div>
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
              <li>
                <strong>No Financial, Investment, or Tax Advice:</strong> Nothing displayed (charts, RSI/MACD indicators, AI ideas, order-flow ladder, or statutory fee estimates) constitutes personalized investment, legal, or tax advice.
              </li>
              <li>
                <strong>Execution &amp; Data Latency Warning:</strong> Public quotes may be delayed or temporarily unavailable across global timezones. Simulated Level-2 Bid/Ask depth is an algorithmic visualization derived from last trade spread — it does not guarantee real market liquidity, fill prices, or zero slippage.
              </li>
              <li>
                <strong>Capital Gains &amp; Tax Disclaimer:</strong> Statutory charge schedules and capital gains tax estimates are best-effort educational approximations and may omit investor-specific surcharges, slab rates, wash-sale/superficial-loss disallowances, or broker clearing minimums. Always consult a licensed broker and tax advisor before live trading.
              </li>
              <li>
                <strong>Local PC Single-Owner Storage:</strong> All accounts, trades, audit logs, chart drawings, watchlists, and alerts are stored locally on your machine in SQLite. Keep backups of your local database if preserving long-term history across OS reinstalls.
              </li>
            </ul>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0d1118] flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            By using this terminal, you accept sole responsibility for evaluating simulation results and risks.
          </span>
          <div className="flex items-center gap-2">
            {requireAcknowledge && onAcknowledge ? (
              <button
                type="button"
                onClick={() => {
                  onAcknowledge();
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                I Understand &amp; Accept Risk Disclosures
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-bold hover:opacity-90"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
