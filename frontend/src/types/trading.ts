export interface TaxLineItem {
  label: string;
  amount: number;
  rate: string;
}

export interface ChargeBreakdown {
  country: string;
  sub_jurisdiction: string;
  exchange: string;
  currency: string;
  side: string;
  product_type: string;
  broker_plan: string;
  category: string;
  quantity: number;
  price: number;
  notional: number;
  margin_required: number;
  leverage: number;
  brokerage: number;
  stt_or_ftt: number;
  stamp_duty: number;
  exchange_fee: number;
  regulator_fee: number;
  gst_vat: number;
  dp_or_clearing_fee: number;
  total_charges: number;
  net_cash_impact: number;
  effective_rate_pct: number;
  breakeven_delta: number;
  tax_notes: string[];
  line_items: TaxLineItem[];
}

export interface Position {
  id: string;
  symbol: string;
  name: string;
  country?: string;
  exchange?: string;
  product_type?: string;
  leverage?: number;
  margin_blocked?: number;
  quantity: number;
  avg_price: number;
  current_price: number;
  currency: string;
  order_type: string;
  stop_loss?: number | null;
  take_profit?: number | null;
  trailing_sl?: number | null;
  highest_price?: number | null;
  lowest_price?: number | null;
  entry_charges?: number;
  est_exit_charges?: number;
  pnl: number;
  net_pnl?: number;
  pnl_percent: number;
  realized_pnl?: number;
  opened_at?: string;
}

export interface PendingOrder {
  id: string;
  symbol: string;
  name: string;
  country?: string;
  exchange?: string;
  currency: string;
  quantity: number;
  order_type: string;
  order_mode?: string;
  product_type?: string;
  limit_price: number;
  stop_loss?: number | null;
  take_profit?: number | null;
  trailing_sl?: number | null;
  created_at: string;
}

export interface OrderHistoryItem {
  id: string;
  symbol: string;
  name?: string;
  country?: string;
  exchange?: string;
  type: string;
  order_mode?: string;
  product_type?: string;
  broker_plan?: string;
  quantity: number;
  price: number;
  limit_price?: number | null;
  currency: string;
  gross_amount?: number;
  charges: number;
  brokerage?: number;
  stt_or_ftt?: number;
  stamp_duty?: number;
  exchange_fee?: number;
  regulator_fee?: number;
  gst_vat?: number;
  dp_or_clearing_fee?: number;
  realized_pnl?: number;
  net_pnl?: number;
  line_items?: TaxLineItem[];
  tax_notes?: string[];
  reject_reason?: string;
  notes?: string;
  status: string;
  timestamp: string;
  created_at?: string;
}

export interface ClosedTradeItem {
  id: string;
  symbol: string;
  name: string;
  country: string;
  exchange: string;
  currency: string;
  product_type: string;
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number;
  gross_pnl: number;
  entry_charges: number;
  exit_charges: number;
  total_charges: number;
  net_pnl: number;
  est_tax: number;
  pnl_percent: number;
  journal_note: string;
  opened_at: string;
  closed_at: string;
  closed_time: string;
}

export interface WalletDetail {
  currency: string;
  balance: number;
  equity: number;
  margin_used: number;
  unrealized_pnl: number;
}

export interface CapitalHealthEntry {
  currency: string;
  country: string;
  starting_capital: number;
  balance: number;
  equity: number;
  cash_pct: number;
  equity_pct: number;
  drawdown_pct: number;
  status: "HEALTHY" | "WARNING" | "CRITICAL" | "EXHAUSTED" | string;
  warning_message: string;
}

export interface ActivityLogItem {
  id: string;
  category: string;
  action: string;
  symbol: string;
  details: string;
  created_at: string;
  time_str: string;
}

export interface PortfolioSnapshot {
  user_id?: string;
  wallets: Record<string, number>;
  wallet_details?: Record<string, WalletDetail>;
  capital_health?: Record<string, CapitalHealthEntry>;
  positions: Position[];
  pending_orders: PendingOrder[];
  orders_history: OrderHistoryItem[];
  rejected_orders?: OrderHistoryItem[];
  closed_trades?: ClosedTradeItem[];
  tax_summary_by_country?: Record<string, CountryTaxSummary>;
  analytics_by_country?: Record<string, CountryAnalytics>;
  total_unrealized_pnl: number;
}

export interface CountryTaxSummary {
  country: string;
  currency: string;
  orders_count: number;
  turnover: number;
  brokerage: number;
  stt_or_ftt: number;
  stamp_duty: number;
  exchange_fee: number;
  regulator_fee: number;
  gst_vat: number;
  dp_or_clearing_fee: number;
  total_charges: number;
  gross_realized_pnl: number;
  net_realized_pnl: number;
  est_cap_gains_tax: number;
  net_after_tax_pnl: number;
}

export interface CountryAnalytics {
  country: string;
  currency: string;
  closed_count: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  gross_pnl: number;
  total_charges: number;
  net_pnl: number;
  avg_win: number;
  avg_loss: number;
  best_trade: number;
  worst_trade: number;
  profit_factor: number;
}

export interface TradeIdea {
  id: string;
  author_name: string;
  symbol: string;
  name: string;
  country: string;
  currency: string;
  direction: "BULLISH" | "BEARISH";
  product_type: string;
  entry_price: number;
  current_price: number;
  change_since_idea_pct: number;
  target_price?: number | null;
  stop_loss?: number | null;
  timeframe: string;
  thesis: string;
  likes_count: number;
  created_at: string;
  created_time: string;
}

export interface OrderDraftPreset {
  symbol: string;
  side?: "BUY" | "SELL";
  product_type?: "DELIVERY" | "INTRADAY" | "FUTURES" | "OPTIONS";
  stop_loss?: number | null;
  take_profit?: number | null;
}

export interface CountryMeta {
  code: string;
  label: string;
  short: string;
  flag: string;
  currency: string;
  indices: string[];
}

export const COUNTRY_META: Record<string, CountryMeta> = {
  IND: { code: "IND", label: "India (NSE / BSE)", short: "IND", flag: "🇮🇳", currency: "INR", indices: ["^NSEI", "^BSESN", "^NSEBANK"] },
  USA: { code: "USA", label: "USA (NASDAQ / NYSE)", short: "USA", flag: "🇺🇸", currency: "USD", indices: ["^GSPC", "^IXIC", "^DJI"] },
  CANADA: { code: "CANADA", label: "Canada (TSX / TSXV)", short: "CAN", flag: "🇨🇦", currency: "CAD", indices: ["^GSPTSE", "XIU.TO", "USDCAD=X"] },
  CHINA: { code: "CHINA", label: "China (SSE / SZSE)", short: "CHN", flag: "🇨🇳", currency: "CNY", indices: ["000001.SS", "399001.SZ", "510300.SS"] },
  EU: { code: "EU", label: "Europe & UK (LSE / XETRA / Euronext)", short: "EU", flag: "🇪🇺", currency: "EUR", indices: ["^GDAXI", "^FTSE", "^FCHI"] },
  CRYPTO: { code: "CRYPTO", label: "Crypto Spot & Perps (24/7)", short: "CRYPTO", flag: "₿", currency: "USD", indices: ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD"] },
  FOREX: { code: "FOREX", label: "Global Forex (Majors & Minors)", short: "FOREX", flag: "FX", currency: "USD", indices: ["EURUSD=X", "GBPUSD=X", "USDJPY=X", "DX-Y.NYB"] },
};
