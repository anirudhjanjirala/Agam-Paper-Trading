"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authFetch, setStoredToken } from "@/lib/api";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  base_currency: string;
  theme_preference: "light" | "dark";
  is_guest: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, baseCurrency?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await authFetch("/api/auth/me");
      if (res.ok) {
        const d = await res.json();
        if (d.access_token) setStoredToken(d.access_token);
        setUser(d);
      }
    } catch {
      // backend offline or starting
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    authFetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!active) return;
        if (d) {
          if (d.access_token) setStoredToken(d.access_token);
          setUser(d);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.detail || "Login failed");
    if (d.access_token) setStoredToken(d.access_token);
    setUser(d);
  }, []);

  const register = useCallback(async (email: string, password: string, baseCurrency = "USD") => {
    const res = await authFetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, base_currency: baseCurrency }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.detail || "Registration failed");
    if (d.access_token) setStoredToken(d.access_token);
    setUser(d);
  }, []);

  const logout = useCallback(async () => {
    try {
      const res = await authFetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        if (d.user?.access_token) setStoredToken(d.user.access_token);
        setUser(d.user || null);
      } else {
        setStoredToken(null);
        setUser(null);
      }
    } catch {
      setStoredToken(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
