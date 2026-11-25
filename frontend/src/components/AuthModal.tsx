"use client";

import React, { useState } from "react";
import { X, ShieldCheck, LogOut, UserCheck } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
}

export default function AuthModal({ open, onClose, onAuthenticated }: AuthModalProps) {
  const { user, login, register, logout } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, baseCurrency);
      }
      onAuthenticated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Agam Account Authentication"
      className="fixed inset-0 z-[95] bg-[#131722]/45 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E0E3EB] pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#2962FF]" />
            <h2 className="text-sm font-bold text-[#131722]">Agam Isolated Cloud Account</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Account Dialog"
            className="p-1 rounded-lg text-[#787B86] hover:bg-[#F0F3FA] hover:text-[#131722]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {user && !user.is_guest ? (
          <div className="space-y-4 text-xs">
            <div className="p-3.5 rounded-xl bg-[#F8F9FD] border border-[#E0E3EB] space-y-1.5">
              <div className="flex items-center gap-2 text-[#089981] font-bold">
                <UserCheck className="w-4 h-4" /> Multi-Tenant Isolation Active
              </div>
              <p className="font-mono text-[#131722] font-bold">{user.email}</p>
              <p className="text-[#787B86]">
                Base Currency: <strong className="text-[#131722]">{user.base_currency}</strong> • Role: {user.role}
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                await logout();
                onAuthenticated();
                onClose();
              }}
              className="w-full py-2.5 rounded-xl bg-[#FFEBEE] hover:bg-[#F23645] text-[#F23645] hover:text-white font-bold flex items-center justify-center gap-2 transition"
            >
              <LogOut className="w-4 h-4" /> Sign Out &amp; Switch Workspace
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F8F9FD] border border-[#E0E3EB] text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
                className={`py-1.5 rounded-lg transition ${
                  mode === "login" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setError(null);
                }}
                className={`py-1.5 rounded-lg transition ${
                  mode === "register" ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:text-[#131722]"
                }`}
              >
                Create Account
              </button>
            </div>

            {user?.is_guest && (
              <p className="text-[11px] text-[#787B86] bg-[#F8F9FD] border border-[#E0E3EB] rounded-lg px-3 py-2">
                Currently in an isolated guest sandbox (<span className="font-mono">{user.id.slice(0, 8)}</span>). Sign in or register to sync wallets, drawings, layouts, and alerts across devices.
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-[#787B86] mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="trader@example.com"
                  className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] outline-none focus:border-[#2962FF]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#787B86] mb-1">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] outline-none focus:border-[#2962FF]"
                />
              </div>
              {mode === "register" && (
                <div>
                  <label className="block font-semibold text-[#787B86] mb-1">Base Currency</label>
                  <select
                    aria-label="Account Base Currency"
                    value={baseCurrency}
                    onChange={(e) => setBaseCurrency(e.target.value)}
                    className="w-full bg-[#F8F9FD] border border-[#E0E3EB] rounded-xl px-3 py-2 text-[#131722] font-bold outline-none"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="INR">INR (₹)</option>
                    <option value="CAD">CAD (C$)</option>
                    <option value="CNY">CNY (¥)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
              )}

              {error && (
                <div className="px-3 py-2 rounded-lg bg-[#FFEBEE] border border-[#F23645]/30 text-[#F23645] font-semibold">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 rounded-xl bg-[#2962FF] hover:bg-[#1E53E5] text-white font-bold transition disabled:opacity-60"
              >
                {submitting ? "Authenticating..." : mode === "login" ? "Sign In to Workspace" : "Create Isolated Account"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
