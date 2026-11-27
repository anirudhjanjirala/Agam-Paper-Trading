// SSR-safe number, currency & compact large-number formatters (B/T/M & Lakhs/Crores)

export function formatNumber(val: number | undefined | null, minDecimals = 2, maxDecimals?: number): string {
  if (val === undefined || val === null || isNaN(val)) return "0.00";
  const minD = Math.max(0, Math.min(20, Math.floor(minDecimals)));
  const maxD = Math.max(minD, Math.min(20, Math.floor(maxDecimals ?? minD)));
  return Number(val).toLocaleString("en-US", {
    minimumFractionDigits: minD,
    maximumFractionDigits: maxD,
  });
}

export function getCurrencySymbol(currency: string | undefined): string {
  switch (currency) {
    case "INR":
      return "₹";
    case "USD":
      return "$";
    case "CAD":
      return "C$";
    case "CNY":
    case "RMB":
      return "¥";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "GBp":
      return "p ";
    case "JPY":
      return "¥";
    case "KRW":
      return "₩";
    case "PERCENT":
      return "";
    default:
      return "$";
  }
}

export function formatAssetPrice(val: number | undefined | null, currency: string | undefined): string {
  if (val === undefined || val === null || isNaN(val)) return "--";
  const decimals = val !== 0 && Math.abs(val) < 10 ? 4 : 2;
  const formatted = formatNumber(val, decimals, decimals);
  if (currency === "PERCENT") return `${formatted}%`;
  if (currency === "GBp") return `${formatted}p`;
  return `${getCurrencySymbol(currency)}${formatted}`;
}

export function formatMoney(val: number | undefined | null, currency: string | undefined): string {
  if (val === undefined || val === null || isNaN(val)) return "--";
  const formatted = formatNumber(val, 2, 2);
  if (currency === "PERCENT") return `${formatted}%`;
  if (currency === "GBp") return `${formatted}p`;
  return `${getCurrencySymbol(currency)}${formatted}`;
}

export function formatCompactCurrency(val: number | undefined | null, currency: string = "USD"): string {
  if (val === undefined || val === null || isNaN(val)) return "--";
  const sym = getCurrencySymbol(currency);
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";

  if (currency === "INR") {
    if (abs >= 1e7) return `${sign}${sym}${formatNumber(abs / 1e7, 2, 2)} Cr`;
    if (abs >= 1e5) return `${sign}${sym}${formatNumber(abs / 1e5, 2, 2)} L`;
    return `${sign}${sym}${formatNumber(abs, 2, 2)}`;
  }

  if (abs >= 1e12) return `${sign}${sym}${formatNumber(abs / 1e12, 2, 2)}T`;
  if (abs >= 1e9) return `${sign}${sym}${formatNumber(abs / 1e9, 2, 2)}B`;
  if (abs >= 1e6) return `${sign}${sym}${formatNumber(abs / 1e6, 2, 2)}M`;
  if (abs >= 1e3) return `${sign}${sym}${formatNumber(abs / 1e3, 2, 2)}K`;
  return `${sign}${sym}${formatNumber(abs, 2, 2)}`;
}

export function dedupeAscByTime<T extends { time: string | number }>(items: T[]): T[] {
  const map = new Map<string, { sortKey: number | string; item: T }>();
  for (const item of items) {
    const t = item.time;
    const k = String(t);
    const sortKey = typeof t === "number" ? t : Date.parse(t) || t;
    map.set(k, { sortKey, item });
  }
  return Array.from(map.values())
    .sort((a, b) =>
      typeof a.sortKey === "number" && typeof b.sortKey === "number"
        ? a.sortKey - b.sortKey
        : String(a.sortKey).localeCompare(String(b.sortKey))
    )
    .map((entry) => entry.item);
}
