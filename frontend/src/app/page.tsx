"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import TradingViewChart, { ChartStyle, TimeframeKey } from "@/components/TradingViewChart";
import RightSidebar, { RightPanelTab, WatchlistAsset } from "@/components/tv/RightSidebar";
import BottomTerminalDrawer, { BottomDrawerTab } from "@/components/tv/BottomTerminalDrawer";
import FrontPagePortfolio from "@/components/frontpage/FrontPagePortfolio";
import FrontPageOrders from "@/components/frontpage/FrontPageOrders";
import FrontPageTaxCenter from "@/components/frontpage/FrontPageTaxCenter";
import FrontPageFeed from "@/components/frontpage/FrontPageFeed";
import IpoCardList, { IpoItem } from "@/components/IpoCardList";
import MacroInflation, { MacroData } from "@/components/MacroInflation";
import MultiChartWorkspace from "@/components/MultiChartWorkspace";
import FinancialsOverview from "@/components/fundamentals/FinancialsOverview";
import { NewsArticle } from "@/components/CompanyNewsStream";
import {
  Activity,
  AlertTriangle,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  ChevronDown,
  ClipboardList,
  Database,
  Download,
  Flame,
  FunctionSquare,
  Grid,
  Landmark,
  ListOrdered,
  Lock,
  Maximize2,
  Menu,
  Moon,
  PlayCircle,
  Printer,
  RefreshCw,
  Rocket,
  Search,
  ShieldAlert,
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
import AuthGate from "@/components/AuthGate";
import CountryFlag from "@/components/CountryFlag";
import RiskDisclaimerModal from "@/components/RiskDisclaimerModal";
import ActivityLogPanel from "@/components/ActivityLogPanel";
import {
  CapitalHealthEntry,
  ClosedTradeItem,
  COUNTRY_META,
  CountryAnalytics,
  CountryTaxSummary,
  OrderDraftPreset,
  OrderHistoryItem,
  PendingOrder,
  Position,
  WalletDetail,
} from "@/types/trading";

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

type ActiveView = "chart" | "portfolio" | "orders" | "taxes" | "feed" | "overview" | "multichart" | "screener" | "replay" | "ipos" | "macro";

const QUICK_TIMEFRAMES: TimeframeKey[] = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];
const TICK_TIMEFRAMES: TimeframeKey[] = ["1s", "5s", "10T"];

