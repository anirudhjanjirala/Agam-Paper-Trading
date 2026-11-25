"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Bell, Plus, Trash2, CheckCircle } from "lucide-react";
import { authFetch } from "@/lib/api";

interface AlertRule {
  id: string;
  symbol: string;
  condition: string;
  threshold: number;
  note: string;
  non_expiring: boolean;
  triggered_count: number;
}

interface TriggerEvent {
  symbol: string;
  condition: string;
  threshold: number;
  observed_price: number;
}

export default function AlertManager({
  defaultSymbol,
  compact = false,
}: {
  defaultSymbol: string;
  compact?: boolean;
}) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [condition, setCondition] = useState("PRICE_ABOVE");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<{
    backend_mode: string;
    total_rules: number;
    rules: AlertRule[];
    recent_triggers: TriggerEvent[];
  } | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const r = await authFetch("/api/alerts");
      if (r.ok) setState(await r.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let active = true;
    const poll = () => {
      authFetch("/api/alerts")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (active && d) setState(d);
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!threshold) return;
    const r = await authFetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, condition, threshold: parseFloat(threshold), note }),
    });
    if (r.ok) {
      setThreshold("");
      setNote("");
      fetchAlerts();
    }
  };

  const handleDelete = async (id: string) => {
    await authFetch(`/api/alerts/${id}`, { method: "DELETE" });
    fetchAlerts();
  };

  return (
    <div
      className={`bg-[#FFFFFF] border border-[#E0E3EB] shadow-sm ${
        compact ? "rounded-xl p-3 space-y-3" : "rounded-2xl p-5 space-y-4"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#E0E3EB]">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`${compact ? "p-1.5 rounded-lg" : "p-2 rounded-xl"} bg-[#2962FF]/10 text-[#2962FF] shrink-0`}>
            <Bell className={compact ? "w-4 h-4" : "w-5 h-5"} />
          </div>
          <div className="min-w-0">
            <h3 className={`${compact ? "text-xs" : "text-base"} font-bold text-[#131722] flex flex-wrap items-center gap-1.5`}>
              <span>{compact ? "Price & RSI Alerts" : "Non-Expiring Alert Engine (1,000+ Rules Scale)"}</span>
              {state && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#F0F3FA] text-[#2962FF] font-bold whitespace-nowrap">
                  {state.backend_mode} • {state.total_rules} Active
                </span>
              )}
            </h3>
            <p className="text-[11px] text-[#787B86] leading-tight">
              Sorted-Set O(log N) persistent alert evaluator
            </p>
          </div>
        </div>
      </div>

      <form
        onSubmit={handleCreate}
        className={compact ? "grid grid-cols-2 gap-2 text-xs" : "grid grid-cols-1 sm:grid-cols-5 gap-2.5 text-xs"}
      >
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="Symbol (AAPL)"
          aria-label="Alert Symbol"
          className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2.5 py-1.5 text-[#131722] font-mono font-bold outline-none focus:border-[#2962FF] min-w-0"
        />
        <input
          type="number"
          step="0.01"
          required
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          placeholder="Threshold"
          aria-label="Target Threshold"
          className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2.5 py-1.5 text-[#131722] font-mono outline-none focus:border-[#2962FF] min-w-0"
        />
        <select
          aria-label="Alert Condition"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          className={`bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2.5 py-1.5 text-[#131722] font-semibold outline-none focus:border-[#2962FF] ${
            compact ? "col-span-2" : ""
          }`}
        >
          <option value="PRICE_ABOVE">Price Crosses Above</option>
          <option value="PRICE_BELOW">Price Crosses Below</option>
          <option value="RSI_ABOVE">RSI(14) Above</option>
          <option value="RSI_BELOW">RSI(14) Below</option>
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Alert note (optional)"
          aria-label="Alert Note"
          className={`bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-2.5 py-1.5 text-[#131722] outline-none focus:border-[#2962FF] ${
            compact ? "col-span-2" : ""
          }`}
        />
        <button
          type="submit"
          className={`px-3 py-2 rounded-lg bg-[#2962FF] hover:bg-[#1E53E5] text-white font-bold flex items-center justify-center gap-1.5 transition whitespace-nowrap ${
            compact ? "col-span-2" : ""
          }`}
        >
          <Plus className="w-3.5 h-3.5 shrink-0" />
          <span>{compact ? "Create Alert Rule" : "Add Non-Expiring Alert"}</span>
        </button>
      </form>

      <div className={compact ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 lg:grid-cols-2 gap-4"}>
        <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-2.5 space-y-2 max-h-52 overflow-y-auto">
          <span className="text-[10px] font-bold text-[#787B86] uppercase font-mono">Persistent Active Rules</span>
          {(!state || state.rules.length === 0) && (
            <p className="text-xs text-[#787B86] py-3 text-center">No alert rules yet. Create one above.</p>
          )}
          {state?.rules.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-2 bg-[#FFFFFF] border border-[#E0E3EB] rounded-lg px-2.5 py-1.5 text-xs">
              <div className="min-w-0 break-words leading-snug">
                <span className="font-mono font-bold text-[#131722]">{r.symbol}</span>{" "}
                <span className="text-[#2962FF] font-semibold">{r.condition}</span>{" "}
                <span className="font-mono text-[#089981] font-bold">{r.threshold}</span>
                {r.note && <span className="text-[#787B86] ml-1.5">({r.note})</span>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono text-[#787B86]">Hits: {r.triggered_count}</span>
                <button
                  type="button"
                  onClick={() => handleDelete(r.id)}
                  aria-label={`Delete alert rule ${r.symbol} ${r.condition}`}
                  title="Delete alert rule"
                  className="p-1 text-[#F23645] hover:opacity-75"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl p-2.5 space-y-2 max-h-48 overflow-y-auto">
          <span className="text-[10px] font-bold text-[#787B86] uppercase font-mono">Live Triggered Alerts</span>
          {(!state || state.recent_triggers.length === 0) && (
            <p className="text-xs text-[#787B86] py-3 text-center">No alerts fired yet.</p>
          )}
          {state?.recent_triggers.map((ev, i) => (
            <div key={`${ev.symbol}-${ev.condition}-${ev.threshold}-${i}`} className="flex items-center justify-between gap-2 bg-[#E8F5E9] border border-[#089981]/30 rounded-lg px-2.5 py-1.5 text-xs">
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <CheckCircle className="w-3.5 h-3.5 text-[#089981] shrink-0" />
                <span className="font-mono font-bold text-[#131722]">{ev.symbol}</span>
                <span className="text-[#131722] truncate">{ev.condition} {ev.threshold}</span>
              </div>
              <span className="font-mono text-[#089981] font-bold shrink-0">@ {ev.observed_price}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
