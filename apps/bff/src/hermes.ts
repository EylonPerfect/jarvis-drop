import { request } from "undici";
import { config } from "./config.js";
import { HERMES_ENDPOINTS } from "@jarvis/shared";

// ------------------------------------------------------------
// Server-side client for hermes-agent. Supports two auth modes:
//  1. Bearer key (standalone gateway / `hermes proxy`): HERMES_API_KEY.
//  2. Dashboard session-cookie login (the Hostinger template): when
//     HERMES_DASH_USER/PASS are set, the BFF logs in at /login and
//     authenticates /v1/* with the resulting session cookie.
// Credentials never reach the browser.
// ------------------------------------------------------------

const base = config.hermes.baseUrl;
const dashMode = !!(config.hermes.dashUser && config.hermes.dashPass);

let sessionCookie = "";
let loginInFlight: Promise<boolean> | null = null;

function parseSetCookie(h: string | string[] | undefined): string {
  if (!h) return "";
  const arr = Array.isArray(h) ? h : [h];
  // keep just name=value from each Set-Cookie
  return arr.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

async function doLogin(): Promise<boolean> {
  try {
    // Collect any pre-login cookie, then POST credentials.
    const g = await request(`${base}/login`, { method: "GET", maxRedirections: 0 });
    const gc = parseSetCookie(g.headers["set-cookie"] as any);
    await g.body.dump();
    const form = new URLSearchParams({
      username: config.hermes.dashUser ?? "",
      password: config.hermes.dashPass ?? "",
      next: "",
    }).toString();
    const p = await request(`${base}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...(gc ? { cookie: gc } : {}) },
      body: form,
      maxRedirections: 0,
    });
    const pc = parseSetCookie(p.headers["set-cookie"] as any);
    await p.body.dump();
    sessionCookie = pc || gc;
    return !!sessionCookie;
  } catch {
    return false;
  }
}

async function ensureSession(): Promise<void> {
  if (!dashMode || sessionCookie) return;
  if (!loginInFlight) loginInFlight = doLogin().finally(() => (loginInFlight = null));
  await loginInFlight;
}

function headers(sessionKey?: string, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
  if (dashMode) {
    if (sessionCookie) h["Cookie"] = sessionCookie;
  } else {
    h["Authorization"] = `Bearer ${config.hermes.apiKey}`;
  }
  h["X-Hermes-Session-Key"] = sessionKey ?? config.hermes.sessionKey;
  return h;
}

const isRedirectToLogin = (status: number) => status === 302 || status === 401 || status === 403;

export interface HermesResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function call<T>(method: string, path: string, body?: unknown, sessionKey?: string): Promise<HermesResult<T>> {
  const url = `${base}${path}`;
  const send = () =>
    request(url, {
      method: method as any,
      headers: headers(sessionKey),
      body: body === undefined ? undefined : JSON.stringify(body),
      headersTimeout: 120_000,
      bodyTimeout: 300_000,
      maxRedirections: 0,
    });
  try {
    if (dashMode) await ensureSession();
    let res = await send();
    if (dashMode && isRedirectToLogin(res.statusCode)) {
      await res.body.dump();
      sessionCookie = "";
      await ensureSession();
      res = await send();
    }
    const status = res.statusCode;
    const text = await res.body.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = text as unknown as T;
      }
    }
    if (status >= 400 || isRedirectToLogin(status)) return { ok: false, status, data, error: `hermes ${status}` };
    return { ok: true, status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export const hermes = {
  get: <T>(path: string, sessionKey?: string) => call<T>("GET", path, undefined, sessionKey),
  post: <T>(path: string, body?: unknown, sessionKey?: string) => call<T>("POST", path, body, sessionKey),
  patch: <T>(path: string, body?: unknown, sessionKey?: string) => call<T>("PATCH", path, body, sessionKey),
  del: <T>(path: string, sessionKey?: string) => call<T>("DELETE", path, undefined, sessionKey),

  health: () => call<any>("GET", HERMES_ENDPOINTS.health),
  healthDetailed: () => call<any>("GET", HERMES_ENDPOINTS.healthDetailed),
  models: () => call<any>("GET", HERMES_ENDPOINTS.models),
  capabilities: () => call<any>("GET", HERMES_ENDPOINTS.capabilities),
  skills: () => call<any>("GET", HERMES_ENDPOINTS.skills),
  toolsets: () => call<any>("GET", HERMES_ENDPOINTS.toolsets),

  /**
   * Streaming chat. Relays the gateway's SSE body to the caller. Re-logs in
   * once if the session cookie has expired (dashboard mode).
   */
  async chatStream(
    body: unknown,
    sessionKey?: string,
  ): Promise<{ ok: boolean; status: number; stream: AsyncIterable<Buffer> | null; error?: string }> {
    const url = `${base}${HERMES_ENDPOINTS.chatCompletions}`;
    const send = () =>
      request(url, {
        method: "POST",
        headers: headers(sessionKey, { Accept: "text/event-stream" }),
        body: JSON.stringify(body),
        headersTimeout: 120_000,
        bodyTimeout: 600_000,
        maxRedirections: 0,
      });
    try {
      if (dashMode) await ensureSession();
      let res = await send();
      if (dashMode && isRedirectToLogin(res.statusCode)) {
        await res.body.dump();
        sessionCookie = "";
        await ensureSession();
        res = await send();
      }
      if (res.statusCode >= 400 || isRedirectToLogin(res.statusCode)) {
        const text = await res.body.text();
        return { ok: false, status: res.statusCode, stream: null, error: text || `hermes ${res.statusCode}` };
      }
      return { ok: true, status: res.statusCode, stream: res.body as AsyncIterable<Buffer> };
    } catch (err) {
      return { ok: false, status: 0, stream: null, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

/** Reachability probe: the proxy/gateway exposes /health or /v1/models;
 * the dashboard answers /v1/models once logged in. Any success = reachable. */
export async function hermesReachable(): Promise<boolean> {
  const h = await hermes.health();
  if (h.ok) return true;
  const m = await hermes.models();
  return m.ok;
}
