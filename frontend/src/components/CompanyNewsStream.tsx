"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Newspaper, ExternalLink, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { apiUrl } from "@/lib/api";

export interface NewsArticle {
  id: string;
  symbol: string;
  title: string;
  publisher: string;
  published_at: string;
  relative_time: string;
  url: string;
  snippet?: string;
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
}

interface CompanyNewsStreamProps {
  symbol: string;
  incomingBreaking?: NewsArticle | null;
  compact?: boolean;
}

export default function CompanyNewsStream({
  symbol,
  incomingBreaking,
  compact = false,
}: CompanyNewsStreamProps) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState<string>("");

  const fetchNews = useCallback(async (targetSym: string, signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/news/${encodeURIComponent(targetSym)}?limit=20`), {
        signal,
      });
      if (!signal?.aborted && res.ok) {
        const d = await res.json();
        setArticles(d.articles || []);
        setRegion(d.region || "");
      }
    } catch {
      // ignore abort/network
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl(`/api/news/${encodeURIComponent(symbol)}?limit=20`), {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!controller.signal.aborted && d) {
          setArticles(d.articles || []);
          setRegion(d.region || "");
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [symbol]);

  const displayedArticles = useMemo(() => {
    const base =
      !incomingBreaking || incomingBreaking.symbol !== symbol
        ? articles
        : articles.some((a) => a.id === incomingBreaking.id)
        ? articles
        : [incomingBreaking, ...articles].slice(0, 20);
    const seen = new Set<string>();
    return base.filter((a) => {
      const k = a.id || a.url || a.title;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [articles, incomingBreaking, symbol]);

  const sentimentBadge = (s: NewsArticle["sentiment"]) => {
    if (s === "POSITIVE") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E8F5E9] text-[#089981]">
          <TrendingUp className="w-3 h-3" /> Positive
        </span>
      );
    }
    if (s === "NEGATIVE") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFEBEE] text-[#F23645]">
          <TrendingDown className="w-3 h-3" /> Negative
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F0F3FA] text-[#787B86]">
        <Minus className="w-3 h-3" /> Neutral
      </span>
    );
  };

  return (
    <div className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-[#E0E3EB] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#2962FF]/10 rounded-xl text-[#2962FF]">
            <Newspaper className="w-5 h-5" />
          </div>
          <div>
              <h3 className="text-sm font-bold text-[#131722] flex flex-wrap items-center gap-2">
                <span>Live Google News Stream — {symbol}</span>
                {region && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F8F9FD] border border-[#E0E3EB] text-[#787B86] font-mono whitespace-nowrap shrink-0">
                    {region} RSS
                  </span>
                )}
              </h3>
              <p className="text-xs text-[#787B86]">Real-time publisher headlines & sentiment monitoring</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchNews(symbol)}
            aria-label="Refresh News Feed"
            title="Refresh News Feed"
            className="p-2 bg-[#F8F9FD] hover:bg-[#F0F3FA] border border-[#E0E3EB] text-[#787B86] hover:text-[#131722] rounded-lg transition shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-[#2962FF]" : ""}`} />
          </button>
        </div>

        {loading && displayedArticles.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#787B86] font-mono">
            Streaming live Google News RSS headlines for {symbol}...
          </div>
        ) : displayedArticles.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#787B86]">No recent news stories found for {symbol}.</div>
        ) : (
          <div className={`space-y-2.5 overflow-y-auto pr-1 ${compact ? "max-h-[540px]" : "max-h-[460px]"}`}>
            {displayedArticles.map((art, idx) => (
            <a
              key={`${art.id || art.url}-${idx}`}
              href={art.url}
              target="_blank"
              rel="noreferrer"
              className="block bg-[#F8F9FD] hover:bg-[#F0F3FA] border border-[#E0E3EB] rounded-xl p-3.5 transition group"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#FFFFFF] border border-[#E0E3EB] text-[#2962FF]">
                    {art.publisher}
                  </span>
                  <span className="text-[11px] font-mono text-[#787B86]">{art.relative_time}</span>
                </div>
                {sentimentBadge(art.sentiment)}
              </div>

              <h4 className="text-xs sm:text-sm font-bold text-[#131722] group-hover:text-[#2962FF] leading-snug flex items-start justify-between gap-2">
                <span>{art.title}</span>
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-[#787B86] group-hover:text-[#2962FF]" />
              </h4>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
