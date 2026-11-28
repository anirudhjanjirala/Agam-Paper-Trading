"use client";

import React, { useEffect, useState } from "react";
import {
  ListFilter,
  Zap,
  Newspaper,
  Bell,
  Layers,
  Building2,
  Search,
  ChevronRight,
  ExternalLink,
  Rocket,
  Calendar,
  Star,
} from "lucide-react";
import OrderDrawer from "@/components/OrderDrawer";
import CompanyNewsStream, { NewsArticle } from "@/components/CompanyNewsStream";
import OrderFlowSuite from "@/components/OrderFlowSuite";
import AlertManager from "@/components/AlertManager";
import { formatAssetPrice, formatCompactCurrency, formatNumber, getPricePrecision } from "@/lib/format";
import { apiUrl } from "@/lib/api";
import { CapitalHealthEntry, OrderDraftPreset } from "@/types/trading";

export interface WatchlistAsset {
  symbol: string;
  name: string;
  region?: string;
  country?: string;
  category: string;
  currency: string;
  exchange: string;
  isin?: string;
  price: number;
  prev_close: number;
  change: number;
  change_percent: number;
  volume: number;
  bid?: number;
  ask?: number;
  as_of?: string;
}

export type RightPanelTab = "watchlist" | "order" | "news" | "alerts" | "orderflow" | null;

interface QuickDetails {
  symbol: string;
  market_cap?: number;
  trailing_pe?: number;
  week_52_high?: number;
  week_52_low?: number;
  sector?: string;
  volume?: number;
}

interface TechnicalSummary {
  symbol: string;
  rating: string;
  buy: number;
  sell: number;
  neutral: number;
  volatility_pct: number;
  pivots?: {
    classic?: { P: number; R1: number; S1: number };
  };
  mtf?: Record<string, { rating: string; score: number }>;
}

interface RightSidebarProps {
  activeTab: RightPanelTab;
  onSelectTab: (tab: RightPanelTab) => void;
  selectedCountry: string;
  onSelectCountry: (region: string) => void;
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  assets: WatchlistAsset[];
  selectedAsset: WatchlistAsset | null;
  onSelectSymbol: (symbol: string, name?: string) => void;
  onQuickTradeFromWatchlist?: (asset: WatchlistAsset, side: "BUY" | "SELL") => void;
  onOpenSearch: () => void;
  wallets: Record<string, number>;
  capitalHealth?: Record<string, CapitalHealthEntry>;
  orderPreset?: OrderDraftPreset | null;
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
  latestNewsAlert: NewsArticle | null;
  isMarketOpen?: boolean;
  onOpenOverview: () => void;
  onOpenIpos: () => void;
  onOpenMacro: () => void;
}

const COMPACT_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "stocks", label: "Eq" },
  { id: "etfs", label: "ETF" },
  { id: "indices", label: "Idx" },
  { id: "commodities", label: "Fut" },
  { id: "crypto", label: "Crypto" },
  { id: "forex", label: "FX" },
  { id: "bonds", label: "Bnd" },
];

const CRYPTO_TIERS = [
  { id: "ALL", label: "All Coins" },
  { id: "CRYPTO_MAJOR", label: "Majors" },
  { id: "CRYPTO_L1", label: "L1/L2" },
  { id: "CRYPTO_DEFI", label: "DeFi" },
  { id: "CRYPTO_MEME", label: "Meme" },
];

const FOREX_TIERS = [
  { id: "ALL", label: "All FX" },
  { id: "FX_MAJOR", label: "Majors" },
  { id: "FX_MINOR", label: "Minors" },
  { id: "FX_EXOTIC", label: "Exotics" },
];

