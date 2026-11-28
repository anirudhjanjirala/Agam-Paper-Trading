# Changelog — Agam Paper Trading Platform

All chronological releases, architectural upgrades, security hardening changes, UI improvements, and bug fixes across the repository history.

---

## v4.0.0 — Complete Crypto & Forex Markets, Institutional Quant Workbench & UI/UX Polish

### Added
- **24/7 Cryptocurrency & Global Forex Markets** ([universe_loader.py](backend/core/universe_loader.py), [tax_brokerage.py](backend/core/tax_brokerage.py), [google_finance.py](backend/engine/google_finance.py), [paper_wallets.py](backend/core/paper_wallets.py)):
  - Expanded global coverage to **40,808 instruments** across **7 markets** (`USA`, `IND`, `CHINA`, `EU`, `CANADA`, `CRYPTO`, `FOREX`) including **1,023+ Crypto tokens** (`24/7 LIVE`) and **66+ Forex pairs** (`G10 Majors`, crosses, exotics, `DX-Y.NYB`).
  - Added fractional Crypto execution (`0.00001+` units), `20x` Forex margin with pip value (`$/pip`) & lot presets (`0.01`–`1.00`), Crypto Spot/Perp fee schedules, ECN Forex commissions, and automated FX quote-to-settlement USD scaling (`compute_fx_quote_to_settle`).
- **Vectorized Strategy Backtester Lab** ([BacktestLab.tsx](frontend/src/components/BacktestLab.tsx), [quant_engine.py](backend/core/quant_engine.py), `POST /api/backtest`):
  - Backtest 5 strategies (`EMA Cross`, `Supertrend`, `RSI Reversion`, `MACD Momentum`, `BB Breakout`) with Equity vs. Buy & Hold chart, Sharpe Ratio, Max Drawdown %, Win Rate, Profit Factor, fee bps, and Simulated Trade Log.
- **Multi-Timeframe Technical Signal Scorecard & Pivot Engine** (`GET /api/asset/{symbol}/technicals`, [RightSidebar.tsx](frontend/src/components/tv/RightSidebar.tsx)):
  - Real-time `15m / 1h / 4h / 1d` consensus badges, BUY/NEUTRAL/SELL tally, overall rating (`STRONG BUY`–`STRONG SELL`), Classic & Fibonacci pivots (`S1 / P / R1`), and ATR.
- **Scaled Limit Ladder Orders, Atomic Position `Flip` & `50%` Trim** ([OrderDrawer.tsx](frontend/src/components/OrderDrawer.tsx), [PositionsTable.tsx](frontend/src/components/PositionsTable.tsx), [FrontPagePortfolio.tsx](frontend/src/components/frontpage/FrontPagePortfolio.tsx), [tenant_store.py](backend/core/tenant_store.py)):
  - Added `LADDER` entry mode (`2–8` staggered rungs with per-rung `R1..Rn` badge previews via `POST /api/orders/ladder`), 1-click atomic Long <-> Short position reversal (`POST /api/positions/{id}/reverse`), fractional-safe `50%` Trim, Chart PNG Snapshot export, and `Alt+B`/`Alt+S` trading hotkeys.
- **Institutional Risk & Exposure Analytics Desk** (`GET /api/portfolio/risk-analytics`, [FrontPagePortfolio.tsx](frontend/src/components/frontpage/FrontPagePortfolio.tsx)):
  - Real-time Total Global Equity USD, Margin Utilization %, Portfolio Heat % (stop-loss risk), Long/Short/Net Exposure, Profit Factor, Expectancy/Trade, and Max Drawdown %.

### Fixed
- **Screener FOREX Tier Ordering & FX Price Formatting** ([screener_engine.py](backend/core/screener_engine.py), [format.ts](frontend/src/lib/format.ts)): Prioritized `FX_MAJOR` and `CRYPTO_MAJOR` tiers during default volume scans so zero-volume Yahoo Spot FX pairs aren't sorted below synthetic exotics; removed erroneous `$` prefixes on non-INR FX quote displays (`159.555 JPY`).
- **Micro-Cap & FX Quant/Tick Precision** ([quant_engine.py](backend/core/quant_engine.py), [tick_aggregator.py](backend/core/tick_aggregator.py), [OrderFlowSuite.tsx](frontend/src/components/OrderFlowSuite.tsx), [quantWorker.ts](frontend/src/workers/quantWorker.ts)): Added adaptive decimal precision (up to 8 decimals), `float` tick/bar volumes, Wilder Supertrend band ratcheting, and dynamic `POC`/`TPO`/`Footprint` bucketing.
- **UI/UX, Dark Mode & React 19 Fixes**: Fixed white initial canvas on Dark-Mode [MultiChartWorkspace.tsx](frontend/src/components/MultiChartWorkspace.tsx), `BacktestLab` delayed `chartEl` mount lifecycle, Dark-Mode MTF signal pill contrast in [RightSidebar.tsx](frontend/src/components/tv/RightSidebar.tsx), `Pending` order double-click Cancel race in [PositionsTable.tsx](frontend/src/components/PositionsTable.tsx), compact drawer tab spacing in [BottomTerminalDrawer.tsx](frontend/src/components/tv/BottomTerminalDrawer.tsx), Windows emoji flag replacement in [IpoCardList.tsx](frontend/src/components/IpoCardList.tsx), and FX settlement scaling on rejected/modified pending orders in [tenant_store.py](backend/core/tenant_store.py).

