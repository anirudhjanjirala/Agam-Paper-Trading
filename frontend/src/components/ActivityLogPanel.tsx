"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ClipboardList, RefreshCw, Search, X } from "lucide-react";
import { authFetch } from "@/lib/api";
import { ActivityLogItem } from "@/types/trading";

interface ActivityLogPanelProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES = ["ALL", "TRADE", "RISK", "AUTH", "CHART", "ALERT", "WATCHLIST", "SETTINGS", "IDEA"];

export default function ActivityLogPanel({ open, onClose }: ActivityLogPanelProps) {
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [cat, setCat] = useState("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/activity?limit=200");
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data.logs) ? data.logs : []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    authFetch("/api/activity?limit=200")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data && Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = logs.filter((l) => {
    if (cat !== "ALL" && l.category !== cat) return false;
    if (!q) return true;
    return (
      l.action.toLowerCase().includes(q) ||
      l.symbol.toLowerCase().includes(q) ||
      l.details.toLowerCase().includes(q) ||
      l.category.toLowerCase().includes(q)
    );
  });

  const badgeTone = (c: string, a: string) => {
    if (a.includes("REJECTED") || a.includes("BLOCKED")) return "bg-rose-500/15 text-rose-500";
    if (c === "TRADE") return "bg-emerald-500/15 text-emerald-500";
    if (c === "RISK") return "bg-amber-500/15 text-amber-500";
    if (c === "AUTH") return "bg-sky-500/15 text-sky-500";
    return "bg-slate-500/15 text-slate-500 dark:text-slate-300";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[86vh] flex flex-col bg-white dark:bg-[#10141c] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-sky-500" />
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white">
                Persistent Local PC Activity &amp; Audit Ledger
              </h2>
              <p className="text-[11px] text-slate-500">
                Every trade, risk update, layout edit, alert, watchlist change &amp; login stored permanently in SQLite
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadLogs}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close activity log"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-[#0c1017]">
          <div className="flex items-center gap-1 flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={`px-2 py-1 rounded-md text-[10px] font-extrabold transition-colors ${
                  cat === c
                    ? "bg-sky-600 text-white"
                    : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol or action..."
              className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No persisted events match this filter yet.
            </div>
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                className="px-5 py-2.5 flex items-start justify-between gap-3 text-xs hover:bg-slate-50/80 dark:hover:bg-slate-900/50"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${badgeTone(item.category, item.action)}`}>
                      {item.category}
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white">{item.action}</span>
                    {item.symbol && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] font-bold text-sky-600 dark:text-sky-400">
                        {item.symbol}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 break-words">
                    {item.details || "—"}
                  </div>
                </div>
                <span className="text-[10px] font-mono text-slate-400 shrink-0 whitespace-nowrap">
                  {item.time_str}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