export default function RightSidebar({
  activeTab,
  onSelectTab,
  selectedCountry,
  onSelectCountry,
  selectedCategory,
  onSelectCategory,
  assets,
  selectedAsset,
  onSelectSymbol,
  onQuickTradeFromWatchlist,
  onOpenSearch,
  wallets,
  capitalHealth,
  orderPreset,
  onExecuteOrder,
  onPlaceLadder,
  latestNewsAlert,
  isMarketOpen,
  onOpenOverview,
  onOpenIpos,
  onOpenMacro,
}: RightSidebarProps) {
  const [details, setDetails] = useState<QuickDetails | null>(null);
  const [technicals, setTechnicals] = useState<TechnicalSummary | null>(null);
  const [quickFilter, setQuickFilter] = useState<string>("");
  const [subTier, setSubTier] = useState<string>("ALL");
  const [onlyFavorites, setOnlyFavorites] = useState<boolean>(false);
  const [favorites, setFavorites] = useState<string[]>(["BTC-USD", "ETH-USD", "EURUSD=X", "RELIANCE.NS", "AAPL"]);
  const activeDetails = details?.symbol === selectedAsset?.symbol ? details : null;
  const activeTechnicals = technicals?.symbol === selectedAsset?.symbol ? technicals : null;

  const isCryptoView = selectedCountry === "CRYPTO" || selectedCategory === "crypto";
  const isForexView = selectedCountry === "FOREX" || selectedCategory === "forex";

  const toggleFav = (sym: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => (prev.includes(sym) ? prev.filter((x) => x !== sym) : [sym, ...prev]));
  };

  const displayedAssets = assets.filter((a) => {
    if (onlyFavorites && !favorites.includes(a.symbol)) return false;
    if (subTier !== "ALL") {
      if ((isCryptoView || isForexView) && (a.isin || "").toUpperCase() !== subTier) return false;
    }
    if (quickFilter.trim()) {
      const qf = quickFilter.trim().toUpperCase();
      return a.symbol.toUpperCase().includes(qf) || a.name.toUpperCase().includes(qf);
    }
    return true;
  });

  useEffect(() => {
    if (!selectedAsset?.symbol || activeTab !== "watchlist") return;
    const targetSym = selectedAsset.symbol;
    const controller = new AbortController();
    fetch(apiUrl(`/api/asset/${encodeURIComponent(targetSym)}/overview`), {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!controller.signal.aborted && d) {
          setDetails({
            symbol: targetSym,
            market_cap: d.market_cap,
            trailing_pe: d.trailing_pe,
            week_52_high: d.week_52_high,
            week_52_low: d.week_52_low,
            sector: d.sector,
            volume: d.volume,
          });
        }
      })
      .catch(() => {});
    fetch(apiUrl(`/api/asset/${encodeURIComponent(targetSym)}/technicals?interval=1d&period=6mo`), {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => {
        if (!controller.signal.aborted && t) setTechnicals(t);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [selectedAsset?.symbol, activeTab]);

  const toggleTab = (tab: Exclude<RightPanelTab, null>) => {
    onSelectTab(activeTab === tab ? null : tab);
  };

  const railButtons: Array<{
    id: Exclude<RightPanelTab, null>;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: boolean;
  }> = [
    { id: "watchlist", label: "Watchlist & Details", icon: ListFilter },
    { id: "order", label: "FrontPage Order Ticket", icon: Zap },
    {
      id: "news",
      label: "Live News",
      icon: Newspaper,
      badge: Boolean(latestNewsAlert && selectedAsset && latestNewsAlert.symbol === selectedAsset.symbol),
    },
    { id: "alerts", label: "Alerts", icon: Bell },
    { id: "orderflow", label: "Order Flow", icon: Layers },
  ];

  const resolveOrderWalletBalance = (asset: WatchlistAsset): number => {
    if (wallets[asset.currency] !== undefined) return wallets[asset.currency];
    if (asset.currency === "GBp" && wallets["GBP"] !== undefined) return wallets["GBP"] * 100;
    return wallets["USD"] ?? 0;
  };

  return (
    <div className="flex h-full shrink-0">
      {activeTab !== null && (
        <aside className="fixed right-[44px] top-[74px] bottom-0 z-40 w-[min(340px,calc(100vw-44px))] shadow-2xl md:shadow-none md:static md:w-[350px] md:shrink-0 bg-[#FFFFFF] flex flex-col h-auto md:h-full min-h-0 border-l md:border-l-0 border-r border-[#E0E3EB] overflow-hidden">
          {activeTab === "watchlist" && (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="px-3 py-2 border-b border-[#E0E3EB] flex items-center justify-between gap-2 shrink-0">
                  <select
                    aria-label="Watchlist Region"
                    value={selectedCountry}
                    onChange={(e) => {
                      setSubTier("ALL");
                      onSelectCountry(e.target.value);
                    }}
                    className="bg-transparent text-xs font-bold text-[#131722] outline-none cursor-pointer truncate max-w-[185px]"
                  >
                    <option value="IND">IND · India (NSE/BSE)</option>
                    <option value="USA">USA · NASDAQ/NYSE</option>
                    <option value="CANADA">CAN · Canada (TSX)</option>
                    <option value="CHINA">CHN · China (SSE/SZSE)</option>
                    <option value="EU">EU · Europe &amp; UK</option>
                    <option value="CRYPTO">CRYPTO · 24/7 Coins</option>
                    <option value="FOREX">FOREX · Majors/Minors</option>
                    <option value="ALL">ALL · Global Markets</option>
                  </select>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setOnlyFavorites((f) => !f)}
                      aria-label="Toggle Favorites Filter"
                      title="Show Starred Favorites Only"
                      className={`p-1 rounded transition ${
                        onlyFavorites ? "bg-amber-500/15 text-amber-500" : "hover:bg-[#F0F3FA] text-[#787B86] hover:text-[#131722]"
                      }`}
                    >
                      <Star className={`w-3.5 h-3.5 ${onlyFavorites ? "fill-amber-500" : ""}`} />
                    </button>
                    <button
                      type="button"
                      onClick={onOpenSearch}
                      aria-label="Add or Search Symbol"
                      title="Search Global Universe (Ctrl+K)"
                      className="p-1 rounded hover:bg-[#F0F3FA] text-[#787B86] hover:text-[#131722] transition"
                    >
                      <Search className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectTab(null)}
                      aria-label="Collapse Right Panel"
                      title="Collapse Panel"
                      className="p-1 rounded hover:bg-[#F0F3FA] text-[#787B86] hover:text-[#131722] transition"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Category Strip */}
                <div className="px-2 py-1.5 border-b border-[#E0E3EB] flex items-center gap-1 bg-[#F8F9FD] shrink-0 overflow-x-auto scrollbar-none">
                  {COMPACT_CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSubTier("ALL");
                        onSelectCategory(c.id);
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold transition whitespace-nowrap ${
                        selectedCategory === c.id
                          ? "bg-[#2962FF] text-white"
                          : "text-[#787B86] hover:bg-[#E0E3EB]/60 hover:text-[#131722]"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>

                {/* Contextual Crypto / Forex Tier Filter Pills + Quick Text Filter */}
                <div className="px-2.5 py-1.5 border-b border-[#F0F3FA] bg-[#FFFFFF] space-y-1.5 shrink-0">
                  {(isCryptoView || isForexView) && (
                    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
                      {(isCryptoView ? CRYPTO_TIERS : FOREX_TIERS).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSubTier(t.id)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap transition ${
                            subTier === t.id
                              ? "bg-[#131722] text-white"
                              : "bg-[#F8F9FD] text-[#787B86] hover:text-[#131722]"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    value={quickFilter}
                    onChange={(e) => setQuickFilter(e.target.value)}
                    placeholder={`Filter ${displayedAssets.length} symbols...`}
                    className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2.5 py-1 text-[11px] text-[#131722] placeholder-[#787B86] outline-none focus:border-[#2962FF]"
                  />
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_74px_62px_52px] gap-1 px-2.5 py-1.5 border-b border-[#F0F3FA] text-[10px] font-semibold text-[#787B86] uppercase tracking-wider shrink-0">
                  <span>Symbol</span>
                  <span className="text-right">Last</span>
                  <span className="text-right">Chg</span>
                  <span className="text-right">Chg%</span>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-[#F0F3FA]">
                  {displayedAssets.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#787B86]">
                      {assets.length === 0 ? "Loading instruments..." : "No symbols match filter."}
                    </div>
                  ) : (
                    displayedAssets.map((asset) => {
                      const isSel = selectedAsset?.symbol === asset.symbol;
                      const isBull = asset.change >= 0;
                      const chgAbs = Math.abs(asset.change || 0);
                      const prec = getPricePrecision(asset.price, asset.symbol);
                      const isFav = favorites.includes(asset.symbol);
                      return (
                        <div
                          key={asset.symbol}
                          className={`group relative w-full grid grid-cols-[minmax(0,1fr)_74px_62px_52px] gap-1 items-center px-2.5 py-1.5 text-left transition tabular-nums cursor-pointer ${
                            isSel
                              ? "bg-[#F0F3FA] ring-1 ring-inset ring-[#131722]/30"
                              : "hover:bg-[#F8F9FD]"
                          }`}
                          onClick={() => onSelectSymbol(asset.symbol, asset.name)}
                        >
                          <div className="min-w-0 pr-1 flex items-start gap-1">
                            <button
                              type="button"
                              onClick={(e) => toggleFav(asset.symbol, e)}
                              aria-label={`Favorite ${asset.symbol}`}
                              className="mt-0.5 text-[#787B86] hover:text-amber-500 shrink-0"
                            >
                              <Star className={`w-2.5 h-2.5 ${isFav ? "fill-amber-500 text-amber-500" : "opacity-35 group-hover:opacity-100"}`} />
                            </button>
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-[#131722] block truncate">{asset.symbol}</span>
                              <span className="text-[10px] text-[#787B86] block truncate">{asset.name}</span>
                            </div>
                          </div>
                          <span className="text-xs font-mono font-semibold text-[#131722] text-right">
                            {asset.price > 0 ? formatNumber(asset.price, prec, prec) : "--"}
                          </span>
                          <span
                            className={`text-[11px] font-mono font-medium text-right ${
                              isBull ? "text-[#089981]" : "text-[#F23645]"
                            }`}
                          >
                            {asset.price > 0 ? `${isBull ? "+" : "-"}${formatNumber(chgAbs, prec, prec)}` : "--"}
                          </span>
                          <span
                            className={`text-[11px] font-mono font-semibold text-right ${
                              isBull ? "text-[#089981]" : "text-[#F23645]"
                            }`}
                          >
                            {asset.price > 0 ? `${isBull ? "+" : ""}${(asset.change_percent ?? 0).toFixed(2)}%` : "--"}
                          </span>

                          {onQuickTradeFromWatchlist && (
                            <div
                              className="hidden group-hover:flex items-center gap-1 absolute right-2 top-1/2 -translate-y-1/2 bg-[#FFFFFF]/95 px-1 py-0.5 rounded shadow border border-[#E0E3EB]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => onQuickTradeFromWatchlist(asset, "BUY")}
                                className="px-1.5 py-0.5 rounded bg-[#089981] text-white text-[10px] font-black"
                                title={`Buy ${asset.symbol}`}
                              >
                                B
                              </button>
                              <button
                                type="button"
                                onClick={() => onQuickTradeFromWatchlist(asset, "SELL")}
                                className="px-1.5 py-0.5 rounded bg-[#F23645] text-white text-[10px] font-black"
                                title={`Sell ${asset.symbol}`}
                              >
                                S
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {selectedAsset && (
                <div className="h-[245px] shrink-0 border-t-4 border-[#EBECEF] bg-[#FFFFFF] flex flex-col overflow-y-auto px-3.5 py-2.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-extrabold text-[#131722]">{selectedAsset.symbol}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F0F3FA] text-[#787B86] font-semibold">
                          {selectedAsset.exchange}
                        </span>
                      </div>
                      <p className="text-xs text-[#6A6D78] truncate">{selectedAsset.name}</p>
                    </div>
                    <button
                      type="button"
                      onClick={onOpenOverview}
                      className="text-[11px] font-bold text-[#2962FF] hover:underline flex items-center gap-0.5 shrink-0"
                    >
                      Overview <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <span suppressHydrationWarning className="text-xl font-black font-mono tabular-nums text-[#131722]">
                        {selectedAsset.category === "forex" && selectedAsset.symbol.endsWith("=X") && !selectedAsset.symbol.includes("INR")
                          ? `${formatNumber(selectedAsset.price, getPricePrecision(selectedAsset.price, selectedAsset.symbol), getPricePrecision(selectedAsset.price, selectedAsset.symbol))} ${selectedAsset.symbol.length >= 8 ? selectedAsset.symbol.slice(3, 6) : "FX"}`
                          : formatAssetPrice(selectedAsset.price, selectedAsset.currency, selectedAsset.symbol)}
                      </span>
                      <span
                        className={`ml-2 text-xs font-mono font-bold ${
                          selectedAsset.change >= 0 ? "text-[#089981]" : "text-[#F23645]"
                        }`}
                      >
                        {selectedAsset.change >= 0 ? "+" : ""}
                        {formatNumber(selectedAsset.change, getPricePrecision(selectedAsset.price, selectedAsset.symbol), getPricePrecision(selectedAsset.price, selectedAsset.symbol))} ({selectedAsset.change >= 0 ? "+" : ""}
                        {(selectedAsset.change_percent ?? 0).toFixed(2)}%)
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isMarketOpen ? "bg-[#E8F5E9] text-[#089981]" : "bg-[#F0F3FA] text-[#787B86]"
                      }`}
                    >
                      {isMarketOpen ? "OPEN" : "CLOSED"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] pt-1 border-t border-[#F0F3FA]">
                    {selectedAsset.category === "forex" ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">Ind. Bid/Ask</span>
                          <span className="font-mono font-semibold text-[#131722]">
                            {(() => {
                              const p = getPricePrecision(selectedAsset.price, selectedAsset.symbol);
                              const halfSpr = selectedAsset.price > 0 ? Math.max(selectedAsset.price * 0.00015, selectedAsset.symbol.includes("JPY") ? 0.015 : 0.00015) : 0;
                              const b = selectedAsset.bid || (selectedAsset.price > 0 ? selectedAsset.price - halfSpr : 0);
                              const a = selectedAsset.ask || (selectedAsset.price > 0 ? selectedAsset.price + halfSpr : 0);
                              return b > 0 ? `${formatNumber(b, p, p)} / ${formatNumber(a, p, p)}` : "--";
                            })()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">Pip Size</span>
                          <span className="font-mono font-semibold text-[#131722]">
                            {selectedAsset.price >= 50 || selectedAsset.symbol.includes("JPY") ? "0.01" : "0.0001"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">Tier</span>
                          <span className="font-mono font-semibold text-[#2962FF]">{(selectedAsset.isin || "FX").replace("FX_", "")}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">{activeDetails?.week_52_low ? "52W Range" : "Market Window"}</span>
                          <span className="font-mono font-semibold text-[#131722] truncate max-w-[95px]">
                            {activeDetails?.week_52_low && activeDetails?.week_52_high
                              ? `${formatNumber(activeDetails.week_52_low, 3, 3)}–${formatNumber(activeDetails.week_52_high, 3, 3)}`
                              : "24/5 FX Session"}
                          </span>
                        </div>
                      </>
                    ) : selectedAsset.category === "crypto" ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">24h Vol</span>
                          <span className="font-mono font-semibold text-[#131722]">
                            {selectedAsset.volume ? formatCompactCurrency(selectedAsset.volume, "USD") : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">Tier</span>
                          <span className="font-mono font-semibold text-amber-500">{(selectedAsset.isin || "SPOT").replace("CRYPTO_", "")}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">Session</span>
                          <span className="font-mono font-semibold text-[#089981]">24/7 LIVE</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">{activeDetails?.week_52_low ? "52W Range" : "Execution"}</span>
                          <span className="font-mono font-semibold text-[#131722] truncate max-w-[95px]">
                            {activeDetails?.week_52_low && activeDetails?.week_52_high
                              ? `${formatNumber(activeDetails.week_52_low, 0, 2)}–${formatNumber(activeDetails.week_52_high, 0, 2)}`
                              : "Spot / Perp"}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">Volume</span>
                          <span className="font-mono font-semibold text-[#131722]">
                            {selectedAsset.volume || activeDetails?.volume
                              ? formatCompactCurrency(selectedAsset.volume || activeDetails?.volume, "PERCENT").replace("%", "")
                              : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">Mkt Cap</span>
                          <span className="font-mono font-semibold text-[#131722]">
                            {activeDetails?.market_cap ? formatCompactCurrency(activeDetails.market_cap, selectedAsset.currency) : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">Trailing P/E</span>
                          <span className="font-mono font-semibold text-[#131722]">
                            {activeDetails?.trailing_pe ? `${activeDetails.trailing_pe.toFixed(2)}x` : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#787B86]">52W Range</span>
                          <span className="font-mono font-semibold text-[#131722] truncate max-w-[90px]">
                            {activeDetails?.week_52_low && activeDetails?.week_52_high
                              ? `${formatNumber(activeDetails.week_52_low, 0, 0)}–${formatNumber(activeDetails.week_52_high, 0, 0)}`
                              : "—"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {activeTechnicals && (
                    <div className="pt-1.5 border-t border-[#F0F3FA] space-y-1.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[#787B86] font-bold uppercase tracking-wider">Tech Signal (1D)</span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-mono font-black ${
                            activeTechnicals.rating.includes("BUY")
                              ? "bg-[#E8F5E9] text-[#089981]"
                              : activeTechnicals.rating.includes("SELL")
                              ? "bg-[#FFEBEE] text-[#F23645]"
                              : "bg-[#F0F3FA] text-[#787B86]"
                          }`}
                        >
                          {activeTechnicals.rating} ({activeTechnicals.buy}B/{activeTechnicals.neutral}N/{activeTechnicals.sell}S)
                        </span>
                      </div>
                      {activeTechnicals.mtf && (
                        <div className="grid grid-cols-4 gap-1 text-[9px] font-mono">
                          {(["15m", "1h", "4h", "1d"] as const).map((tf) => {
                            const r = activeTechnicals.mtf?.[tf]?.rating || "NEUT";
                            const bull = r.includes("BUY");
                            const bear = r.includes("SELL");
                            return (
                              <div
                                key={tf}
                                className={`text-center py-0.5 rounded border font-bold ${
                                  bull
                                    ? "bg-[#E8F5E9]/70 border-[#089981]/30 text-[#089981]"
                                    : bear
                                    ? "bg-[#FFEBEE]/70 border-[#F23645]/30 text-[#F23645]"
                                    : "bg-[#F8F9FD] border-[#E0E3EB] text-[#787B86]"
                                }`}
                              >
                                {tf}: {r.replace("STRONG ", "S.")}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {activeTechnicals.pivots?.classic && (
                        <div className="flex items-center justify-between text-[10px] font-mono text-[#787B86]">
                          <span>
                            S1: <strong className="text-[#F23645]">{formatNumber(activeTechnicals.pivots.classic.S1, getPricePrecision(activeTechnicals.pivots.classic.S1, selectedAsset.symbol))}</strong>
                          </span>
                          <span>
                            P: <strong className="text-[#2962FF]">{formatNumber(activeTechnicals.pivots.classic.P, getPricePrecision(activeTechnicals.pivots.classic.P, selectedAsset.symbol))}</strong>
                          </span>
                          <span>
                            R1: <strong className="text-[#089981]">{formatNumber(activeTechnicals.pivots.classic.R1, getPricePrecision(activeTechnicals.pivots.classic.R1, selectedAsset.symbol))}</strong>
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onSelectTab("order")}
                      className="flex-1 py-1.5 rounded-lg bg-[#2962FF] hover:bg-[#1E53E5] text-white text-xs font-bold transition"
                    >
                      Paper Trade (Buy / Sell)
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectTab("news")}
                      className="px-3 py-1.5 rounded-lg bg-[#F0F3FA] hover:bg-[#E0E3EB] text-[#131722] text-xs font-bold transition"
                    >
                      News
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "order" && selectedAsset && (
            <div className="flex-1 overflow-y-auto p-2.5">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[#E0E3EB]">
                <span className="text-xs font-black text-[#131722] uppercase tracking-wider">FrontPage Order Ticket</span>
                <button
                  type="button"
                  onClick={() => onSelectTab(null)}
                  aria-label="Close Order Ticket"
                  className="p-1 rounded hover:bg-[#F0F3FA] text-[#787B86]"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <OrderDrawer
                key={`${selectedAsset.symbol}-${orderPreset?.side || ""}-${orderPreset?.product_type || ""}-${orderPreset?.stop_loss || ""}-${orderPreset?.take_profit || ""}`}
                symbol={selectedAsset.symbol}
                name={selectedAsset.name}
                currentPrice={selectedAsset.price || 0}
                currency={selectedAsset.currency}
                country={selectedAsset.region || selectedAsset.country || selectedCountry}
                exchange={selectedAsset.exchange}
                category={selectedAsset.category}
                walletBalance={resolveOrderWalletBalance(selectedAsset)}
                capitalHealth={capitalHealth?.[selectedAsset.currency]}
                preset={orderPreset}
                onExecuteOrder={onExecuteOrder}
                onPlaceLadder={onPlaceLadder}
              />
            </div>
          )}

          {activeTab === "news" && selectedAsset && (
            <div className="flex-1 overflow-y-auto p-3">
              <CompanyNewsStream symbol={selectedAsset.symbol} incomingBreaking={latestNewsAlert} compact />
            </div>
          )}

          {activeTab === "alerts" && (
            <div className="flex-1 overflow-y-auto p-3">
              <AlertManager key={selectedAsset?.symbol || "AAPL"} defaultSymbol={selectedAsset?.symbol || "AAPL"} compact />
            </div>
          )}

          {activeTab === "orderflow" && selectedAsset && (
            <div className="flex-1 overflow-y-auto p-3">
              <OrderFlowSuite symbol={selectedAsset.symbol} />
            </div>
          )}
        </aside>
      )}

      <nav
        aria-label="Workspace Side Tools"
        className="w-[44px] bg-[#FFFFFF] flex flex-col items-center justify-between py-1.5 shrink-0 border-l border-[#E0E3EB]"
      >
        <div className="flex flex-col items-center gap-1">
          {railButtons.map((btn) => {
            const Icon = btn.icon;
            const isAct = activeTab === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => toggleTab(btn.id)}
                aria-label={btn.label}
                title={btn.label}
                className={`relative w-[36px] h-[36px] rounded-lg flex items-center justify-center transition ${
                  isAct
                    ? "bg-[#F0F3FA] text-[#2962FF]"
                    : "text-[#6A6D78] hover:bg-[#F8F9FD] hover:text-[#131722]"
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
                {btn.badge && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#F23645]" />}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-1 pt-2 border-t border-[#E0E3EB]">
          <button
            type="button"
            onClick={onOpenOverview}
            aria-label="Symbol Overview & Financials"
            title="Symbol Overview & Financials"
            className="w-[36px] h-[36px] rounded-lg flex items-center justify-center text-[#6A6D78] hover:bg-[#F8F9FD] hover:text-[#131722] transition"
          >
            <Building2 className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onClick={onOpenIpos}
            aria-label="IPOs Calendar"
            title="Live IPOs Calendar"
            className="w-[36px] h-[36px] rounded-lg flex items-center justify-center text-[#6A6D78] hover:bg-[#F8F9FD] hover:text-[#131722] transition"
          >
            <Rocket className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onClick={onOpenMacro}
            aria-label="Macro & Economic Calendar"
            title="Macro & Economic Calendar"
            className="w-[36px] h-[36px] rounded-lg flex items-center justify-center text-[#6A6D78] hover:bg-[#F8F9FD] hover:text-[#131722] transition"
          >
            <Calendar className="w-[18px] h-[18px]" />
          </button>
        </div>
      </nav>
    </div>
  );
}
