"use client";

import React, { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Database,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { PcProfile, useAuth } from "@/components/AuthProvider";
import RiskDisclaimerModal from "@/components/RiskDisclaimerModal";

export default function AuthGate() {
  const { profiles, login, register, deleteAccount } = useAuth();
  const [mode, setMode] = useState<"switch" | "signup">(profiles.length > 0 ? "switch" : "signup");
  const [selectedProfile, setSelectedProfile] = useState<PcProfile | null>(profiles[0] || null);
  const [deleteTarget, setDeleteTarget] = useState<PcProfile | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState(profiles[0]?.email || "");
  const [password, setPassword] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("INR");
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveMode = profiles.length === 0 ? "signup" : mode;
  const activeProfile = selectedProfile && profiles.some((p) => p.id === selectedProfile.id) ? selectedProfile : profiles[0] || null;
  const effectiveEmail = effectiveMode === "switch" ? (activeProfile?.email || email) : email;

  const handleSelectProfile = (p: PcProfile) => {
    setSelectedProfile(p);
    setEmail(p.email);
    setPassword("");
    setError(null);
    setMode("switch");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (effectiveMode === "signup" && !acceptedDisclaimer) {
      setError("Please read and accept the Risk & Regulatory Disclaimers to create your trader profile.");
      return;
    }
    setBusy(true);
    try {
      if (effectiveMode === "signup") {
        await register(email.trim(), password, {
          displayName: displayName.trim(),
          baseCurrency,
          acceptedDisclaimer: true,
        });
      } else {
        await login(effectiveEmail.trim(), password);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await deleteAccount(deletePassword, deleteTarget.email);
      setDeleteTarget(null);
      setDeletePassword("");
      setSelectedProfile(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove profile");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-sky-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[520px] h-[520px] rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 rounded-2xl border border-slate-800 bg-[#0d1118]/95 shadow-2xl overflow-hidden">
        {/* Left Architecture & Fixed Capital Rules */}
        <div className="lg:col-span-5 p-6 sm:p-7 bg-gradient-to-b from-slate-900 via-[#0e1522] to-[#0a0f17] border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-base font-black tracking-tight text-white">Agam Paper Trading</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                  Local PC Multi-Profile Vault · Open Source
                </div>
              </div>
            </div>

            <div className="space-y-2.5 text-xs text-slate-300">
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80">
                <Users className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-white">Multi-Profile PC Switching</div>
                  <div className="text-[11px] text-slate-400">
                    Add new traders, switch profiles seamlessly with password isolation, or remove leaving profiles cleanly — every trader keeps separate portfolios &amp; charts.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80">
                <Wallet className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-white">Fixed Starting Capital (No Resets)</div>
                  <div className="text-[11px] text-slate-400">
                    ₹10L INR · $100K USD · C$100K CAD · ¥500K CNY · €100K EUR. Resets remain permanently disabled per trader; warnings trigger at &lt;30%, &lt;15%, &lt;5%.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80">
                <Database className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-white">Asset-Specific Global Taxes &amp; Audit</div>
                  <div className="text-[11px] text-slate-400">
                    Automatic statutory fees tailored by country &amp; asset class (Stocks, ETFs, Commodities MCX/CME, Forex, Bonds) plus full local SQLite audit trail.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 p-3 text-[11px] text-rose-200/90 space-y-1.5">
            <div className="flex items-center gap-1.5 font-extrabold text-rose-300">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              Educational Simulation &amp; Market Risk Notice
            </div>
            <p className="text-[10.5px] leading-relaxed text-rose-200/80">
              Simulated environment only — zero real funds or broker routing. Derivatives &amp; intraday leverage carry high capital loss risk.
            </p>
            <button
              type="button"
              onClick={() => setDisclaimerOpen(true)}
              className="text-[11px] font-bold text-sky-400 hover:text-sky-300 underline underline-offset-2"
            >
              Read full multi-jurisdiction Risk &amp; Tax Disclaimers →
            </button>
          </div>
        </div>

        {/* Right Profile Switcher / Sign Up / Remove Panel */}
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-center">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-slate-800 text-sky-400 mb-2">
                {effectiveMode === "signup" ? <UserPlus className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                {effectiveMode === "signup" ? "Add Trader Profile · Sign Up" : `Local PC Switcher (${profiles.length} Profiles)`}
              </div>
              <h1 className="text-xl font-black text-white">
                {effectiveMode === "signup"
                  ? "Create Trader Vault"
                  : activeProfile
                  ? `Sign In as ${activeProfile.display_name}`
                  : "Select Trader Profile"}
              </h1>
            </div>

            {profiles.length > 0 && effectiveMode === "switch" && (
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setEmail("");
                  setPassword("");
                  setError(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-sky-600 text-white text-xs font-bold transition-colors shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add Trader
              </button>
            )}
            {profiles.length > 0 && effectiveMode === "signup" && (
              <button
                type="button"
                onClick={() => {
                  setMode("switch");
                  setError(null);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Switch Profile
              </button>
            )}
          </div>

          {/* Clickable PC Trader Profile Cards */}
          {effectiveMode === "switch" && profiles.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5 max-h-44 overflow-y-auto pr-1">
              {profiles.map((p) => {
                const isSel = activeProfile?.id === p.id;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border transition cursor-pointer ${
                      isSel
                        ? "border-sky-500 bg-sky-500/10"
                        : "border-slate-800 bg-slate-900/70 hover:border-slate-700"
                    }`}
                    onClick={() => handleSelectProfile(p)}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0">
                        {(p.display_name || "T").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">{p.display_name}</div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {p.email_hint} · {p.base_currency}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      title={`Remove ${p.display_name} from this PC`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(p);
                        setDeletePassword("");
                        setError(null);
                      }}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {deleteTarget ? (
            <form onSubmit={handleConfirmDelete} className="space-y-3 p-4 rounded-xl border border-rose-500/40 bg-rose-950/20">
              <div className="text-xs font-bold text-rose-300">
                Remove Profile: {deleteTarget.display_name} ({deleteTarget.email})
              </div>
              <p className="text-[11px] text-slate-400">
                Enter this profile&apos;s password to permanently remove it and clear its local data from this PC.
              </p>
              <input
                type="password"
                required
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Confirm password to remove profile"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-700 bg-slate-900 text-white"
              />
              {error && (
                <div className="flex items-start gap-2 text-rose-300 text-xs font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={deleteBusy}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
                >
                  {deleteBusy ? "Removing..." : "Confirm Remove Profile"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteTarget(null);
                    setError(null);
                  }}
                  className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-bold"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              {effectiveMode === "signup" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                      Trader Name
                    </label>
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Anirudh"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-700 bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                      Primary Market Currency
                    </label>
                    <select
                      value={baseCurrency}
                      onChange={(e) => setBaseCurrency(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-700 bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value="INR">INR (₹10,00,000 Fixed · India)</option>
                      <option value="USD">USD ($100,000 Fixed · USA)</option>
                      <option value="CAD">CAD (C$100,000 Fixed · Canada)</option>
                      <option value="CNY">CNY (¥500,000 Fixed · China)</option>
                      <option value="EUR">EUR (€100,000 Fixed · Europe)</option>
                      <option value="GBP">GBP (£100,000 Fixed · UK)</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={effectiveEmail}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="trader@local.pc"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-700 bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                  Password (min 6 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-700 bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {effectiveMode === "signup" && (
                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-800 bg-slate-900/70 cursor-pointer hover:border-slate-700">
                  <input
                    type="checkbox"
                    checked={acceptedDisclaimer}
                    onChange={(e) => setAcceptedDisclaimer(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-600 text-sky-500 focus:ring-sky-500"
                  />
                  <span className="text-[11px] text-slate-300 leading-relaxed">
                    I acknowledge this is an educational paper-trading simulator, accept the{" "}
                    <button
                      type="button"
                      onClick={() => setDisclaimerOpen(true)}
                      className="font-bold text-sky-400 hover:underline"
                    >
                      Risk, Tax &amp; Regulatory Disclaimers
                    </button>
                    , and understand that my starting virtual capital is permanently fixed (no resets).
                  </span>
                </label>
              )}

              {error && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-extrabold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-sky-600/20"
              >
                {effectiveMode === "signup" ? <ShieldCheck className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                {busy
                  ? "Verifying..."
                  : effectiveMode === "signup"
                  ? "Create Trader Profile & Launch"
                  : "Sign In & Unlock Terminal"}
              </button>
            </form>
          )}
        </div>
      </div>

      <RiskDisclaimerModal
        open={disclaimerOpen}
        onClose={() => setDisclaimerOpen(false)}
        requireAcknowledge={effectiveMode === "signup"}
        onAcknowledge={() => setAcceptedDisclaimer(true)}
      />
    </div>
  );
}
