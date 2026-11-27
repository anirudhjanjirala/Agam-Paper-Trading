"use client";

import React, { useState } from "react";
import { AlertTriangle, Database, LogOut, ShieldCheck, Trash2, UserCheck, Users, X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated?: () => void;
  onOpenDisclaimer?: () => void;
  onOpenActivityLog?: () => void;
}

export default function AuthModal({
  open,
  onClose,
  onAuthenticated,
  onOpenDisclaimer,
  onOpenActivityLog,
}: AuthModalProps) {
  const { user, profiles, logout, deleteAccount, updatePreferences } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [baseCurrency, setBaseCurrency] = useState(user?.base_currency || "INR");
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePass, setDeletePass] = useState("");
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  if (!open || !user) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSavedMsg(null);
    try {
      await updatePreferences({
        display_name: displayName.trim() || user.display_name,
        base_currency: baseCurrency,
      });
      setSavedMsg("Profile preferences saved to local PC vault.");
      onAuthenticated?.();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCurrent = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteErr(null);
    setBusy(true);
    try {
      await deleteAccount(deletePass);
      onClose();
    } catch (err: unknown) {
      setDeleteErr(err instanceof Error ? err.message : "Failed to remove account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#131722] border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Trader Profile &amp; Switch User ({profiles.length} on PC)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#1e222d] border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Active PC Vault Profile ({user.role})
                </div>
                <div className="text-xs font-bold text-slate-900 dark:text-white mt-0.5">
                  {user.email}
                </div>
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 flex items-center gap-1">
                  <Database className="w-3 h-3" />
                  Fixed Capital Active · Local SQLite Vault
                </div>
              </div>
              <UserCheck className="w-5 h-5 text-sky-500" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Trader Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={user.display_name || "Trader"}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1f2e] text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Primary Wallet Currency
                </label>
                <select
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1f2e] text-slate-900 dark:text-white"
                >
                  <option value="INR">INR (India)</option>
                  <option value="USD">USD (USA)</option>
                  <option value="CAD">CAD (Canada)</option>
                  <option value="CNY">CNY (China)</option>
                  <option value="EUR">EUR (Europe)</option>
                  <option value="GBP">GBP (UK)</option>
                </select>
              </div>
            </div>

            {savedMsg && (
              <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                {savedMsg}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-2 px-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors"
              >
                {busy ? "Saving..." : "Save Profile"}
              </button>
              {onOpenActivityLog && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenActivityLog();
                  }}
                  className="py-2 px-3 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200"
                >
                  Audit Log
                </button>
              )}
              {onOpenDisclaimer && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenDisclaimer();
                  }}
                  className="py-2 px-3 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200"
                >
                  Disclaimers
                </button>
              )}
            </div>
          </form>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={async () => {
                await logout();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-sky-600 text-white text-xs font-bold transition"
            >
              <Users className="w-3.5 h-3.5" />
              Switch / Add Trader
            </button>
            <button
              type="button"
              onClick={async () => {
                await logout();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>

          {/* Password-Confirmed Remove Profile (Leave PC) */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:underline inline-flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Leave PC &amp; Remove My Profile
              </button>
            ) : (
              <form onSubmit={handleDeleteCurrent} className="space-y-2 p-3 rounded-lg border border-rose-500/40 bg-rose-500/5">
                <div className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                  Permanently remove {user.email} from this PC?
                </div>
                <input
                  type="password"
                  required
                  value={deletePass}
                  onChange={(e) => setDeletePass(e.target.value)}
                  placeholder="Enter your password to confirm removal"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1a1f2e] text-slate-900 dark:text-white"
                />
                {deleteErr && (
                  <div className="flex items-center gap-1 text-[11px] text-rose-500 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{deleteErr}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold"
                  >
                    Confirm Remove
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeletePass("");
                      setDeleteErr(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