---

## v3.0.0 — Chart Styles Parity, Listing-Start History, Isolated Drawings & Security/UI Hardening

### Added
- **10 Complete Chart Types** ([page.tsx](frontend/src/app/page.tsx), [TradingViewChart.tsx](frontend/src/components/TradingViewChart.tsx), [chartSeriesPlugins.ts](frontend/src/components/chartSeriesPlugins.ts), [main.py](backend/main.py)):
  - Added native `BarSeries` for **Bar Chart (OHLC)** and custom Lightweight Charts v5 `ICustomSeriesPaneView` HTML5 canvas renderers (`KagiSeriesPaneView` and `PointAndFigurePaneView`) for **Kagi** (`Yang`/`Yin`) and **Point & Figure** (`X`/`O` columns).
  - Added backend OHLCV transformation pipelines (`_to_line_break`, `_to_range_bars`, `_to_kagi`, `_to_point_and_figure`) and refined `_to_renko` with strictly ascending unique bar timestamps (`_assign_unique_bar_times`).
  - Exposed all 10 requested chart styles (+ Baseline) in the header dropdown: **Line Chart**, **Bar Chart (OHLC)**, **Candlestick Chart**, **Heikin-Ashi Chart**, **Renko Chart**, **Point & Figure Chart**, **Area Chart**, **Kagi Chart**, **Line Break Chart**, **Range Bar Chart**, and **Baseline Chart**.
- **Line Weights (`1px`–`4px`) & Symbol-Isolated Drawings** ([TradingViewChart.tsx](frontend/src/components/TradingViewChart.tsx)):
  - Added `lineWeight` (`1 | 2 | 3 | 4` px) selector buttons to the left Drawing Dock and applied `strokeWidth={d.weight || 2}` across all drawn SVG Trend Lines, Horizontal Rays, Parallel Channels, Fibonacci Retracements, and Long/Short Position Rulers.
  - Replaced single shared `drawings` state (`layout_name="default"`) with symbol-keyed `drawingsBySymbol[symbol]` / `redoBySymbol[symbol]` backed by `chart:<symbol>` layouts so lines drawn on one stock never leak onto other stocks.
- **Full Historical Data From Listing Start** ([google_finance.py](backend/engine/google_finance.py), [TradingViewChart.tsx](frontend/src/components/TradingViewChart.tsx)):
  - Updated `_fetch_yahoo_chart_sync` to pass `period1=0&period2={now}` when `rng == "max"` (and explicit date windows for `5y`/`2y`) instead of coarsened `range=max` (~170–370 bars), using a consistent cookie session `User-Agent`.
  - Extended `_fetch_nasdaq_history_sync` `"max"` lookback to `20000` days (`limit=99999`) and prioritized full listing-start endpoints for `5y`/`max`.
  - Set initial `rangePreset` default to `"ALL"` (`period="max"`), loading deep history (e.g. `RELIANCE.NS` back to `1996-01-01`, `AAPL` back to `1980-12-12`, `SHOP.TO` back to `2015-05-21`).
- **Search Punctuation & Empty IPO Handling**:
  - Updated [universe_loader.py](backend/core/universe_loader.py) with fallback normalized token matching for queries containing punctuation/suffixes (e.g., `"E.I.D.-Parry (India) Ltd"`).
  - Updated [IpoCardList.tsx](frontend/src/components/IpoCardList.tsx) and [page.tsx](frontend/src/app/page.tsx) with explicit `loading`, `error`, and `onRetry` states so empty or failed `/api/ipos` responses show retry/empty messages instead of staying stuck on `"Loading live IPO filings..."`.
  - Added `cleanUrl` sanitization in [api.ts](frontend/src/lib/api.ts) and `--no-browser` flag in [start_agam.py](start_agam.py).

