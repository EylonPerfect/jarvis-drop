import { request } from "undici";
import { config } from "./config.js";
import { HERMES_ENDPOINTS } from "@jarvis/shared";
import { getActiveProvider, testConnection } from "./lib/providers.js";

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
// Last login attempt details, surfaced by diagnose() (no secrets).
let lastLogin: Record<string, unknown> = {};

function parseSetCookie(h: string | string[] | undefined): string {
  if (!h) return "";
  const arr = Array.isArray(h) ? h : [h];
  // keep just name=value from each Set-Cookie
  return arr.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

// Merge two "a=1; b=2" cookie strings; later values win (login cookie overrides
// the pre-login state cookie of the same name).
function mergeCookies(a: string, b: string): string {
  const jar = new Map<string, string>();
  for (const part of `${a}; ${b}`.split(";")) {
    const s = part.trim();
    if (!s) continue;
    const i = s.indexOf("=");
    if (i <= 0) continue;
    jar.set(s.slice(0, i), s.slice(i + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function doLogin(): Promise<boolean> {
  const loginPath = config.hermes.loginPath;
  try {
    // 1. GET /login to pick up any pre-login/CSRF state cookie.
    const g = await request(`${base}/login`, { method: "GET", maxRedirections: 0 });
    const stateCookie = parseSetCookie(g.headers["set-cookie"] as any);
    await g.body.dump();

    // 2. POST credentials as JSON to the JS form's real submit endpoint
    //    (/auth/password-login). The live template does:
    //      fetch('/auth/password-login', {method:'POST',
    //        headers:{'Content-Type':'application/json'},
    //        body: JSON.stringify({provider:'basic',username,password,next})})
    //    A successful login returns 200 + a session Set-Cookie; a bad password
    //    returns 401 with no cookie.
    const p = await request(`${base}${loginPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(stateCookie ? { cookie: stateCookie } : {}) },
      body: JSON.stringify({
        provider: "basic",
        username: config.hermes.dashUser ?? "",
        password: config.hermes.dashPass ?? "",
        next: "",
      }),
      maxRedirections: 0,
    });
    const loginCookie = parseSetCookie(p.headers["set-cookie"] as any);
    const location = (p.headers["location"] as string | undefined) ?? "";
    const status = p.statusCode;
    await p.body.dump();

    // Success signal: 2xx AND a session cookie was set. A wrong password yields
    // 401 with no cookie; a bounce to /login also means failure.
    const bouncedToLogin = /\/login(\?|$)/.test(location);
    const ok = status >= 200 && status < 300 && !!loginCookie && !bouncedToLogin;
    sessionCookie = mergeCookies(stateCookie, loginCookie);

    lastLogin = {
      endpoint: loginPath,
      status,
      location,
      gotStateCookie: !!stateCookie,
      gotLoginCookie: !!loginCookie,
      bouncedToLogin,
      success: ok,
    };
    return ok;
  } catch (err) {
    lastLogin = { endpoint: loginPath, error: err instanceof Error ? err.message : String(err) };
    return false;
  }
}

let authed = false;

async function ensureSession(): Promise<void> {
  if (!dashMode || authed) return;
  if (!loginInFlight) loginInFlight = doLogin().finally(() => (loginInFlight = null));
  authed = await loginInFlight;
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
      authed = false;
      await ensureSession();
      res = await send();
    }
    const status = res.statusCode;
    const ctype = String((res.headers["content-type"] as string | undefined) ?? "");
    const text = await res.body.text();
    // The Hostinger dashboard serves its SPA index.html (200, text/html) for any
    // path it doesn't recognise as an API route. That is NOT a real API
    // response, so treat HTML as "endpoint absent" rather than a false success.
    if (ctype.includes("text/html")) {
      return { ok: false, status, data: null, error: `hermes ${status} (html/SPA — not an API route)` };
    }
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

  // The Hostinger dashboard exposes a REST surface under /api/* — NOT the
  // OpenAI-style /v1/* the standalone gateway serves. Point each accessor at
  // the endpoint that actually exists on this deployment (verified live):
  //   /api/status   → version, gateway_running, update info
  //   /api/skills   → installed skills
  //   /api/config   → model, toolsets, providers, concurrency
  // Endpoints with no dashboard equivalent (models, capabilities) keep their
  // /v1 path and simply resolve to ok:false here (callers all null-check).
  health: () => call<any>("GET", "/api/status"),
  healthDetailed: () => call<any>("GET", "/api/status"),
  models: () => call<any>("GET", HERMES_ENDPOINTS.models),
  capabilities: () => call<any>("GET", HERMES_ENDPOINTS.capabilities),
  skills: () => call<any>("GET", "/api/skills"),
  toolsets: () => call<any>("GET", "/api/config"),

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
        authed = false;
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

/** Reachability probe: the Hostinger dashboard answers /api/status with JSON
 * (version + gateway state) once the session cookie is valid. A JSON 200 with a
 * version field means we authenticated and the agent is reachable. */
export async function hermesReachable(): Promise<boolean> {
  const s = await hermes.get<any>("/api/status");
  return s.ok && !!s.data && typeof s.data === "object" && "version" in s.data;
}

const snippet = (v: unknown, n = 240): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return (s ?? "").slice(0, n);
};

/**
 * Structured connectivity diagnosis (no secrets). Reports how the BFF is
 * configured to reach hermes and the result of probing each candidate
 * endpoint, so a live "gateway offline" can be pinned to a specific cause
 * (wrong base URL, login failing, endpoint missing, model rejected, …).
 */
export async function diagnose(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    baseUrl: base,
    authMode: dashMode ? "dashboard-session-cookie" : "bearer",
    dashUserSet: !!config.hermes.dashUser,
    dashPassSet: !!config.hermes.dashPass,
    bearerKeySet: !!config.hermes.apiKey && config.hermes.apiKey !== "change-me",
    model: config.hermes.model,
    loginPath: config.hermes.loginPath,
  };

  if (dashMode) {
    sessionCookie = "";
    authed = false;
    const loggedIn = await doLogin();
    authed = loggedIn;
    // lastLogin carries the full picture: endpoint, status, location, cookies.
    out.login = { success: loggedIn, ...lastLogin };
  }

  // Probe the endpoints the chat path depends on.
  const models = await hermes.models();
  out.probe_models = { path: HERMES_ENDPOINTS.models, ok: models.ok, status: models.status, body: snippet(models.data), error: models.error };

  const health = await hermes.health();
  out.probe_health = { path: HERMES_ENDPOINTS.health, ok: health.ok, status: health.status, body: snippet(health.data), error: health.error };

  // The actual thing the UI calls: a tiny non-streaming completion.
  const chat = await hermes.post<any>(HERMES_ENDPOINTS.chatCompletions, {
    model: config.hermes.model,
    messages: [{ role: "user", content: "ping" }],
    stream: false,
  });
  out.probe_chat = {
    path: HERMES_ENDPOINTS.chatCompletions,
    ok: chat.ok,
    status: chat.status,
    replyPreview: snippet(chat.data?.choices?.[0]?.message?.content ?? chat.data),
    error: chat.error,
  };

  // The chat actually prefers an operator-configured provider (AI Core). Report
  // whether one is active and whether it passes an end-to-end test — this is
  // usually the real reason a reply falls back.
  const active = await getActiveProvider();
  out.activeProvider = active ? { name: active.name, model: active.model, baseUrl: active.base_url } : null;
  if (active) out.probe_provider = await testConnection(active);

  return out;
}
