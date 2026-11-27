"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authFetch, setStoredToken } from "@/lib/api";

export interface AuthUser {
  id: string;
  email: string;
  display_name?: string;
  role: string;
  base_currency: string;
  theme_preference: "light" | "dark";
  is_guest: boolean;
  accepted_disclaimer?: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
}

export interface PcProfile {
  id: string;
  display_name: string;
  email: string;
  email_hint: string;
  base_currency: string;
  role: string;
  created_at?: string | null;
  last_login_at?: string | null;
}

interface AuthStatusResponse {
  initialized: boolean;
  single_user_mode: boolean;
  multi_profile_mode?: boolean;
  profile_count?: number;
  profiles?: PcProfile[];
  owner_name: string | null;
  owner_email_hint: string | null;
  authenticated: boolean;
  user: AuthUser | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  initialized: boolean;
  multiProfileMode: boolean;
  profiles: PcProfile[];
  ownerName: string | null;
  ownerEmailHint: string | null;
  refreshUser: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    options?: {
      displayName?: string;
      baseCurrency?: string;
      themePreference?: "light" | "dark";
      acceptedDisclaimer?: boolean;
    }
  ) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (password: string, email?: string) => Promise<void>;
  updatePreferences: (patch: {
    display_name?: string;
    base_currency?: string;
    theme_preference?: "light" | "dark";
  }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [multiProfileMode, setMultiProfileMode] = useState(true);
  const [profiles, setProfiles] = useState<PcProfile[]>([]);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [ownerEmailHint, setOwnerEmailHint] = useState<string | null>(null);

  const applyStatus = useCallback((status: AuthStatusResponse) => {
    setInitialized(Boolean(status.initialized));
    setMultiProfileMode(status.multi_profile_mode !== false);
    setProfiles(Array.isArray(status.profiles) ? status.profiles : []);
    setOwnerName(status.owner_name ?? null);
    setOwnerEmailHint(status.owner_email_hint ?? null);
    setUser(status.authenticated ? status.user : null);
    if (!status.authenticated) {
      setStoredToken(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await authFetch("/api/auth/status");
      if (res.ok) {
        const data: AuthStatusResponse = await res.json();
        applyStatus(data);
        return;
      }
    } catch {
      // keep existing state when offline
    } finally {
      setLoading(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    let active = true;
    authFetch("/api/auth/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AuthStatusResponse | null) => {
        if (!active) return;
        if (data) applyStatus(data);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyStatus]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || "Login failed");
      }
      if (data.access_token) setStoredToken(data.access_token);
      setUser(data);
      setInitialized(true);
      await refreshUser();
    },
    [refreshUser]
  );

  const register = useCallback(
    async (
      email: string,
      password: string,
      options?: {
        displayName?: string;
        baseCurrency?: string;
        themePreference?: "light" | "dark";
        acceptedDisclaimer?: boolean;
      }
    ) => {
      const res = await authFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: options?.displayName || "",
          base_currency: options?.baseCurrency || "INR",
          theme_preference: options?.themePreference || "light",
          accepted_disclaimer: Boolean(options?.acceptedDisclaimer),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || "Registration failed");
      }
      if (data.access_token) setStoredToken(data.access_token);
      setUser(data);
      setInitialized(true);
      await refreshUser();
    },
    [refreshUser]
  );

  const logout = useCallback(async () => {
    setStoredToken(null);
    await authFetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    setUser(null);
    await refreshUser();
  }, [refreshUser]);

  const deleteAccount = useCallback(
    async (password: string, email?: string) => {
      const res = await authFetch("/api/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email || null, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || "Profile deletion failed");
      }
      if (data.was_current) {
        setStoredToken(null);
        setUser(null);
      }
      await refreshUser();
    },
    [refreshUser]
  );

  const updatePreferences = useCallback(
    async (patch: { display_name?: string; base_currency?: string; theme_preference?: "light" | "dark" }) => {
      const res = await authFetch("/api/auth/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        await refreshUser();
      }
    },
    [refreshUser]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        initialized,
        multiProfileMode,
        profiles,
        ownerName,
        ownerEmailHint,
        refreshUser,
        login,
        register,
        logout,
        deleteAccount,
        updatePreferences,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
