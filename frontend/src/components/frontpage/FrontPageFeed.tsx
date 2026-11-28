"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Flame, Heart, Plus, Send, Sparkles } from "lucide-react";
import { formatAssetPrice } from "@/lib/format";
import { apiUrl, authFetch } from "@/lib/api";
import { COUNTRY_META, OrderDraftPreset, TradeIdea } from "@/types/trading";
import CountryFlag from "@/components/CountryFlag";

interface FrontPageFeedProps {
  selectedCountry: string;
  activeSymbol?: string;
  activeSymbolName?: string;
  activePrice?: number;
  activeCurrency?: string;
  onCopyToPaperTrade: (preset: OrderDraftPreset) => void;
  onOpenSymbol: (symbol: string) => void;
}

export default function FrontPageFeed({
  selectedCountry,
  activeSymbol = "RELIANCE.NS",
  activeSymbolName = "Reliance Industries",
  activePrice = 0,
  activeCurrency = "INR",
  onCopyToPaperTrade,
  onOpenSymbol,
}: FrontPageFeedProps) {
  const [countryFilter, setCountryFilter] = useState<string>(selectedCountry);
  const [ideas, setIdeas] = useState<TradeIdea[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [composerOpen, setComposerOpen] = useState<boolean>(false);

  const [symbol, setSymbol] = useState<string>(activeSymbol);
  const [direction, setDirection] = useState<"BULLISH" | "BEARISH">("BULLISH");
  const [productType, setProductType] = useState<"INTRADAY" | "DELIVERY">("INTRADAY");
  const [targetPx, setTargetPx] = useState<string>("");
  const [slPx, setSlPx] = useState<string>("");
  const [timeframe, setTimeframe] = useState<string>("15m");
  const [thesis, setThesis] = useState<string>("");
  const [posting, setPosting] = useState<boolean>(false);

  const loadIdeas = useCallback(async (ctry: string) => {
    try {
      const r = await fetch(apiUrl(`/api/feed/ideas?country=${encodeURIComponent(ctry)}`));
      if (r.ok) {
        const d = await r.json();
        setIdeas(d.ideas || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl(`/api/feed/ideas?country=${encodeURIComponent(countryFilter)}`), {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!controller.signal.aborted && d) {
          setIdeas(d.ideas || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [countryFilter]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thesis.trim()) return;
    setPosting(true);
    try {
      const r = await authFetch("/api/feed/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          name: symbol === activeSymbol ? activeSymbolName : undefined,
          currency: symbol === activeSymbol ? activeCurrency : undefined,
          direction,
          product_type: productType,
          entry_price: symbol === activeSymbol && activePrice > 0 ? activePrice : undefined,
          target_price: targetPx ? parseFloat(targetPx) : undefined,
          stop_loss: slPx ? parseFloat(slPx) : undefined,
          timeframe,
          thesis,
        }),
      });
      if (r.ok) {
        setThesis("");
        setTargetPx("");
        setSlPx("");
        setComposerOpen(false);
        loadIdeas(countryFilter);
      }
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (id: string) => {
    const r = await fetch(apiUrl(`/api/feed/ideas/${encodeURIComponent(id)}/like`), { method: "POST" });
    if (r.ok) {
      const d = await r.json();
      setIdeas((prev) => prev.map((it) => (it.id === id ? { ...it, likes_count: d.likes_count } : it)));
    }
  };

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
                  ? "bg-[#2962FF] text-white"
                  : "bg-[#F8F9FD] hover:bg-[#F0F3FA] text-[#131722] border border-[#E0E3EB]"
              }`}
            >
              <CountryFlag code={code} />
              <span>{code === "ALL" ? "All Markets" : COUNTRY_META[code].short}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            setSymbol(activeSymbol);
            setComposerOpen((o) => !o);
          }}
          className="px-4 py-2 rounded-xl bg-[#131722] hover:bg-[#2962FF] text-white text-xs font-bold flex items-center gap-1.5 transition"
        >
          <Plus className="w-3.5 h-3.5" /> Post Trade Idea
        </button>
      </div>

      {composerOpen && (
        <form onSubmit={handlePublish} className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-3 text-xs">
          <div className="flex items-center justify-between border-b border-[#E0E3EB] pb-2.5">
            <span className="font-black text-sm text-[#131722] flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-[#2962FF]" /> Share TradeLab Setup
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="Ticker (e.g. RELIANCE.NS)" required className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 font-mono font-bold text-[#131722]" />
            <select value={direction} onChange={(e) => setDirection(e.target.value as "BULLISH" | "BEARISH")} className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 font-bold text-[#131722]">
              <option value="BULLISH">BULLISH (BUY)</option>
              <option value="BEARISH">BEARISH (SELL)</option>
            </select>
            <select value={productType} onChange={(e) => setProductType(e.target.value as "INTRADAY" | "DELIVERY")} className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 font-bold text-[#131722]">
              <option value="INTRADAY">Intraday (MIS)</option>
              <option value="DELIVERY">Delivery (CNC)</option>
            </select>
            <input type="number" step="any" value={targetPx} onChange={(e) => setTargetPx(e.target.value)} placeholder="Target Price" className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 font-mono" />
            <input type="number" step="any" value={slPx} onChange={(e) => setSlPx(e.target.value)} placeholder="Stop Loss" className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 font-mono" />
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 font-mono font-bold text-[#131722]">
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="1D">1D</option>
            </select>
          </div>
          <textarea rows={2} value={thesis} onChange={(e) => setThesis(e.target.value)} required placeholder="Write your technical or fundamental trade rationale..." className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] outline-none focus:border-[#2962FF]" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setComposerOpen(false)} className="px-3 py-1.5 rounded-lg bg-[#F0F3FA] text-[#787B86] font-bold">Cancel</button>
            <button type="submit" disabled={posting} className="px-4 py-1.5 rounded-lg bg-[#2962FF] text-white font-bold flex items-center gap-1">
              <Send className="w-3.5 h-3.5" /> {posting ? "Posting..." : "Publish Idea"}
            </button>
          </div>
        </form>
      )}

      {loading && ideas.length === 0 ? (
        <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-10 text-center text-xs text-[#787B86]">
          Loading FrontPage community trade ideas...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ideas.map((idea) => {
            const isBull = idea.direction === "BULLISH";
            const perfBull = idea.change_since_idea_pct >= 0;
            return (
              <div key={idea.id} className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-4 shadow-sm flex flex-col justify-between space-y-3">
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-[#131722] text-white text-xs font-black flex items-center justify-center">
                        {idea.author_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-[#131722]">{idea.author_name}</span>
                          <span className="text-[10px] font-mono text-[#787B86]">· {idea.created_time}</span>
                        </div>
                        <span className="text-[11px] text-[#787B86] inline-flex items-center gap-1.5">
                          <CountryFlag code={idea.country || "IND"} />
                          <span>{idea.name || idea.symbol}</span>
                        </span>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black flex items-center gap-0.5 ${isBull ? "bg-[#E8F5E9] text-[#089981]" : "bg-[#FFEBEE] text-[#F23645]"}`}>
                      {isBull ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {idea.direction} · {idea.product_type}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 text-xs font-mono">
                    <button type="button" onClick={() => onOpenSymbol(idea.symbol)} className="font-black text-[#2962FF] hover:underline">
                      {idea.symbol} ({idea.timeframe})
                    </button>
                    <span>Idea: <strong>{formatAssetPrice(idea.entry_price, idea.currency, idea.symbol)}</strong></span>
                    <span className={perfBull ? "text-[#089981] font-bold" : "text-[#F23645] font-bold"}>
                      Live: {formatAssetPrice(idea.current_price, idea.currency, idea.symbol)} ({perfBull ? "+" : ""}{idea.change_since_idea_pct}%)
                    </span>
                  </div>

                  <p className="text-xs text-[#131722] leading-relaxed">{idea.thesis}</p>

                  <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                    {idea.target_price && (
                      <span className="px-2 py-0.5 rounded bg-[#E8F5E9] text-[#089981] font-bold">
                        Target: {formatAssetPrice(idea.target_price, idea.currency, idea.symbol)}
                      </span>
                    )}
                    {idea.stop_loss && (
                      <span className="px-2 py-0.5 rounded bg-[#FFEBEE] text-[#F23645] font-bold">
                        SL: {formatAssetPrice(idea.stop_loss, idea.currency, idea.symbol)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-[#F0F3FA] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleLike(idea.id)}
                    className="px-2.5 py-1 rounded-lg bg-[#F8F9FD] hover:bg-[#FFEBEE] text-[#787B86] hover:text-[#F23645] text-xs font-bold flex items-center gap-1 transition"
                  >
                    <Heart className="w-3.5 h-3.5" /> {idea.likes_count}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onCopyToPaperTrade({
                        symbol: idea.symbol,
                        side: isBull ? "BUY" : "SELL",
                        product_type: idea.product_type === "DELIVERY" ? "DELIVERY" : "INTRADAY",
                        stop_loss: idea.stop_loss ?? null,
                        take_profit: idea.target_price ?? null,
                      })
                    }
                    className="px-3 py-1.5 rounded-xl bg-[#2962FF] hover:bg-[#1E53E5] text-white text-xs font-bold flex items-center gap-1.5 transition"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Paper Trade This Setup
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
