const DEFAULT_HTTP = "http://127.0.0.1:8000";

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || DEFAULT_HTTP).replace(/\/+$/, "");

export const WS_BASE_URL = (
  process.env.NEXT_PUBLIC_WS_URL ||
  API_BASE_URL.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
).replace(/\/+$/, "");

const TOKEN_STORAGE_KEY = "agam_access_token";

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

export function wsUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${WS_BASE_URL}${normalized}`;
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const tok = getStoredToken();
  if (tok && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${tok}`);
  }
  return fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });
}
