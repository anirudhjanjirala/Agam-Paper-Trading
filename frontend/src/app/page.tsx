"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import TradingViewChart, { ChartStyle, TimeframeKey } from "@/components/TradingViewChart";
import RightSidebar, { RightPanelTab, WatchlistAsset } from "@/components/tv/RightSidebar";
import BottomTerminalDrawer, { BottomDrawerTab } from "@/components/tv/BottomTerminalDrawer";
import { Position, PendingOrder, OrderHistoryItem } from "@/components/PositionsTable";
import IpoCardList, { IpoItem } from "@/components/IpoCardList";
import MacroInflation, { MacroData } from "@/components/MacroInflation";
import MultiChartWorkspace from "@/components/MultiChartWorkspace";
import FinancialsOverview from "@/components/fundamentals/FinancialsOverview";
import { NewsArticle } from "@/components/CompanyNewsStream";
import {
  Activity,
  Bell,
  Building2,
  Calendar,
  ChevronDown,
  Download,
  FunctionSquare,
  Grid,
  Maximize2,
  Menu,
  Moon,
  PlayCircle,
  Printer,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Sun,
  User,
  Wallet,
  X,
} from "lucide-react";
import { formatNumber, getCurrencySymbol } from "@/lib/format";
import { API_BASE_URL, apiUrl, authFetch, getStoredToken, wsUrl } from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";
import AuthModal from "@/components/AuthModal";

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  region?: string;
  currency: string;
  category: string;
}

interface SessionInfo {
  open: boolean;
  local_time: string;
  status: string;
}

type ActiveView = "chart" | "overview" | "multichart" | "screener" | "replay" | "ipos" | "macro";

const QUICK_TIMEFRAMES: TimeframeKey[] = ["1m", "5m", "15m", "1h", "1D", "1W", "1M"];
const TICK_TIMEFRAMES: TimeframeKey[] = ["1s", "5s", "10T"];