### Fixed (UI, Hydration, Security & Correctness)
- **React `#418` Hydration Mismatch**: Replaced `window.localStorage` `useState` initializer in [ThemeProvider.tsx](frontend/src/components/ThemeProvider.tsx) with `useSyncExternalStore` (`"light"` SSR/initial hydration snapshot + safe client sync) and deferred mobile drawer collapse in [page.tsx](frontend/src/app/page.tsx) to post-mount `useEffect`.
- **Mobile (`390×844`) Layout & Header Overlap**: Converted [RightSidebar.tsx](frontend/src/components/tv/RightSidebar.tsx) into a fixed overlay drawer below `md`, narrowed the mobile drawing toolbar in [TradingViewChart.tsx](frontend/src/components/TradingViewChart.tsx), auto-collapsed right panels below `768px`, and placed left header controls inside a horizontal scroll strip (`overflow-x-auto scrollbar-none`) so controls never overlap on narrow screens.
- **JWT Secret & Production Credentials**: Replaced hardcoded fallback secret in [auth.py](backend/core/auth.py) with `_load_jwt_secret()` (enforces `len >= 32` env secret in production; uses gitignored random `.agam_jwt_secret` in local dev), updated [.gitignore](.gitignore), removed default `agam_prod_password` fallbacks from [docker-compose.prod.yml](docker-compose.prod.yml) and `.env.production.example`.
- **CORS Hardening**: Removed broad `^https://.*\.vercel\.app$` wildcard from `allow_origin_regex` in [main.py](backend/main.py); production origins are explicitly allow-listed via `CORS_ORIGINS` / `FRONTEND_URL`.
- **Long-Side Partial Sell Realized P&L**: Updated `TenantPortfolioService._execute_fill` and `get_snapshot` in [tenant_store.py](backend/core/tenant_store.py) to accumulate `realized_pnl` on long-side partial exits (`SELL` against `BUY` positions).
- **NumPy RSI Warning**: Replaced `avg_g / avg_l` with masked `np.divide(..., out=np.full_like(..., 100.0), where=avg_l > 0)` in [quant_engine.py](backend/core/quant_engine.py) to eliminate `RuntimeWarning: divide by zero`.

---

## v2.0.0 (`d70306d`) — Multi-Tenant Isolation, Dual-Theme Engine & Cloud Manifests

- Added multi-tenant SQLAlchemy + PostgreSQL/SQLite data isolation ([auth.py](backend/core/auth.py), [database.py](backend/core/database.py), [models.py](backend/core/models.py), [tenant_store.py](backend/core/tenant_store.py), [ws_hub.py](backend/core/ws_hub.py), [001_multi_tenant_schema.sql](backend/migrations/001_multi_tenant_schema.sql)) with `WHERE user_id = current_user.id` scoping across wallets, orders, positions, layouts, watchlists, and alerts.
- Added JWT HTTP-only cookie authentication + guest workspace provisioning and [AuthModal.tsx](frontend/src/components/AuthModal.tsx) / [AuthProvider.tsx](frontend/src/components/AuthProvider.tsx).
- Added instant zero-flicker Dual-Theme Engine (`#FFFFFF` Light / `#0B0E14` Dark) across CSS variables and Lightweight Charts via [ThemeProvider.tsx](frontend/src/components/ThemeProvider.tsx).
- Committed complete Next.js 16 / React 19 / Tailwind v4 frontend (`Superchart`, `FinancialsOverview`, `MultiChartWorkspace`, `ScreenerPanel`, `OrderFlowSuite`, `BarReplayPanel`, Web Worker quant calculation, custom `agam-logo.svg`) and Docker/Nginx production files ([docker-compose.prod.yml](docker-compose.prod.yml), [nginx/nginx.conf](nginx/nginx.conf)).

---

## v1.0.0 (`87b170c`) — Initial Open-Source Release

- Released core FastAPI market data & analytics backend (`main.py`, `google_finance.py`, `google_news.py`, `universe_loader.py`, `quant_engine.py`, `screener_engine.py`, `replay_engine.py`, `tick_aggregator.py`, `alert_engine.py`, `fundamentals.py`, `paper_wallets.py`) covering 5 global regions (`IND`, `USA`, `CANADA`, `CHINA`, `EU`) with zero `yfinance` or paid API keys.
- Added single-terminal launcher (`start_agam.py`, `start_all.bat`), MIT `LICENSE`, open-source `README.md` with initial screenshots, and zero third-party chart branding (`attributionLogo: false`).
