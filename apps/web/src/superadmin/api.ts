// ============================================================
// Super-admin API client.
//
// This is the highest-privilege surface, so its session token lives in
// sessionStorage (cleared when the tab closes) rather than localStorage, and it
// is kept entirely separate from the product's X-API-Key auth (api/client.ts).
//
// Binds to the contract the backend agent is building in parallel:
//   POST /api/superadmin/login
//   GET  /api/superadmin/fleet
//   POST /api/superadmin/calls/:id/watch | /kill
//   GET  /api/superadmin/orgs   POST /api/superadmin/orgs
//   POST /api/superadmin/orgs/:id/suspend | /enter
//   GET  /api/superadmin/readiness | /reports   POST /api/superadmin/reports/:id/triage
//   GET/POST /api/superadmin/config
//   GET  /api/superadmin/audit
//   GET  /api/usage | /api/usage/:orgId   POST /api/usage/kill-switch
// Every mutation sends a { reason }.
// ============================================================
import { useCallback, useEffect, useState } from "react";

const BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
const TOKEN_KEY = "sa.token";

export function getSaToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
export function setSaToken(t: string): void {
  try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
}
export function clearSaToken(): void {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

function authHeaders(hasBody: boolean): Record<string, string> {
  const t = getSaToken();
  return {
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    ...(t ? { "X-Superadmin-Token": t, Authorization: `Bearer ${t}` } : {}),
  };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const res = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    headers: { ...authHeaders(hasBody), ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 401 || res.status === 403) {
    clearSaToken();
    try { window.dispatchEvent(new Event("sa-unauthorized")); } catch { /* ignore */ }
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
  }
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
  const txt = await res.text();
  return (txt ? JSON.parse(txt) : null) as T;
}

export const saApi = {
  get: <T>(path: string) => req<T>(path),
  post: <T>(path: string, body?: unknown) =>
    req<T>(path, { method: "POST", body: body != null ? JSON.stringify(body) : undefined }),
};

// Password-only login (locked decision). The MFA code path stays dormant in the
// UI. Backends may return a bearer token or set an httpOnly cookie; either way
// we mark the session unlocked.
export async function saLogin(password: string): Promise<void> {
  const r = await saApi.post<{ token?: string; ok?: boolean } | null>("/api/superadmin/login", { password });
  setSaToken(r?.token || "session");
}

// Generic GET hook with explicit loading / error / empty states so panels can
// fall back cleanly when an endpoint isn't up yet (no fabricated data shipped).
export function useSa<T>(path: string | null, deps: unknown[] = []): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (path == null) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    saApi
      .get<T>(path)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => load(), [load]);

  return { data, loading, error, reload: load };
}