const REGION_CURRENCY_MAP: Record<string, string> = {
  IND: "INR",
  USA: "USD",
  CANADA: "CAD",
  CHINA: "CNY",
  EU: "EUR",
  ALL: "USD",
};

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState<boolean>(false);

  const [selectedCountry, setSelectedCountry] = useState<string>("IND");
  const [selectedCategory, setSelectedCategory] = useState<string>("stocks");
  const [activeCurrency, setActiveCurrency] = useState<string>("INR");
  const [assets, setAssets] = useState<WatchlistAsset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<WatchlistAsset | null>(null);

  const [activeView, setActiveView] = useState<ActiveView>("chart");
  const [timeframe, setTimeframe] = useState<TimeframeKey>("1D");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("candles");
  const [indicatorsOpen, setIndicatorsOpen] = useState<boolean>(false);
  const [catalogCount, setCatalogCount] = useState<number>(55);
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  const [rightTab, setRightTab] = useState<RightPanelTab>("watchlist");
  const [bottomOpen, setBottomOpen] = useState<boolean>(true);
  const [bottomExpanded, setBottomExpanded] = useState<boolean>(false);
  const [bottomTab, setBottomTab] = useState<BottomDrawerTab>("paper");

  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchRegion, setSearchRegion] = useState<string>("ALL");
  const [searchCategory, setSearchCategory] = useState<string>("all");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const [resetConfirm, setResetConfirm] = useState<boolean>(false);
  const [sessions, setSessions] = useState<Record<string, SessionInfo>>({});
  const [universeTotal, setUniverseTotal] = useState<number>(0);
  const [wallets, setWallets] = useState<Record<string, number>>({
    INR: 1000000.0,
    USD: 100000.0,
    CAD: 100000.0,
    CNY: 500000.0,
    EUR: 100000.0,
    GBP: 100000.0,
    GBp: 10000000.0,
  });
  const [positions, setPositions] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [ordersHistory, setOrdersHistory] = useState<OrderHistoryItem[]>([]);
  const [ipos, setIpos] = useState<IpoItem[]>([]);
  const [macro, setMacro] = useState<MacroData | null>(null);

  const [isWsConnected, setIsWsConnected] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [latestNewsAlert, setLatestNewsAlert] = useState<NewsArticle | null>(null);
  const [ipoNotice, setIpoNotice] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const selectedSymbolRef = useRef<string | null>(null);
  const pinnedSymbolRef = useRef<string | null>(null);
  const selectedCountryRef = useRef<string>(selectedCountry);
  const selectedCategoryRef = useRef<string>(selectedCategory);

  useEffect(() => {
    selectedSymbolRef.current = selectedAsset?.symbol ?? null;
  }, [selectedAsset?.symbol]);

  useEffect(() => {
    selectedCountryRef.current = selectedCountry;
  }, [selectedCountry]);

  useEffect(() => {
    selectedCategoryRef.current = selectedCategory;
  }, [selectedCategory]);

  // Keyboard shortcuts: Ctrl+K / Cmd+K -> Search Modal, Space -> Next Watchlist Ticker, Escape -> Close Overlays
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
        setMenuOpen(false);
        setAuthOpen(false);
      } else if (e.code === "Space" && !inField && !searchOpen && !authOpen) {
        e.preventDefault();
        setAssets((curList) => {
          if (curList.length > 1) {
            const idx = curList.findIndex((a) => a.symbol === selectedSymbolRef.current);
            const next = curList[(idx + 1) % curList.length];
            if (next) {
              pinnedSymbolRef.current = next.symbol;
              setSelectedAsset(next);
            }
          }
          return curList;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, authOpen]);

  const showToast = useCallback((ok: boolean, text: string) => {
    setToastMsg({ ok, text });
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const handleSelectCountry = (region: string) => {
    pinnedSymbolRef.current = null;
    setSelectedCountry(region);
    setActiveCurrency(REGION_CURRENCY_MAP[region] || "USD");
  };

  const loadAssetsForFilter = useCallback(
    async (region: string, category: string, autoPickFirst: boolean, signal?: AbortSignal) => {
      try {
        const url = apiUrl(`/api/assets?country=${region}&category=${category}`);
        const res = await fetch(url, { signal });
        if (signal?.aborted) return;
        if (!res.ok) {
          setBackendOffline(true);
          return;
        }

        const data: WatchlistAsset[] = await res.json();
        if (signal?.aborted) return;

        setBackendOffline(false);
        setAssets(data);

        if (data.length > 0 && autoPickFirst) {
          const curSym = selectedSymbolRef.current;
          if (pinnedSymbolRef.current && pinnedSymbolRef.current === curSym) {
            return;
          }
          const stillInList = curSym ? data.find((a) => a.symbol === curSym) : undefined;
          const target = stillInList || data[0];
          setSelectedAsset(target);

          if (target && target.price === 0) {
            fetch(apiUrl(`/api/quote/${encodeURIComponent(target.symbol)}`))
              .then((r) => (r.ok ? r.json() : null))
              .then((q) => {
                if (q && q.symbol === selectedSymbolRef.current) setSelectedAsset(q);
              })
              .catch(() => {});
          }
        }
      } catch (err: unknown) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          setBackendOffline(true);
        }
      }
    },
    []
  );

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await authFetch("/api/portfolio");
      if (res.ok) {
        const data = await res.json();
        setWallets(data.wallets);
        setPositions(data.positions || []);
        setPendingOrders(data.pending_orders || []);
        setOrdersHistory(data.orders_history || []);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchHealthAndSessions = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/health"));
      if (res.ok) {
        const d = await res.json();
        setSessions(d.sessions || {});
        setUniverseTotal(d.universe_stats?.TOTAL || 0);
        setBackendOffline(false);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchIpos = useCallback(async (region: string, signal?: AbortSignal) => {
    try {
      const res = await fetch(apiUrl(`/api/ipos?country=${region}`), { signal });
      if (!signal?.aborted && res.ok) setIpos(await res.json());
    } catch {
      // ignore
    }
  }, []);

  const fetchMacro = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/macro"));
      if (res.ok) setMacro(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      loadAssetsForFilter(selectedCountry, selectedCategory, true, controller.signal);
      fetchIpos(selectedCountry, controller.signal);
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedCountry, selectedCategory, loadAssetsForFilter, fetchIpos]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPortfolio();
      fetchMacro();
      fetchHealthAndSessions();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchPortfolio, fetchMacro, fetchHealthAndSessions]);

  useEffect(() => {
    if (!backendOffline) return;
    const timer = setInterval(() => {
      loadAssetsForFilter(selectedCountry, selectedCategory, true);
      fetchPortfolio();
      fetchMacro();
      fetchHealthAndSessions();
      fetchIpos(selectedCountry);
    }, 2500);
    return () => clearInterval(timer);
  }, [backendOffline, selectedCountry, selectedCategory, loadAssetsForFilter, fetchPortfolio, fetchMacro, fetchHealthAndSessions, fetchIpos]);

  useEffect(() => {
    if (backendOffline || universeTotal >= 1000) return;
    const timer = setInterval(() => {
      fetchHealthAndSessions();
      loadAssetsForFilter(selectedCountry, selectedCategory, false);
    }, 4000);
    return () => clearInterval(timer);
  }, [backendOffline, universeTotal, selectedCountry, selectedCategory, fetchHealthAndSessions, loadAssetsForFilter]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isUnmounted = false;

    const connect = () => {
      if (isUnmounted) return;
      try {
        ws = new WebSocket(wsUrl("/ws/live"));
        wsRef.current = ws;

        ws.onopen = () => {
          if (isUnmounted) {
            ws?.close();
            return;
          }
          setIsWsConnected(true);
          if (selectedSymbolRef.current) {
            ws?.send(JSON.stringify({ symbol: selectedSymbolRef.current }));
          }
        };

        ws.onmessage = (event) => {
          if (isUnmounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === "TICK") {
              if (data.symbol && data.symbol === selectedSymbolRef.current) {
                setSelectedAsset((prev) =>
                  prev && prev.symbol === data.symbol
                    ? {
                        ...prev,
                        price: data.price,
                        change: data.change,
                        change_percent: data.change_percent,
                        as_of: data.as_of || prev.as_of,
                      }
                    : prev
                );
              }
              if (data.all_prices) {
                setAssets((prev) =>
                  prev.map((a) => {
                    const updated = data.all_prices[a.symbol];
                    return updated
                      ? { ...a, price: updated.price, change: updated.change, change_percent: updated.change_percent }
                      : a;
                  })
                );
              }
            } else if (data.type === "NEWS_ALERT" && data.article) {
              setLatestNewsAlert(data.article);
            }
          } catch {
            // ignore
          }
        };

        ws.onclose = () => {
          setIsWsConnected(false);
          if (!isUnmounted) reconnectTimer = setTimeout(connect, 2000);
        };
        ws.onerror = () => {
          setIsWsConnected(false);
          ws?.close();
        };
      } catch {
        if (!isUnmounted) reconnectTimer = setTimeout(connect, 2000);
      }
    };

    connect();
    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const tok = getStoredToken();
    const qs = tok ? `?token=${encodeURIComponent(tok)}` : "";
    let userWs: WebSocket | null = null;
    try {
      userWs = new WebSocket(wsUrl(`/ws/user/${encodeURIComponent(user.id)}${qs}`));
      userWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ORDER_FILL" || msg.type === "PORTFOLIO_UPDATE" || msg.type === "PORTFOLIO_RESET") {
            fetchPortfolio();
          } else if (msg.type === "ALERT_TRIGGERED" && msg.alert) {
            showToast(true, `Alert triggered: ${msg.alert.symbol} ${msg.alert.condition} ${msg.alert.threshold}`);
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
    return () => {
      if (userWs) userWs.close();
    };
  }, [user?.id, fetchPortfolio, showToast]);

  useEffect(() => {
    if (!user?.id) return;
    const t = setTimeout(() => {
      fetchPortfolio();
    }, 0);
    return () => clearTimeout(t);
  }, [user?.id, fetchPortfolio]);

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && selectedAsset?.symbol) {
      wsRef.current.send(JSON.stringify({ symbol: selectedAsset.symbol }));
    }
  }, [selectedAsset?.symbol]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchPortfolio();
      fetchHealthAndSessions();
      loadAssetsForFilter(selectedCountryRef.current, selectedCategoryRef.current, false);
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchPortfolio, fetchHealthAndSessions, loadAssetsForFilter]);

  // Global Symbol Search Modal query & region/category filter effect
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (q.length < 1 && searchRegion === "ALL" && searchCategory === "all") {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const url =
          q.length >= 1
            ? apiUrl(`/api/search?q=${encodeURIComponent(q)}&region=${searchRegion}&category=${searchCategory}`)
            : apiUrl(`/api/assets?country=${searchRegion}&category=${searchCategory === "all" ? "stocks" : searchCategory}`);
        const res = await fetch(url, { signal: controller.signal });
        if (!controller.signal.aborted && res.ok) setSearchResults(await res.json());
      } catch {
        // ignore
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, q.length >= 1 ? 200 : 0);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchOpen, searchQuery, searchRegion, searchCategory]);

  const syncWalletCurrencyForAsset = (currency?: string) => {
    if (!currency) return;
    const normalized = currency === "GBp" ? "GBP" : currency;
    if (["INR", "USD", "CAD", "CNY", "EUR", "GBP"].includes(normalized)) {
      setActiveCurrency(normalized);
    }
  };

  const openSymbolEverywhere = async (symbol: string, overrideName?: string, overrideRegion?: string) => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    if (activeView !== "overview") setActiveView("chart");

    pinnedSymbolRef.current = symbol;
    selectedSymbolRef.current = symbol;

    const applyAsset = (assetObj: WatchlistAsset) => {
      setSelectedAsset(assetObj);
      syncWalletCurrencyForAsset(assetObj.currency);
      const targetRegion = overrideRegion || assetObj.region || assetObj.country;
      if (targetRegion && ["IND", "USA", "CANADA", "CHINA", "EU"].includes(targetRegion) && targetRegion !== selectedCountryRef.current) {
        setSelectedCountry(targetRegion);
      }
    };

    const localMatch = assets.find((a) => a.symbol === symbol);
    if (localMatch && localMatch.price > 0) {
      applyAsset(overrideName ? { ...localMatch, name: overrideName } : localMatch);
      return;
    }

    try {
      const res = await fetch(apiUrl(`/api/quote/${encodeURIComponent(symbol)}`));
      if (res.ok) {
        setBackendOffline(false);
        const fetched: WatchlistAsset = await res.json();
        const fullAsset: WatchlistAsset = { ...fetched, name: overrideName || fetched.name };
        applyAsset(fullAsset);
        setAssets((prev) => (prev.some((a) => a.symbol === fullAsset.symbol) ? prev : [fullAsset, ...prev]));
      }
    } catch {
      setBackendOffline(true);
    }
  };

  const handleExecuteOrder = async (order: {
    symbol: string;
    quantity: number;
    order_type: "BUY" | "SELL";
    order_mode: "MARKET" | "LIMIT";
    price?: number;
    stop_loss?: number;
    take_profit?: number;
  }) => {
    const res = await authFetch("/api/orders/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    const data = await res.json();
    if (res.ok) {
      fetchPortfolio();
      showToast(true, data.message);
      return { success: true, message: data.message };
    } else {
      showToast(false, data.detail || "Order execution failed");
      throw new Error(data.detail || "Order execution failed");
    }
  };

  const handleClosePosition = async (symbol: string, quantity: number, orderType: string) => {
    await handleExecuteOrder({
      symbol,
      quantity,
      order_type: orderType === "SHORT" ? "BUY" : "SELL",
      order_mode: "MARKET",
    });
  };

  const handleCancelPending = async (orderId: string) => {
    const res = await authFetch(`/api/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
    if (res.ok) {
      fetchPortfolio();
      showToast(true, "Pending Limit order cancelled.");
    }
  };

  const handleResetPortfolio = async () => {
    const res = await authFetch("/api/portfolio/reset", { method: "POST" });
    if (res.ok) {
      fetchPortfolio();
      showToast(true, "Multi-currency paper wallets reset.");
    }
  };

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const activeRegionCode = selectedAsset?.region || selectedAsset?.country || selectedCountry;
  const activeSession = sessions[activeRegionCode] || sessions[selectedCountry];
  const currentBalance = wallets[activeCurrency] ?? 0;
  const currSymbol = getCurrencySymbol(activeCurrency);
  const activeWalletForAsset = selectedAsset ? wallets[selectedAsset.currency] ?? currentBalance : currentBalance;
  const searchListToDisplay =
    searchQuery.trim().length >= 1 || searchRegion !== "ALL" || searchCategory !== "all"
      ? searchResults
      : assets.slice(0, 20);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#EBECEF] text-[#131722] select-none">
      {/* TradingView Exact Top Toolbar (38-40px fixed height) */}
      <header className="h-[40px] bg-[#FFFFFF] px-2 flex items-center justify-between gap-2 shrink-0 border-b border-[#E0E3EB] relative z-50">
        {/* Left Control Cluster */}
        <div className="flex items-center gap-0.5 min-w-0 flex-1">
          {/* Hamburger Menu + AGAM Badge */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Workspace Menu"
              title="Workspace & Markets Menu"
              className="w-[38px] h-[30px] rounded-lg hover:bg-[#F0F3FA] flex items-center justify-center text-[#131722] transition"
            >
              <Menu className="w-4 h-4" />
            </button>

            {menuOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-64 bg-[#FFFFFF] border border-[#E0E3EB] rounded-xl shadow-2xl p-2 z-[80] space-y-1 text-xs">
                <div className="px-2.5 py-1.5 border-b border-[#F0F3FA] flex items-center justify-between">
                  <span className="font-black text-[#131722] flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-[#2962FF]" /> AGAM Pro
                  </span>
                  <span className="text-[10px] font-mono text-[#089981] font-bold">
                    {universeTotal ? `${formatNumber(universeTotal, 0, 0)} LIVE` : "UNIVERSE"}
                  </span>
                </div>

                {[
                  { id: "chart" as const, label: "Superchart Terminal", icon: Activity },
                  { id: "overview" as const, label: "Symbol Overview & Fundamentals", icon: Building2 },
                  { id: "multichart" as const, label: "16-Chart Sync Canvas", icon: Grid },
                  { id: "ipos" as const, label: `Live IPOs Calendar (${ipos.length})`, icon: Rocket },
                  { id: "macro" as const, label: "FRED Macro & Calendar", icon: Calendar },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveView(item.id);
                        setMenuOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-2 rounded-lg font-semibold flex items-center gap-2 transition ${
                        activeView === item.id
                          ? "bg-[#2962FF]/10 text-[#2962FF]"
                          : "text-[#131722] hover:bg-[#F0F3FA]"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" /> {item.label}
                    </button>
                  );
                })}

                <div className="pt-1.5 border-t border-[#F0F3FA] space-y-1">
                  <button
                    type="button"
                    onClick={async () => {
                      setMenuOpen(false);
                      const res = await authFetch("/api/export/trades.csv");
                      if (res.ok) {
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "agam_trade_history.csv";
                        a.click();
                        URL.revokeObjectURL(url);
                      }
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg font-semibold text-[#131722] hover:bg-[#F0F3FA] flex items-center gap-2 transition"
                  >
                    <Download className="w-3.5 h-3.5 text-[#2962FF]" /> Export Trades CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      window.print();
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg font-semibold text-[#131722] hover:bg-[#F0F3FA] flex items-center gap-2 transition"
                  >
                    <Printer className="w-3.5 h-3.5 text-[#089981]" /> Print / PDF Report
                  </button>
                </div>

                <div className="pt-1.5 border-t border-[#F0F3FA] px-2.5 py-1 text-[10px] text-[#787B86] space-y-0.5">
                  <span className="font-bold uppercase block">Hotkeys</span>
                  <div className="flex justify-between font-mono"><span>Search</span><span>Ctrl+K</span></div>
                  <div className="flex justify-between font-mono"><span>Next Ticker</span><span>Space</span></div>
                  <div className="flex justify-between font-mono"><span>Horiz Ray</span><span>Alt+H</span></div>
                  <div className="flex justify-between font-mono"><span>Undo / Redo</span><span>Ctrl+Z / Y</span></div>
                </div>

                <div className="pt-1.5 border-t border-[#F0F3FA] px-2.5 py-1 space-y-1">
                  <span className="text-[10px] font-bold text-[#787B86] uppercase block">Live Sessions</span>
                  <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
                    {(["IND", "USA", "CANADA", "CHINA", "EU"] as const).map((code) => {
                      const inf = sessions[code];
                      return (
                        <div key={code} className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${inf?.open ? "bg-[#089981]" : "bg-[#9598A1]"}`} />
                          <span className="text-[#787B86]">{code}:</span>
                          <span className={inf?.open ? "text-[#089981] font-bold" : "text-[#787B86]"}>
                            {inf?.status || "..."}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Symbol Search Trigger Pill (TradingView Style) */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search Symbols"
            title="Search Symbol Universe (Ctrl+K)"
            className="h-[28px] px-2 rounded-lg bg-[#F0F3FA] hover:bg-[#E0E3EB] text-[#131722] text-xs font-bold flex items-center gap-1.5 transition shrink-0"
          >
            <Search className="w-3.5 h-3.5 text-[#787B86]" />
            <span className="font-mono">{selectedAsset?.symbol || "SEARCH"}</span>
            <span className="hidden 2xl:inline text-[10px] text-[#787B86] font-normal ml-0.5">Ctrl+K</span>
          </button>

          <div className="h-5 w-[1px] bg-[#E0E3EB] mx-0.5 hidden sm:block shrink-0" />

          {/* Timeframe Bar */}
          <div className="hidden md:flex items-center gap-0.5 shrink-0">
            {QUICK_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setTimeframe(tf);
                  setActiveView("chart");
                }}
                className={`h-[28px] px-1.5 rounded text-xs font-semibold transition ${
                  timeframe === tf && activeView === "chart"
                    ? "bg-[#F0F3FA] text-[#2962FF]"
                    : "text-[#131722] hover:bg-[#F8F9FD]"
                }`}
              >
                {tf}
              </button>
            ))}
            <div className="relative inline-flex items-center shrink-0">
              <select
                aria-label="Sub-Minute Tick Timeframes"
                value={TICK_TIMEFRAMES.includes(timeframe) ? timeframe : ""}
                onChange={(e) => {
                  if (e.target.value) {
                    setTimeframe(e.target.value as TimeframeKey);
                    setActiveView("chart");
                  }
                }}
                className="h-[28px] appearance-none bg-transparent hover:bg-[#F8F9FD] rounded pl-1.5 pr-4 text-[11px] font-mono text-[#787B86] outline-none cursor-pointer whitespace-nowrap"
              >
                <option value="" disabled>Ticks</option>
                <option value="1s">1s</option>
                <option value="5s">5s</option>
                <option value="10T">10T</option>
              </select>
              <ChevronDown className="w-3 h-3 text-[#787B86] pointer-events-none absolute right-0.5" />
            </div>
          </div>

          <div className="h-5 w-[1px] bg-[#E0E3EB] mx-1 hidden lg:block shrink-0" />

          {/* Chart Style Selector */}
          <div className="relative hidden sm:inline-flex items-center shrink-0">
            <select
              aria-label="Chart Style"
              value={chartStyle}
              onChange={(e) => {
                setChartStyle(e.target.value as ChartStyle);
                setActiveView("chart");
              }}
              className="h-[28px] appearance-none bg-transparent hover:bg-[#F0F3FA] rounded-lg pl-2 pr-5 text-xs font-semibold text-[#131722] outline-none cursor-pointer whitespace-nowrap"
            >
              <option value="candles">Candles</option>
              <option value="heikin_ashi">Heikin-Ashi</option>
              <option value="renko">Renko</option>
              <option value="line">Line</option>
              <option value="area">Area</option>
              <option value="baseline">Baseline</option>
            </select>
            <ChevronDown className="w-3 h-3 text-[#787B86] pointer-events-none absolute right-1" />
          </div>

          <div className="h-5 w-[1px] bg-[#E0E3EB] mx-1 hidden lg:block" />

          {/* fx Indicators */}
          <button
            type="button"
            onClick={() => {
              setActiveView("chart");
              setIndicatorsOpen(true);
            }}
            title={`Indicators & Strategies (${catalogCount})`}
            className="h-[28px] px-2 rounded-lg hover:bg-[#F0F3FA] text-[#131722] text-xs font-semibold flex items-center gap-1 transition shrink-0"
          >
            <FunctionSquare className="w-3.5 h-3.5 text-[#2962FF]" />
            <span className="hidden sm:inline">Indicators</span>
          </button>

          {/* Alert Trigger */}
          <button
            type="button"
            onClick={() => {
              setActiveView("chart");
              setRightTab("alerts");
            }}
            className="h-[28px] px-2 rounded-lg hover:bg-[#F0F3FA] text-[#131722] text-xs font-semibold hidden lg:flex items-center gap-1 transition"
          >
            <Bell className="w-3.5 h-3.5 text-[#6A6D78]" />
            <span>Alert</span>
          </button>

          {/* Bar Replay Trigger */}
          <button
            type="button"
            onClick={() => {
              setActiveView("chart");
              setBottomTab("replay");
              setBottomOpen(true);
            }}
            className="h-[28px] px-2 rounded-lg hover:bg-[#F0F3FA] text-[#131722] text-xs font-semibold hidden lg:flex items-center gap-1 transition"
          >
            <PlayCircle className="w-3.5 h-3.5 text-[#6A6D78]" />
            <span>Replay</span>
          </button>

          {/* 16x Layout Split */}
          <button
            type="button"
            onClick={() => setActiveView(activeView === "multichart" ? "chart" : "multichart")}
            aria-label="16-Chart Split Layout"
            title="16-Chart Split Workspace"
            className={`h-[28px] px-2 rounded-lg text-xs font-semibold hidden xl:flex items-center gap-1 transition ${
              activeView === "multichart" ? "bg-[#F0F3FA] text-[#2962FF]" : "text-[#131722] hover:bg-[#F0F3FA]"
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right Utility & Paper Wallet Cluster */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Live WS Status */}
          <span
            title={isWsConnected ? "WebSocket Live Feed Connected" : "Reconnecting WebSocket"}
            className={`hidden xl:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
              isWsConnected ? "text-[#089981] bg-[#E8F5E9]" : "text-[#787B86] bg-[#F0F3FA]"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isWsConnected ? "bg-[#089981] live-pulse" : "bg-[#9598A1]"}`} />
            {isWsConnected ? "LIVE" : "SYNC"}
          </span>

          {/* Region Selector */}
          <div className="relative hidden sm:inline-flex items-center shrink-0">
            <select
              aria-label="Select Market Region"
              value={selectedCountry}
              onChange={(e) => handleSelectCountry(e.target.value)}
              className="h-[28px] appearance-none bg-[#F8F9FD] hover:bg-[#F0F3FA] border border-[#E0E3EB] rounded-lg pl-2 pr-5 text-[11px] font-bold text-[#131722] outline-none cursor-pointer whitespace-nowrap"
            >
              <option value="IND">IND</option>
              <option value="USA">USA</option>
              <option value="CANADA">CAN</option>
              <option value="CHINA">CHN</option>
              <option value="EU">EU</option>
              <option value="ALL">ALL</option>
            </select>
            <ChevronDown className="w-3 h-3 text-[#787B86] pointer-events-none absolute right-1.5" />
          </div>

          {/* Compact Paper Wallet + Currency + Reset */}
          <div className="h-[28px] bg-[#F0F3FA] rounded-lg px-2 flex items-center gap-1.5 text-xs shrink-0">
            <Wallet className="w-3.5 h-3.5 text-[#2962FF] shrink-0" />
            <span suppressHydrationWarning className="font-mono font-bold text-[#131722] tabular-nums whitespace-nowrap">
              {currSymbol}{formatNumber(currentBalance, 2)}
            </span>
            <span className="h-3.5 w-[1px] bg-[#D1D4DC]" />
            <div className="relative inline-flex items-center shrink-0">
              <select
                aria-label="Wallet Currency"
                value={activeCurrency}
                onChange={(e) => setActiveCurrency(e.target.value)}
                className="appearance-none bg-transparent pr-3.5 pl-0.5 text-[11px] font-bold text-[#2962FF] outline-none cursor-pointer whitespace-nowrap"
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
                <option value="CAD">CAD</option>
                <option value="CNY">CNY</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
              <ChevronDown className="w-3 h-3 text-[#2962FF] pointer-events-none absolute right-0" />
            </div>
          </div>

          {resetConfirm ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  handleResetPortfolio();
                  setResetConfirm(false);
                }}
                className="h-[28px] px-2 bg-[#F23645] text-white rounded-lg text-[11px] font-bold"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setResetConfirm(false)}
                aria-label="Cancel Reset"
                className="h-[28px] px-1.5 bg-[#F0F3FA] text-[#787B86] rounded-lg text-[11px]"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setResetConfirm(true)}
              aria-label="Reset Multi-Currency Virtual Wallets"
              title="Reset Paper Wallets"
              className="w-[28px] h-[28px] rounded-lg hover:bg-[#F0F3FA] text-[#6A6D78] hover:text-[#131722] flex items-center justify-center transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Overview / Superchart Primary Action Pill */}
          <button
            type="button"
            onClick={() => setActiveView(activeView === "overview" ? "chart" : "overview")}
            className="h-[28px] px-2.5 rounded-lg bg-[#131722] hover:bg-[#2962FF] text-white text-xs font-bold transition shrink-0"
          >
            {activeView === "overview" ? "Superchart" : "Overview"}
          </button>

          {/* Dark (#0B0E14) / Light (#FFFFFF) Instant Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme"}
            title={theme === "dark" ? "Official Light Theme" : "Official Dark Theme (#0B0E14)"}
            className="w-[28px] h-[28px] rounded-lg hover:bg-[#F0F3FA] text-[#6A6D78] hover:text-[#131722] flex items-center justify-center transition shrink-0"
          >
            {theme === "dark" ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          {/* Multi-Tenant Isolated Account Trigger */}
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            aria-label="Account & Isolated Workspace"
            title={user && !user.is_guest ? `Signed in: ${user.email}` : "Sign In / Register Isolated Account"}
            className={`h-[28px] px-2 rounded-lg text-[11px] font-bold flex items-center gap-1 transition shrink-0 ${
              user && !user.is_guest
                ? "bg-[#E8F5E9] text-[#089981]"
                : "bg-[#F0F3FA] hover:bg-[#E0E3EB] text-[#131722]"
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span className="hidden xl:inline max-w-[76px] truncate">
              {user && !user.is_guest ? user.email.split("@")[0] : "Account"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setRefreshNonce((n) => n + 1);
              loadAssetsForFilter(selectedCountry, selectedCategory, false);
            }}
            aria-label="Refresh Market Data"
            title="Refresh Market Data"
            className="w-[28px] h-[28px] rounded-lg hover:bg-[#F0F3FA] text-[#6A6D78] hover:text-[#131722] hidden sm:flex items-center justify-center"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleToggleFullscreen}
            aria-label="Toggle Fullscreen"
            title="Fullscreen Mode"
            className="w-[28px] h-[28px] rounded-lg hover:bg-[#F0F3FA] text-[#6A6D78] hover:text-[#131722] hidden md:flex items-center justify-center"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Non-blocking Offline Reconnect Strip */}
      {backendOffline && (
        <div className="px-4 py-2 bg-[#FFF8E1] border-b border-[#F59E0B]/40 text-xs text-[#131722] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 text-[#D97706] animate-spin" />
            <span>
              Connecting to <strong>Agam FastAPI Engine</strong> (<code className="font-mono">{API_BASE_URL}</code>) — retrying automatically...
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              loadAssetsForFilter(selectedCountry, selectedCategory, true);
              fetchHealthAndSessions();
            }}
            className="px-2.5 py-1 rounded bg-[#FFFFFF] border border-[#E0E3EB] font-bold"
          >
            Retry
          </button>
        </div>
      )}

      {/* Toast Feedback for Quick Bid/Ask Orders */}
      {toastMsg && (
        <div
          className={`fixed top-12 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-xl shadow-xl border text-xs font-bold whitespace-nowrap ${
            toastMsg.ok
              ? "bg-[#E8F5E9] border-[#089981]/40 text-[#089981]"
              : "bg-[#FFEBEE] border-[#F23645]/40 text-[#F23645]"
          }`}
        >
          {toastMsg.text}
        </div>
      )}

      {/* Main Workspace Area */}
      {activeView === "chart" && (
        <div className="flex-1 min-h-0 flex gap-[4px] bg-[#EBECEF]">
          {/* Center Column: Full-Height Superchart + Collapsible Bottom Drawer */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-[4px]">
            <TradingViewChart
              symbol={selectedAsset?.symbol || "RELIANCE.NS"}
              name={selectedAsset?.name || "Loading..."}
              currentPrice={selectedAsset?.price || 0}
              priceChange={selectedAsset?.change || 0}
              priceChangePercent={selectedAsset?.change_percent || 0}
              currency={selectedAsset?.currency || activeCurrency}
              asOf={selectedAsset?.as_of}
              exchange={selectedAsset?.exchange}
              isMarketOpen={activeSession?.open}
              bid={selectedAsset?.bid}
              ask={selectedAsset?.ask}
              timeframe={timeframe}
              onChangeTimeframe={setTimeframe}
              chartStyle={chartStyle}
              indicatorsOpen={indicatorsOpen}
              onCloseIndicators={() => setIndicatorsOpen(false)}
              onCatalogLoaded={setCatalogCount}
              refreshNonce={refreshNonce}
              onQuickOrder={(side) =>
                selectedAsset &&
                handleExecuteOrder({
                  symbol: selectedAsset.symbol,
                  quantity: 1,
                  order_type: side,
                  order_mode: "MARKET",
                })
              }
              onOpenOverview={() => setActiveView("overview")}
            />

            <BottomTerminalDrawer
              isOpen={bottomOpen}
              isExpanded={bottomExpanded}
              onToggleOpen={() => setBottomOpen((o) => !o)}
              onToggleExpand={() => setBottomExpanded((e) => !e)}
              activeTab={bottomTab}
              onSelectTab={setBottomTab}
              selectedSymbol={selectedAsset?.symbol || "RELIANCE.NS"}
              activeCurrency={activeCurrency}
              walletBalance={activeWalletForAsset}
              positions={positions}
              pendingOrders={pendingOrders}
              ordersHistory={ordersHistory}
              onClosePosition={handleClosePosition}
              onCancelPending={handleCancelPending}
              onSelectSymbolFromScreener={(sym) => openSymbolEverywhere(sym)}
            />
          </div>

          {/* Right Docked Watchlist / Order Ticket / News Sidebar + 44px Icon Rail */}
          <RightSidebar
            activeTab={rightTab}
            onSelectTab={setRightTab}
            selectedCountry={selectedCountry}
            onSelectCountry={handleSelectCountry}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            assets={assets}
            selectedAsset={selectedAsset}
            onSelectSymbol={(sym, nm) => openSymbolEverywhere(sym, nm)}
            onOpenSearch={() => setSearchOpen(true)}
            wallets={wallets}
            onExecuteOrder={handleExecuteOrder}
            latestNewsAlert={latestNewsAlert}
            isMarketOpen={activeSession?.open}
            onOpenOverview={() => setActiveView("overview")}
            onOpenIpos={() => setActiveView("ipos")}
            onOpenMacro={() => setActiveView("macro")}
          />
        </div>
      )}

      {/* Screen 2: Editorial TradingView Symbol Overview Page */}
      {activeView === "overview" && (
        <div className="flex-1 min-h-0 overflow-y-auto bg-[#FFFFFF]">
          <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
            {selectedAsset ? (
              <FinancialsOverview
                key={selectedAsset.symbol}
                symbol={selectedAsset.symbol}
                incomingBreaking={latestNewsAlert}
                onBackToSuperchart={() => setActiveView("chart")}
              />
            ) : (
              <div className="py-20 text-center text-xs text-[#787B86]">Select a symbol to inspect fundamentals.</div>
            )}
          </div>
        </div>
      )}

      {activeView === "multichart" && (
        <div className="flex-1 min-h-0 overflow-y-auto bg-[#F8F9FD] p-4">
          <div className="max-w-[1600px] mx-auto">
            <MultiChartWorkspace />
          </div>
        </div>
      )}

      {activeView === "ipos" && (
        <div className="flex-1 min-h-0 overflow-y-auto bg-[#F8F9FD] p-4">
          <div className="max-w-[1400px] mx-auto space-y-3">
            {ipoNotice && (
              <div className="px-4 py-2.5 rounded-xl bg-[#E8F5E9] border border-[#089981]/30 text-[#089981] text-xs font-bold flex items-center justify-between">
                <span>{ipoNotice}</span>
                <button type="button" onClick={() => setIpoNotice(null)} className="hover:opacity-75">
                  Dismiss
                </button>
              </div>
            )}
            <IpoCardList
              ipos={ipos}
              onApplyBid={(ipo) => {
                setIpoNotice(`Virtual IPO bid applied for ${ipo.company} (${ipo.price_band}).`);
                setTimeout(() => setIpoNotice(null), 5000);
              }}
            />
          </div>
        </div>
      )}

      {activeView === "macro" && (
        <div className="flex-1 min-h-0 overflow-y-auto bg-[#F8F9FD] p-4">
          <div className="max-w-[1400px] mx-auto">
            <MacroInflation macro={macro} />
          </div>
        </div>
      )}

      {/* Global TradingView Symbol Search Modal (Ctrl+K) */}
      {searchOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Symbol Search"
          className="fixed inset-0 z-[90] bg-[#131722]/35 backdrop-blur-[2px] flex items-start justify-center pt-16 px-4"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[75vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E0E3EB]">
              <h2 className="text-sm font-bold text-[#131722]">Symbol Search ({formatNumber(universeTotal, 0, 0)} Instruments)</h2>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label="Close Symbol Search"
                className="p-1 rounded-lg text-[#787B86] hover:bg-[#F0F3FA] hover:text-[#131722]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-2.5 border-b border-[#E0E3EB] flex items-center gap-2 bg-[#F8F9FD]">
              <Search className="w-4 h-4 text-[#787B86]" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearchQuery(v);
                  if (v.trim().length < 1) setSearchResults([]);
                }}
                placeholder="Type ticker, company name, or ISIN (e.g. AAPL, RELIANCE, SHOP.TO, 600519, SAP)..."
                className="flex-1 bg-transparent text-sm text-[#131722] placeholder-[#787B86] outline-none"
              />
            </div>

            <div className="px-4 py-2 border-b border-[#E0E3EB] flex flex-wrap items-center gap-1.5 text-xs">
              {(["ALL", "IND", "USA", "CANADA", "CHINA", "EU"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSearchRegion(r)}
                  className={`px-2.5 py-1 rounded-full font-semibold transition ${
                    searchRegion === r ? "bg-[#131722] text-white" : "bg-[#F0F3FA] text-[#787B86] hover:text-[#131722]"
                  }`}
                >
                  {r}
                </button>
              ))}
              <span className="text-[#E0E3EB] mx-1">|</span>
              {(["all", "stocks", "etfs", "indices", "commodities", "forex", "bonds"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSearchCategory(c)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold capitalize transition ${
                    searchCategory === c ? "bg-[#2962FF] text-white" : "text-[#787B86] hover:bg-[#F0F3FA]"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#F0F3FA]">
              {isSearching && (
                <div className="px-4 py-6 text-center text-xs font-mono text-[#787B86]">Searching universe...</div>
              )}
              {!isSearching && searchListToDisplay.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-[#787B86]">
                  No symbols matched &ldquo;{searchQuery}&rdquo;.
                </div>
              )}
              {searchListToDisplay.map((res) => (
                <button
                  key={res.symbol}
                  type="button"
                  onClick={() => openSymbolEverywhere(res.symbol, res.name, res.region)}
                  className="w-full px-4 py-2.5 hover:bg-[#F0F3FA] flex items-center justify-between gap-3 text-left transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-7 h-7 rounded-full bg-[#F0F3FA] text-[#131722] text-[10px] font-black flex items-center justify-center shrink-0">
                      {res.symbol.replace(/[^A-Z0-9]/gi, "").slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-[#131722] font-mono block">{res.symbol}</span>
                      <span className="text-xs text-[#787B86] truncate block">{res.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[11px]">
                    <span className="uppercase text-[#787B86] font-semibold">{res.category}</span>
                    <span className="px-2 py-0.5 rounded bg-[#F8F9FD] border border-[#E0E3EB] font-mono text-[#131722]">
                      {res.region || "MKT"} · {res.exchange}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={fetchPortfolio}
      />
    </div>
  );
}
