"use client";

import React, { useState } from "react";
import { Wallet, RotateCcw, Activity } from "lucide-react";
import { formatNumber, getCurrencySymbol } from "@/lib/format";

interface SessionInfo {
  open: boolean;
  local_time: string;
  status: string;
}

interface NavbarProps {
  selectedCountry: string;
  onSelectCountry: (country: string) => void;
  wallets: Record<string, number>;
  activeCurrency: string;
  onSelectCurrency: (currency: string) => void;
  onResetPortfolio: () => void;
  sessions?: Record<string, SessionInfo>;
  universeTotal?: number;
}

export default function Navbar({
  selectedCountry,
  onSelectCountry,
  wallets,
  activeCurrency,
  onSelectCurrency,
  onResetPortfolio,
  sessions,
  universeTotal,
}: NavbarProps) {
  const [resetConfirm, setResetConfirm] = useState(false);

  const regions = [
    { code: "IND", name: "India (NSE/BSE/MCX/G-Sec)", flag: "🇮🇳" },
    { code: "USA", name: "USA (NASDAQ/NYSE/OPRA/UST)", flag: "🇺🇸" },
    { code: "CANADA", name: "Canada (TSX/TSXV/Bonds)", flag: "🇨🇦" },
    { code: "CHINA", name: "China (SSE/SZSE/CGB)", flag: "🇨🇳" },
    { code: "EU", name: "Europe & UK (Euronext/XETRA/LSE)", flag: "🇪🇺" },
    { code: "ALL", name: "Global All Regions", flag: "🌍" },
  ];

  const currentBalance = wallets[activeCurrency] ?? 0;
  const currencySymbol = getCurrencySymbol(activeCurrency);

  const renderSessionBadge = (code: string, label: string) => {
    const info = sessions?.[code];
    const isOpen = info?.open ?? false;
    return (
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? "bg-[#089981] live-pulse" : "bg-[#9598A1]"}`} />
        <span className="text-[#787B86] font-mono">
          {label}:{" "}
          <span className={isOpen ? "text-[#089981] font-bold" : "text-[#787B86]"}>
            {info ? info.status : "..."}
          </span>
        </span>
      </div>
    );
  };

  return (
    <header className="sticky top-0 z-50 bg-[#FFFFFF]/95 backdrop-blur-md border-b border-[#E0E3EB] px-4 lg:px-8 py-3">
      <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#2962FF] flex items-center justify-center shadow-sm">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight text-[#131722]">AGAM</h1>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#2962FF]/10 text-[#2962FF] font-bold uppercase tracking-wider">
                Paper Trading Pro
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#787B86] mt-0.5">
              <span className="w-2 h-2 rounded-full bg-[#089981] live-pulse" />
              <span className="text-[#089981] font-semibold font-mono">
                {universeTotal ? `${formatNumber(universeTotal, 0, 0)} LIVE INSTRUMENTS` : "GLOBAL UNIVERSE"}
              </span>
              <span className="text-[#E0E3EB]">•</span>
              <span className="hidden sm:inline">TradingView Light Workstation</span>
            </div>
          </div>
        </div>

        {/* Live 5-Region Session Clocks */}
        <div className="hidden lg:flex items-center gap-2.5 text-[11px] bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-1.5 shrink-0">
          {renderSessionBadge("IND", "IND")}
          <span className="text-[#E0E3EB]">|</span>
          {renderSessionBadge("USA", "USA")}
          <span className="text-[#E0E3EB]">|</span>
          {renderSessionBadge("CANADA", "CAN")}
          <span className="text-[#E0E3EB]">|</span>
          {renderSessionBadge("CHINA", "CHN")}
          <span className="text-[#E0E3EB]">|</span>
          {renderSessionBadge("EU", "EU")}
        </div>

        {/* Region Selector & Multi-Currency Wallet */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <select
            aria-label="Select Market Region"
            value={selectedCountry}
            onChange={(e) => onSelectCountry(e.target.value)}
            className="bg-[#F8F9FD] hover:bg-[#F0F3FA] border border-[#E0E3EB] text-[#131722] text-xs font-semibold rounded-xl px-3 py-2 cursor-pointer outline-none transition max-w-[230px]"
          >
            {regions.map((c) => (
              <option key={c.code} value={c.code} className="bg-[#FFFFFF] text-[#131722]">
                {c.flag} {c.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3.5 py-1.5">
            <Wallet className="w-4 h-4 text-[#2962FF]" />
            <div>
              <span className="text-[10px] text-[#787B86] block uppercase font-mono font-semibold">Paper Wallet</span>
              <div className="flex items-center gap-1">
                <span suppressHydrationWarning className="text-sm font-extrabold text-[#131722] font-mono">
                  {currencySymbol}{formatNumber(currentBalance, 2)}
                </span>
                <select
                  value={activeCurrency}
                  onChange={(e) => onSelectCurrency(e.target.value)}
                  className="bg-transparent text-[#2962FF] font-bold text-xs cursor-pointer outline-none"
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="CAD">CAD (C$)</option>
                  <option value="CNY">CNY (¥)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
            </div>
          </div>

          {resetConfirm ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  onResetPortfolio();
                  setResetConfirm(false);
                }}
                className="px-2.5 py-1.5 bg-[#F23645] hover:opacity-90 text-white rounded-lg text-xs font-bold transition"
              >
                Confirm
              </button>
              <button
                onClick={() => setResetConfirm(false)}
                className="px-2 py-1.5 bg-[#F0F3FA] text-[#787B86] rounded-lg text-xs transition"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setResetConfirm(true)}
              title="Reset Multi-Currency Virtual Wallets"
              className="p-2 bg-[#F8F9FD] hover:bg-[#F0F3FA] border border-[#E0E3EB] text-[#787B86] hover:text-[#131722] rounded-xl transition"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