const REGION_CURRENCY_MAP: Record<string, string> = {
  IND: "INR",
  USA: "USD",
  CANADA: "CAD",
  CHINA: "CNY",
  EU: "EUR",
  CRYPTO: "USD",
  FOREX: "USD",
  ALL: "USD",
};

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const { user, loading: authLoading } = useAuth();
  const [authOpen, setAuthOpen] = useState<boolean>(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState<boolean>(false);
  const [activityOpen, setActivityOpen] = useState<boolean>(false);

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

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      const timer = setTimeout(() => {
        setRightTab(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, []);

  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchRegion, setSearchRegion] = useState<string>("ALL");
  const [searchCategory, setSearchCategory] = useState<string>("all");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

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
  const [walletDetails, setWalletDetails] = useState<Record<string, WalletDetail>>({});
  const [capitalHealth, setCapitalHealth] = useState<Record<string, CapitalHealthEntry>>({});
  const [positions, setPositions] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [ordersHistory, setOrdersHistory] = useState<OrderHistoryItem[]>([]);
  const [rejectedOrders, setRejectedOrders] = useState<OrderHistoryItem[]>([]);
  const [closedTrades, setClosedTrades] = useState<ClosedTradeItem[]>([]);
  const [taxSummaryByCountry, setTaxSummaryByCountry] = useState<Record<string, CountryTaxSummary>>({});
  const [analyticsByCountry, setAnalyticsByCountry] = useState<Record<string, CountryAnalytics>>({});
  const [indexQuotes, setIndexQuotes] = useState<Record<string, { price: number; change_percent: number }>>({});
  const [orderPreset, setOrderPreset] = useState<OrderDraftPreset | null>(null);
  const [ipos, setIpos] = useState<IpoItem[]>([]);
  const [iposLoading, setIposLoading] = useState<boolean>(true);
  const [iposError, setIposError] = useState<string | null>(null);
  const [macro, setMacro] = useState<MacroData | null>(null);

  const [isWsConnected, setIsWsConnected] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [latestNewsAlert, setLatestNewsAlert] = useState<NewsArticle | null>(null);
  const [ipoNotice, setIpoNotice] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg({ ok, text });
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const handleSelectCountry = (region: string) => {
    pinnedSymbolRef.current = null;
    setSelectedCountry(region);
    setActiveCurrency(REGION_CURRENCY_MAP[region] || "USD");
    if (region === "CRYPTO") {
      setSelectedCategory("crypto");
    } else if (region === "FOREX") {
      setSelectedCategory("forex");
    } else if (selectedCategory === "crypto" || selectedCategory === "forex") {
      setSelectedCategory("stocks");
    }
  };

  const handleSelectCategorySafe = (cat: string) => {
    pinnedSymbolRef.current = null;
    setSelectedCategory(cat);
    if (cat === "crypto" && selectedCountry !== "CRYPTO" && selectedCountry !== "ALL") {
      setSelectedCountry("CRYPTO");
      setActiveCurrency("USD");
    } else if (cat === "forex" && selectedCountry !== "FOREX" && selectedCountry !== "ALL") {
      setSelectedCountry("FOREX");
      setActiveCurrency("USD");
    }
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
        setWalletDetails(data.wallet_details || {});
        setCapitalHealth(data.capital_health || {});
        setPositions(data.positions || []);
        setPendingOrders(data.pending_orders || []);
        setOrdersHistory(data.orders_history || []);
        setRejectedOrders(data.rejected_orders || []);
        setClosedTrades(data.closed_trades || []);
        setTaxSummaryByCountry(data.tax_summary_by_country || {});
        setAnalyticsByCountry(data.analytics_by_country || {});
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
    setIposLoading(true);
    setIposError(null);
    try {
      const res = await fetch(apiUrl(`/api/ipos?country=${region}`), { signal });
      if (signal?.aborted) return;
      if (!res.ok) {
        setIposError(`Unable to load live IPO filings (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json();
      setIpos(Array.isArray(data) ? data : []);
    } catch {
      if (!signal?.aborted) {
        setIposError("Unable to reach the live IPO feed right now.");
      }
    } finally {
      if (!signal?.aborted) setIposLoading(false);
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
    if (!user?.id) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      loadAssetsForFilter(selectedCountry, selectedCategory, true, controller.signal);
      fetchIpos(selectedCountry, controller.signal);
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [user?.id, selectedCountry, selectedCategory, loadAssetsForFilter, fetchIpos]);

  useEffect(() => {
    if (!user?.id) return;
    const timer = setTimeout(() => {
      fetchMacro();
      fetchHealthAndSessions();
    }, 0);
    return () => clearTimeout(timer);
  }, [user?.id, fetchMacro, fetchHealthAndSessions]);

  useEffect(() => {
    if (!user?.id || !backendOffline) return;
    const timer = setInterval(() => {
      loadAssetsForFilter(selectedCountry, selectedCategory, true);
      fetchPortfolio();
      fetchMacro();
      fetchHealthAndSessions();
      fetchIpos(selectedCountry);
    }, 2500);
    return () => clearInterval(timer);
  }, [user?.id, backendOffline, selectedCountry, selectedCategory, loadAssetsForFilter, fetchPortfolio, fetchMacro, fetchHealthAndSessions, fetchIpos]);

  useEffect(() => {
    if (!user?.id || backendOffline || universeTotal >= 1000) return;
    const timer = setInterval(() => {
      fetchHealthAndSessions();
      loadAssetsForFilter(selectedCountry, selectedCategory, false);
    }, 4000);
    return () => clearInterval(timer);
  }, [user?.id, backendOffline, universeTotal, selectedCountry, selectedCategory, fetchHealthAndSessions, loadAssetsForFilter]);

  useEffect(() => {
    if (!user?.id) return;
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
                setIndexQuotes(data.all_prices);
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
  }, [user?.id]);

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
    const currToReg: Record<string, string> = {
      INR: "IND",
      USD: "USA",
      CAD: "CANADA",
      CNY: "CHINA",
      EUR: "EU",
      GBP: "EU",
    };
    const t = setTimeout(() => {
      if (user.base_currency) {
        setActiveCurrency(user.base_currency);
        if (currToReg[user.base_currency]) {
          pinnedSymbolRef.current = null;
          setSelectedCountry(currToReg[user.base_currency]);
        }
      }
      fetchPortfolio();
    }, 0);
    return () => clearTimeout(t);
  }, [user?.id, user?.base_currency, fetchPortfolio]);

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && selectedAsset?.symbol) {
      wsRef.current.send(JSON.stringify({ symbol: selectedAsset.symbol }));
    }
  }, [selectedAsset?.symbol]);

  useEffect(() => {
    if (!user?.id) return;
    const interval = setInterval(() => {
      fetchPortfolio();
      fetchHealthAndSessions();
      loadAssetsForFilter(selectedCountryRef.current, selectedCategoryRef.current, false);
    }, 10000);
    return () => clearInterval(interval);
  }, [user?.id, fetchPortfolio, fetchHealthAndSessions, loadAssetsForFilter]);

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

  const openSymbolEverywhere = async (
    symbol: string,
    overrideName?: string,
    overrideRegion?: string,
    fallbackMeta?: Partial<WatchlistAsset>
  ) => {
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
      if (targetRegion && ["IND", "USA", "CANADA", "CHINA", "EU", "CRYPTO", "FOREX"].includes(targetRegion) && targetRegion !== selectedCountryRef.current) {
        setSelectedCountry(targetRegion);
      }
    };

    const localMatch = assets.find((a) => a.symbol === symbol);
    if (localMatch && localMatch.price > 0) {
      applyAsset(overrideName ? { ...localMatch, name: overrideName } : localMatch);
      return;
    }

    // Immediately switch UI optimistically so searched symbol opens even before quote completes
    const optimisticAsset: WatchlistAsset = {
      symbol,
      name: overrideName || fallbackMeta?.name || localMatch?.name || symbol,
      region: overrideRegion || fallbackMeta?.region || localMatch?.region,
      country: overrideRegion || fallbackMeta?.country || localMatch?.country,
      category: fallbackMeta?.category || localMatch?.category || "stocks",
      currency: fallbackMeta?.currency || localMatch?.currency || "USD",
      exchange: fallbackMeta?.exchange || localMatch?.exchange || "Market",
      price: localMatch?.price || 0,
      prev_close: localMatch?.prev_close || 0,
      change: localMatch?.change || 0,
      change_percent: localMatch?.change_percent || 0,
      volume: localMatch?.volume || 0,
    };
    applyAsset(optimisticAsset);

    try {
      const res = await fetch(apiUrl(`/api/quote/${encodeURIComponent(symbol)}`));
      if (res.ok) {
        setBackendOffline(false);
        const fetched: WatchlistAsset = await res.json();
        const fullAsset: WatchlistAsset = { ...fetched, name: overrideName || fetched.name };
        if (selectedSymbolRef.current === symbol) {
          applyAsset(fullAsset);
        }
        setAssets((prev) => (prev.some((a) => a.symbol === fullAsset.symbol) ? prev : [fullAsset, ...prev]));
      }
    } catch {
      // keep optimistic selection; chart will still load /api/history/{symbol}
    }
  };

  const handleExecuteOrder = async (order: {
    symbol: string;
    quantity: number;
    order_type: "BUY" | "SELL";
    order_mode: "MARKET" | "LIMIT" | "STOP";
    product_type?: "DELIVERY" | "INTRADAY" | "FUTURES" | "OPTIONS";
    broker_plan?: "DISCOUNT" | "PRO";
    price?: number;
    stop_loss?: number;
    take_profit?: number;
    trailing_sl?: number;
    notes?: string;
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
      fetchPortfolio();
      showToast(false, data.detail || "Order execution failed");
      throw new Error(data.detail || "Order execution failed");
    }
  };

  const handleClosePosition = async (symbol: string, quantity: number, orderType: string, productType?: string) => {
    await handleExecuteOrder({
      symbol,
      quantity,
      order_type: orderType === "SHORT" ? "BUY" : "SELL",
      order_mode: "MARKET",
      product_type: (productType as "DELIVERY" | "INTRADAY" | "FUTURES" | "OPTIONS") || "DELIVERY",
    });
  };

  const handleCancelPending = async (orderId: string) => {
    const res = await authFetch(`/api/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
    if (res.ok) {
      fetchPortfolio();
      showToast(true, "Pending order cancelled.");
    }
  };

  const handleModifyPending = async (orderId: string, limitPrice: number, quantity: number) => {
    const res = await authFetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit_price: limitPrice, quantity }),
    });
    if (res.ok) {
      fetchPortfolio();
      showToast(true, "Pending order modified.");
    } else {
      const err = await res.json().catch(() => null);
      showToast(false, err?.detail || "Modify order failed");
    }
  };

  const handleUpdateRisk = async (positionId: string, sl: number | null, tp: number | null, tsl: number | null) => {
    const res = await authFetch(`/api/positions/${encodeURIComponent(positionId)}/risk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stop_loss: sl, take_profit: tp, trailing_sl: tsl }),
    });
    if (res.ok) {
      fetchPortfolio();
      showToast(true, "Position SL / Target / TSL updated.");
    } else {
      const err = await res.json().catch(() => null);
      showToast(false, err?.detail || "Risk update failed");
    }
  };

  const handleSquareOffAll = async (country?: string) => {
    const res = await authFetch("/api/positions/square-off-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: country || null }),
    });
    const d = await res.json().catch(() => null);
    if (res.ok) {
      fetchPortfolio();
      showToast(true, d?.message || "All positions squared off.");
    } else {
      showToast(false, d?.detail || "Square off failed");
    }
  };

  const handleReversePosition = async (positionId: string) => {
    const res = await authFetch(`/api/positions/${encodeURIComponent(positionId)}/reverse`, {
      method: "POST",
    });
    const d = await res.json().catch(() => null);
    if (res.ok) {
      fetchPortfolio();
      showToast(true, d?.message || `Position flipped to ${d?.new_side || "opposite side"}!`);
    } else {
      showToast(false, d?.detail || "Position reverse failed");
    }
  };

  const handlePlaceLadder = async (ladder: {
    symbol: string;
    total_quantity: number;
    order_type: "BUY" | "SELL";
    product_type?: "DELIVERY" | "INTRADAY" | "FUTURES" | "OPTIONS";
    broker_plan?: "DISCOUNT" | "PRO";
    price_start: number;
    price_end: number;
    rungs: number;
    stop_loss?: number;
    take_profit?: number;
    notes?: string;
  }): Promise<{ success: boolean; message: string }> => {
    const res = await authFetch("/api/orders/ladder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ladder),
    });
    const d = await res.json().catch(() => null);
    if (res.ok) {
      fetchPortfolio();
      const msg = d?.message || `Placed ${d?.rungs_placed || ladder.rungs} ladder rungs.`;
      showToast(true, msg);
      return { success: true, message: msg };
    }
    const errMsg = d?.detail || "Ladder order failed";
    showToast(false, errMsg);
    return { success: false, message: errMsg };
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!ev.altKey) return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (ev.key.toLowerCase() === "b" && selectedAsset) {
        ev.preventDefault();
        setOrderPreset({ symbol: selectedAsset.symbol, side: "BUY" });
        setRightTab("order");
      } else if (ev.key.toLowerCase() === "s" && selectedAsset) {
        ev.preventDefault();
        setOrderPreset({ symbol: selectedAsset.symbol, side: "SELL" });
        setRightTab("order");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedAsset]);

  const handleCopyPresetToOrder = (preset: OrderDraftPreset) => {
    setOrderPreset(preset);
    setRightTab("order");
    openSymbolEverywhere(preset.symbol);
  };

  const handleSharePositionToFeed = async (pos: Position) => {
    const res = await authFetch("/api/feed/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: pos.symbol,
        name: pos.name,
        country: pos.country,
        currency: pos.currency,
        direction: pos.order_type === "SHORT" ? "BEARISH" : "BULLISH",
        product_type: pos.product_type || "DELIVERY",
        entry_price: pos.avg_price,
        target_price: pos.take_profit,
        stop_loss: pos.stop_loss,
        timeframe: "1D",
        thesis: `Live paper position: ${pos.order_type} ${pos.quantity} ${pos.symbol} (${pos.product_type || "DELIVERY"}) @ ${pos.avg_price}. Current MTM: ${pos.pnl >= 0 ? "+" : ""}${pos.pnl} (${pos.pnl_percent}%).`,
      }),
    });
    if (res.ok) {
      showToast(true, `Shared ${pos.symbol} setup to FrontPage Feed!`);
      setActiveView("feed");
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
  const activeHealth = capitalHealth[activeCurrency];
  const anyCriticalHealth = Object.values(capitalHealth).find((h) => h.status !== "HEALTHY");
  const healthToWarn = activeHealth && activeHealth.status !== "HEALTHY" ? activeHealth : anyCriticalHealth;
  const currSymbol = getCurrencySymbol(activeCurrency);
  const searchListToDisplay =
    searchQuery.trim().length >= 1 || searchRegion !== "ALL" || searchCategory !== "all"
      ? searchResults
      : assets.slice(0, 20);

  if (authLoading) {
    return (
      <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-600 flex items-center justify-center animate-pulse">
          <Lock className="w-5 h-5 text-white" />
        </div>
        <div className="text-xs font-mono uppercase tracking-widest text-slate-400">
          Opening Local PC Trading Vault...
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#EBECEF] text-[#131722] select-none">
      {/* TradingView Exact Top Toolbar (38-40px fixed height) */}
      <header className="h-[40px] bg-[#FFFFFF] px-2 flex items-center justify-between gap-2 shrink-0 border-b border-[#E0E3EB] relative z-50">
        {/* Hamburger Menu + Scrollable Left Control Cluster */}
        <div className="flex items-center gap-0.5 min-w-0 flex-1">
          {/* Hamburger Menu + AGAM Badge (outside overflow container so dropdown is never clipped) */}
          <div className="relative shrink-0">
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
                  { id: "chart" as const, label: "Trade Terminal & Superchart", icon: Activity },
                  { id: "portfolio" as const, label: `FrontPage Portfolio (${positions.length})`, icon: Briefcase },
                  { id: "orders" as const, label: `Order Book & Receipts (${ordersHistory.length})`, icon: ListOrdered },
                  { id: "taxes" as const, label: "Country Taxes, Brokerage & Analytics", icon: Landmark },
                  { id: "feed" as const, label: "FrontPage Trade Ideas Feed", icon: Flame },
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
                    {(["IND", "USA", "CANADA", "CHINA", "EU", "CRYPTO", "FOREX"] as const).map((code) => {
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

          <div className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto scrollbar-none">
            {/* Symbol Search Trigger Pill (TradingView Style) */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search Symbols"
              title="Search Symbol Universe (Ctrl+K)"
              className="h-[28px] px-2 rounded-lg bg-[#F0F3FA] hover:bg-[#E0E3EB] text-[#131722] text-xs font-bold flex items-center gap-1.5 transition shrink-0"
            >
              <Search className="w-3.5 h-3.5 text-[#787B86] shrink-0" />
              <span className="font-mono max-w-[74px] sm:max-w-none truncate">{selectedAsset?.symbol || "SEARCH"}</span>
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
              className="h-[28px] appearance-none bg-transparent hover:bg-[#F0F3FA] rounded-lg pl-1.5 pr-4 text-xs font-semibold text-[#131722] outline-none cursor-pointer whitespace-nowrap"
            >
              <option value="candles">Candles</option>
              <option value="bar">OHLC Bars</option>
              <option value="line">Line</option>
              <option value="area">Area</option>
              <option value="heikin_ashi">Heikin-Ashi</option>
              <option value="renko">Renko</option>
              <option value="point_and_figure">Point &amp; Figure</option>
              <option value="kagi">Kagi</option>
              <option value="line_break">Line Break</option>
              <option value="range_bar">Range Bar</option>
              <option value="baseline">Baseline</option>
            </select>
            <ChevronDown className="w-3 h-3 text-[#787B86] pointer-events-none absolute right-0.5" />
          </div>

          <div className="h-5 w-[1px] bg-[#E0E3EB] mx-0.5 hidden lg:block shrink-0" />

          {/* fx Indicators */}
          <button
            type="button"
            onClick={() => {
              setActiveView("chart");
              setIndicatorsOpen(true);
            }}
            title={`Indicators & Strategies (${catalogCount})`}
            className="h-[28px] px-1.5 rounded-lg hover:bg-[#F0F3FA] text-[#131722] text-xs font-semibold flex items-center gap-1 transition shrink-0"
          >
            <FunctionSquare className="w-3.5 h-3.5 text-[#2962FF]" />
            <span className="hidden xl:inline">Indicators</span>
          </button>

          {/* Alert Trigger */}
          <button
            type="button"
            onClick={() => {
              setActiveView("chart");
              setRightTab("alerts");
            }}
            title="Price & RSI Alerts"
            aria-label="Price & RSI Alerts"
            className="h-[28px] px-1.5 rounded-lg hover:bg-[#F0F3FA] text-[#131722] text-xs font-semibold hidden 2xl:flex items-center gap-1 shrink-0 transition"
          >
            <Bell className="w-3.5 h-3.5 text-[#6A6D78]" />
            <span className="hidden 2xl:inline">Alert</span>
          </button>

          {/* Bar Replay Trigger */}
          <button
            type="button"
            onClick={() => {
              setActiveView("chart");
              setBottomTab("replay");
              setBottomOpen(true);
            }}
            title="Bar Replay Studio"
            aria-label="Bar Replay Studio"
            className="h-[28px] px-1.5 rounded-lg hover:bg-[#F0F3FA] text-[#131722] text-xs font-semibold hidden 2xl:flex items-center gap-1 shrink-0 transition"
          >
            <PlayCircle className="w-3.5 h-3.5 text-[#6A6D78]" />
            <span className="hidden 2xl:inline">Replay</span>
          </button>

          {/* 16x Layout Split */}
          <button
            type="button"
            onClick={() => setActiveView(activeView === "multichart" ? "chart" : "multichart")}
            aria-label="16-Chart Split Layout"
            title="16-Chart Split Workspace"
            className={`h-[28px] px-1.5 rounded-lg text-xs font-semibold hidden 2xl:flex items-center gap-1 shrink-0 transition ${
              activeView === "multichart" ? "bg-[#F0F3FA] text-[#2962FF]" : "text-[#131722] hover:bg-[#F0F3FA]"
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
          </div>
        </div>

        {/* Right Utility & Paper Wallet Cluster */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Live WS Status */}
          <span
            title={isWsConnected ? "WebSocket Live Feed Connected" : "Reconnecting WebSocket"}
            className={`hidden xl:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
              isWsConnected ? "text-[#089981] bg-[#E8F5E9]" : "text-[#787B86] bg-[#F0F3FA]"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isWsConnected ? "bg-[#089981] live-pulse" : "bg-[#9598A1]"}`} />
            <span className="hidden 2xl:inline">{isWsConnected ? "LIVE" : "SYNC"}</span>
          </span>

          {/* Market Hub Quick Selector (IND, USA, EU, CAN, CHN, CRYPTO, FOREX, ALL) */}
          <div className="relative inline-flex items-center shrink-0">
            <span className="pointer-events-none absolute left-2 flex items-center">
              <CountryFlag code={selectedCountry} className="w-3.5 h-2.5" />
            </span>
            <select
              aria-label="Select Market Region"
              value={selectedCountry}
              onChange={(e) => handleSelectCountry(e.target.value)}
              className="h-[28px] appearance-none bg-[#F8F9FD] hover:bg-[#F0F3FA] border border-[#E0E3EB] rounded-lg pl-7 pr-5 text-[11px] font-bold text-[#131722] outline-none cursor-pointer whitespace-nowrap"
            >
              <option value="IND">IND</option>
              <option value="USA">USA</option>
              <option value="EU">EU</option>
              <option value="CANADA">CAN</option>
              <option value="CHINA">CHN</option>
              <option value="CRYPTO">CRYPTO</option>
              <option value="FOREX">FOREX</option>
              <option value="ALL">ALL</option>
            </select>
            <ChevronDown className="w-3 h-3 text-[#787B86] pointer-events-none absolute right-1.5" />
          </div>

          {/* All-Wallets Quick Dropdown Pill */}
          <div className="relative shrink-0">
            <div className="h-[28px] bg-[#F0F3FA] rounded-lg px-2 flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setWalletMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 hover:text-[#2962FF] transition"
                title="View all multi-currency wallets & capital health"
              >
                <Wallet className="w-3.5 h-3.5 text-[#2962FF] shrink-0" />
                <span suppressHydrationWarning className="hidden sm:inline font-mono font-bold text-[#131722] tabular-nums whitespace-nowrap">
                  {currSymbol}{formatNumber(currentBalance, 2)}
                </span>
              </button>
              <span className="hidden sm:inline h-3.5 w-[1px] bg-[#D1D4DC]" />
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

            {walletMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-72 bg-[#FFFFFF] border border-[#E0E3EB] rounded-2xl shadow-2xl p-3 z-[85] space-y-2 text-xs">
                <div className="flex items-center justify-between border-b border-[#F0F3FA] pb-2">
                  <span className="font-black text-[#131722]">Multi-Currency Vaults</span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#E8F5E9] text-[#089981]">
                    Fixed Capital
                  </span>
                </div>
                <div className="space-y-1.5">
                  {(["INR", "USD", "EUR", "GBP", "CAD", "CNY"] as const).map((curr) => {
                    const detail = walletDetails[curr];
                    const h = capitalHealth[curr];
                    const bal = wallets[curr] ?? 0;
                    const sym = getCurrencySymbol(curr);
                    return (
                      <button
                        key={curr}
                        type="button"
                        onClick={() => {
                          setActiveCurrency(curr);
                          setWalletMenuOpen(false);
                        }}
                        className={`w-full px-2.5 py-1.5 rounded-xl border text-left flex items-center justify-between transition ${
                          activeCurrency === curr
                            ? "border-[#2962FF] bg-[#2962FF]/5"
                            : "border-[#E0E3EB] hover:bg-[#F8F9FD]"
                        }`}
                      >
                        <div>
                          <div className="font-bold text-[#131722] flex items-center gap-1.5">
                            <span>{curr}</span>
                            {h && h.status !== "HEALTHY" && (
                              <span className="text-[9px] px-1 rounded bg-[#FFEBEE] text-[#F23645]">{h.status}</span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-[#787B86]">
                            Margin: {sym}{formatNumber(detail?.margin_used ?? 0, 0, 0)}
                          </span>
                        </div>
                        <div className="text-right font-mono">
                          <span className="font-bold text-[#131722] block">{sym}{formatNumber(bal, 2)}</span>
                          <span className="text-[10px] text-[#787B86]">
                            Eq: {sym}{formatNumber(detail?.equity ?? bal, 0, 0)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setWalletMenuOpen(false);
                    setActiveView("portfolio");
                  }}
                  className="w-full py-1.5 rounded-xl bg-[#131722] hover:bg-[#2962FF] text-white font-bold text-[11px] transition"
                >
                  Open Full Portfolio Overview →
                </button>
              </div>
            )}
          </div>

          <span
            title="Fixed starting capital — wallet resets permanently disabled"
            className="h-[28px] px-2 rounded-lg bg-[#E8F5E9] text-[#089981] text-[10px] font-bold hidden 2xl:inline-flex items-center gap-1 shrink-0"
          >
            <Lock className="w-3 h-3" /> Fixed
          </span>

          <button
            type="button"
            onClick={() => setActivityOpen(true)}
            aria-label="Persistent Activity Audit Log"
            title="Local PC Persistent Audit Trail"
            className="h-[28px] px-1.5 rounded-lg bg-[#F8F9FD] hover:bg-[#F0F3FA] border border-[#E0E3EB] text-[#131722] text-[11px] font-bold hidden sm:inline-flex items-center gap-1 shrink-0 transition"
          >
            <ClipboardList className="w-3.5 h-3.5 text-[#2962FF]" />
            <span className="hidden 2xl:inline">Audit Log</span>
          </button>

          <button
            type="button"
            onClick={() => setDisclaimerOpen(true)}
            aria-label="Risk and Regulatory Disclaimers"
            title="View Risk, Leverage & Regulatory Disclaimers"
            className="h-[28px] px-1.5 rounded-lg bg-[#FFEBEE] hover:bg-[#F23645] text-[#F23645] hover:text-white text-[11px] font-bold inline-flex items-center gap-1 shrink-0 transition"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span className="hidden 2xl:inline">Risks</span>
          </button>

          {/* Overview / Superchart Primary Action Pill */}
          <button
            type="button"
            onClick={() => setActiveView(activeView === "overview" ? "chart" : "overview")}
            className="h-[28px] px-2 rounded-lg bg-[#131722] hover:bg-[#2962FF] text-white text-xs font-bold transition shrink-0"
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

          {/* Single-Owner PC Account Trigger */}
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            aria-label="Owner Vault Profile"
            title={`Signed in: ${user.email}`}
            className="h-[28px] px-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition shrink-0 bg-[#E8F5E9] text-[#089981]"
          >
            <User className="w-3.5 h-3.5" />
            <span className="hidden 2xl:inline max-w-[76px] truncate">
              {user.display_name || user.email.split("@")[0]}
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

      {/* FrontPage TradeLab Navigation & Live Country Index Bar */}
      <div className="h-[34px] bg-[#F8F9FD] border-b border-[#E0E3EB] px-2 sm:px-3 flex items-center justify-between gap-3 shrink-0 overflow-x-auto scrollbar-none">
        <nav aria-label="FrontPage Paper Trade Tabs" className="flex items-center gap-1 shrink-0">
          {(
            [
              { id: "chart" as const, label: "Trade", icon: Activity },
              { id: "portfolio" as const, label: `Portfolio (${positions.length})`, icon: Briefcase },
              { id: "orders" as const, label: `Orders (${pendingOrders.length + ordersHistory.length})`, icon: ListOrdered },
              { id: "taxes" as const, label: "Taxes & Charges", icon: Landmark },
              { id: "feed" as const, label: "Ideas Feed", icon: Flame },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = activeView === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveView(t.id)}
                className={`h-[26px] px-2.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition whitespace-nowrap ${
                  active
                    ? "bg-[#2962FF] text-white shadow-xs"
                    : "text-[#131722] hover:bg-[#E0E3EB]/70"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Live Active Market Tape & Session Strip */}
        <div className="hidden lg:flex items-center gap-2 text-[11px] font-mono min-w-0 overflow-x-auto scrollbar-none">
          <span className="text-[10px] font-sans font-bold text-[#787B86] uppercase inline-flex items-center gap-1.5 shrink-0">
            <CountryFlag code={selectedCountry === "ALL" ? "IND" : selectedCountry} />
            {selectedCountry === "CRYPTO" ? "Crypto 24/7:" : selectedCountry === "FOREX" ? "FX Pairs:" : "Indices:"}
          </span>
          {(COUNTRY_META[selectedCountry === "ALL" ? "IND" : selectedCountry] || COUNTRY_META.IND).indices.map((idxSym) => {
            const q = indexQuotes[idxSym];
            const bull = (q?.change_percent ?? 0) >= 0;
            const cleanLbl = idxSym
              .replace("^NSEI", "NIFTY 50")
              .replace("^BSESN", "SENSEX")
              .replace("^NSEBANK", "BANKNIFTY")
              .replace("^GSPC", "S&P 500")
              .replace("^IXIC", "NASDAQ")
              .replace("^DJI", "DOW")
              .replace("^GSPTSE", "TSX")
              .replace("000001.SS", "SSE")
              .replace("399001.SZ", "SZSE")
              .replace("^GDAXI", "DAX")
              .replace("^FTSE", "FTSE")
              .replace("^FCHI", "CAC40")
              .replace("BTC-USD", "BTC")
              .replace("ETH-USD", "ETH")
              .replace("SOL-USD", "SOL")
              .replace("BNB-USD", "BNB")
              .replace("EURUSD=X", "EUR/USD")
              .replace("GBPUSD=X", "GBP/USD")
              .replace("USDJPY=X", "USD/JPY")
              .replace("DX-Y.NYB", "DXY");
            const dec = idxSym.endsWith("=X") ? (idxSym.includes("JPY") ? 3 : 4) : 2;
            return (
              <button
                key={idxSym}
                type="button"
                onClick={() => openSymbolEverywhere(idxSym)}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#FFFFFF] border border-[#E0E3EB] hover:border-[#2962FF] transition tabular-nums shrink-0"
              >
                <span className="font-bold text-[#131722]">{cleanLbl}</span>
                <span className="text-[#131722]">{q?.price ? formatNumber(q.price, dec, dec) : "--"}</span>
                {q?.price ? (
                  <span className={bull ? "text-[#089981] font-bold" : "text-[#F23645] font-bold"}>
                    {bull ? "+" : ""}{q.change_percent.toFixed(2)}%
                  </span>
                ) : null}
              </button>
            );
          })}
          {sessions[selectedCountry === "ALL" ? "IND" : selectedCountry] && (
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 inline-flex items-center gap-1 ${
                sessions[selectedCountry === "ALL" ? "IND" : selectedCountry].open
                  ? "bg-[#E8F5E9] text-[#089981]"
                  : "bg-[#FFFFFF] border border-[#E0E3EB] text-[#787B86]"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  sessions[selectedCountry === "ALL" ? "IND" : selectedCountry].open ? "bg-[#089981] live-pulse" : "bg-[#9598A1]"
                }`}
              />
              {sessions[selectedCountry === "ALL" ? "IND" : selectedCountry].status} ·{" "}
              {sessions[selectedCountry === "ALL" ? "IND" : selectedCountry].local_time}
            </span>
          )}
        </div>
      </div>

      {/* Progressive Low Capital Warning Strip (Fires <30%, <15%, <5%) */}
      {healthToWarn && (
        <div
          className={`px-3 py-1.5 text-[11px] font-bold flex items-center justify-between gap-2 shrink-0 border-b ${
            healthToWarn.status === "EXHAUSTED" || healthToWarn.status === "CRITICAL"
              ? "bg-[#FFEBEE] border-[#F23645]/30 text-[#B71C1C]"
              : "bg-amber-50 border-amber-300 text-amber-900"
          }`}
        >
          <span className="flex items-center gap-1.5 truncate">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{healthToWarn.warning_message}</span>
          </span>
          <button
            type="button"
            onClick={() => setActiveView("portfolio")}
            className="px-2 py-0.5 rounded bg-white/80 hover:bg-white text-[10px] font-extrabold shrink-0"
          >
            Inspect Capital →
          </button>
        </div>
      )}

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
            <div className="flex-1 min-w-0 min-h-0 overflow-hidden relative z-10 flex flex-col">
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
                openPositions={positions}
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
            </div>

            <BottomTerminalDrawer
              isOpen={bottomOpen}
              isExpanded={bottomExpanded}
              onToggleOpen={() => setBottomOpen((o) => !o)}
              onToggleExpand={() => setBottomExpanded((e) => !e)}
              activeTab={bottomTab}
              onSelectTab={setBottomTab}
              selectedSymbol={selectedAsset?.symbol || "RELIANCE.NS"}
              activeCurrency={activeCurrency}
              walletBalance={currentBalance}
              positions={positions}
              pendingOrders={pendingOrders}
              ordersHistory={ordersHistory}
              rejectedOrders={rejectedOrders}
              onClosePosition={handleClosePosition}
              onReversePosition={handleReversePosition}
              onCancelPending={handleCancelPending}
              onSquareOffAll={() => handleSquareOffAll(undefined)}
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
            onSelectCategory={handleSelectCategorySafe}
            assets={assets}
            selectedAsset={selectedAsset}
            onSelectSymbol={(sym, nm) => {
              setOrderPreset(null);
              openSymbolEverywhere(sym, nm);
            }}
            onQuickTradeFromWatchlist={(asset, side) => {
              setOrderPreset({ symbol: asset.symbol, side });
              setRightTab("order");
              openSymbolEverywhere(asset.symbol, asset.name);
            }}
            onOpenSearch={() => setSearchOpen(true)}
            wallets={wallets}
            capitalHealth={capitalHealth}
            orderPreset={orderPreset}
            onExecuteOrder={handleExecuteOrder}
            onPlaceLadder={handlePlaceLadder}
            latestNewsAlert={latestNewsAlert}
            isMarketOpen={activeSession?.open}
            onOpenOverview={() => setActiveView("overview")}
            onOpenIpos={() => setActiveView("ipos")}
            onOpenMacro={() => setActiveView("macro")}
          />
        </div>
      )}

      {activeView === "portfolio" && (
        <div className="flex-1 min-h-0 overflow-y-auto bg-[#F8F9FD] p-4">
          <div className="max-w-[1440px] mx-auto">
            <FrontPagePortfolio
              selectedCountry={selectedCountry}
              onSelectCountry={handleSelectCountry}
              wallets={wallets}
              walletDetails={walletDetails}
              capitalHealth={capitalHealth}
              positions={positions}
              closedTrades={closedTrades}
              taxSummaryByCountry={taxSummaryByCountry}
              analyticsByCountry={analyticsByCountry}
              onClosePosition={handleClosePosition}
              onReversePosition={handleReversePosition}
              onSquareOffAll={handleSquareOffAll}
              onUpdateRisk={handleUpdateRisk}
              onOpenSymbol={(sym) => openSymbolEverywhere(sym)}
              onShareIdea={handleSharePositionToFeed}
            />
          </div>
        </div>
      )}

      {activeView === "orders" && (
        <div className="flex-1 min-h-0 overflow-y-auto bg-[#F8F9FD] p-4">
          <div className="max-w-[1440px] mx-auto">
            <FrontPageOrders
              selectedCountry={selectedCountry}
              pendingOrders={pendingOrders}
              ordersHistory={ordersHistory}
              rejectedOrders={rejectedOrders}
              onCancelPending={handleCancelPending}
              onModifyPending={handleModifyPending}
              onOpenSymbol={(sym) => openSymbolEverywhere(sym)}
            />
          </div>
        </div>
      )}

      {activeView === "taxes" && (
        <div className="flex-1 min-h-0 overflow-y-auto bg-[#F8F9FD] p-4">
          <div className="max-w-[1440px] mx-auto">
            <FrontPageTaxCenter
              selectedCountry={selectedCountry}
              taxSummaryByCountry={taxSummaryByCountry}
              analyticsByCountry={analyticsByCountry}
            />
          </div>
        </div>
      )}

      {activeView === "feed" && (
        <div className="flex-1 min-h-0 overflow-y-auto bg-[#F8F9FD] p-4">
          <div className="max-w-[1280px] mx-auto">
            <FrontPageFeed
              selectedCountry={selectedCountry}
              activeSymbol={selectedAsset?.symbol}
              activeSymbolName={selectedAsset?.name}
              activePrice={selectedAsset?.price}
              activeCurrency={selectedAsset?.currency}
              onCopyToPaperTrade={handleCopyPresetToOrder}
              onOpenSymbol={(sym) => openSymbolEverywhere(sym)}
            />
          </div>
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
              loading={iposLoading}
              error={iposError}
              onRetry={() => fetchIpos(selectedCountry)}
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
                placeholder="Type ticker, coin, FX pair, company, or ISIN (e.g. BTC-USD, EURUSD, AAPL, RELIANCE)..."
                className="flex-1 bg-transparent text-sm text-[#131722] placeholder-[#787B86] outline-none"
              />
            </div>

            <div className="px-4 py-2 border-b border-[#E0E3EB] flex flex-wrap items-center gap-1.5 text-xs">
              {(["ALL", "IND", "USA", "EU", "CANADA", "CHINA", "CRYPTO", "FOREX"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSearchRegion(r)}
                  className={`px-2.5 py-1 rounded-full font-semibold inline-flex items-center gap-1 transition ${
                    searchRegion === r ? "bg-[#131722] text-white" : "bg-[#F0F3FA] text-[#787B86] hover:text-[#131722]"
                  }`}
                >
                  {r !== "ALL" && <CountryFlag code={r} className="w-3 h-2" />}
                  <span>{r}</span>
                </button>
              ))}
              <span className="text-[#E0E3EB] mx-1">|</span>
              {(["all", "stocks", "etfs", "indices", "commodities", "crypto", "forex", "bonds"] as const).map((c) => (
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
                  onClick={() =>
                    openSymbolEverywhere(res.symbol, res.name, res.region, {
                      exchange: res.exchange,
                      currency: res.currency,
                      category: res.category,
                      region: res.region,
                    })
                  }
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

      <footer className="h-[24px] px-3 bg-[#FFFFFF] border-t border-[#E0E3EB] flex items-center justify-between gap-3 text-[10px] text-[#787B86] shrink-0">
        <div className="flex items-center gap-3 min-w-0 truncate">
          <span className="inline-flex items-center gap-1 font-semibold text-[#131722]">
            <Database className="w-3 h-3 text-[#089981]" /> Local PC Vault (Multi-Profile)
          </span>
          <span className="hidden sm:inline">Fixed Starting Capital · Resets Disabled</span>
          <button
            type="button"
            onClick={() => setActivityOpen(true)}
            className="text-[#2962FF] font-bold hover:underline"
          >
            Activity Audit Log
          </button>
        </div>
        <button
          type="button"
          onClick={() => setDisclaimerOpen(true)}
          className="text-[#F23645] font-bold hover:underline truncate"
        >
          Educational Simulation · View Risk, Leverage &amp; Statutory Tax Disclaimers
        </button>
      </footer>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={fetchPortfolio}
        onOpenDisclaimer={() => setDisclaimerOpen(true)}
        onOpenActivityLog={() => setActivityOpen(true)}
      />

      <RiskDisclaimerModal open={disclaimerOpen} onClose={() => setDisclaimerOpen(false)} />
      <ActivityLogPanel open={activityOpen} onClose={() => setActivityOpen(false)} />
    </div>
  );
}
