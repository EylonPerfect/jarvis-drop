import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { config } from "../config.js";

// Persistent, agent-driven browser for the live demo. Each live session keeps a
// real Chromium page (via browserless over CDP) that the agent navigates,
// scrolls, and clicks — the /live page streams frames of it as the bot's screen.
// This is the "computer-use" engine: real interaction, not static screenshots.

interface Session { browser: Browser; page: Page; lastUsed: number; navigating: boolean }
const sessions = new Map<string, Session>();

const wsEndpoint = () => `${config.browserless.url.replace(/^http/i, "ws")}?token=${encodeURIComponent(config.browserless.token)}`;

function sameHost(a: string, b: string): boolean {
  try { return new URL(a).host === new URL(b).host; } catch { return false; }
}

async function ensure(id: string, homeUrl: string): Promise<Session> {
  const existing = sessions.get(id);
  if (existing && existing.browser.connected) { existing.lastUsed = Date.now(); return existing; }
  if (existing) { try { await existing.browser.disconnect(); } catch { /* ignore */ } sessions.delete(id); }
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint() });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const s: Session = { browser, page, lastUsed: Date.now(), navigating: true };
  sessions.set(id, s);
  try { await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 20000 }); } catch { /* show whatever loads */ }
  s.navigating = false;
  return s;
}

export type BrowserAction =
  | { type: "open_page"; url: string }
  | { type: "scroll"; direction?: "down" | "up" | "top"; amount?: number }
  | { type: "click"; text: string }
  | { type: "back" };

// Run an action on the session's live page. `home` bounds navigation to the demo
// host (anti-abuse). Returns the resulting URL or an error string.
export async function browserAct(id: string, home: string, action: BrowserAction): Promise<{ ok: boolean; url?: string; error?: string }> {
  let s: Session;
  try { s = await ensure(id, home); } catch (e) { return { ok: false, error: `browser unavailable: ${(e as Error).message}` }; }
  s.lastUsed = Date.now();
  try {
    if (action.type === "open_page") {
      const url = action.url?.trim();
      if (!url || !/^https?:\/\//i.test(url) || !sameHost(url, home)) return { ok: false, error: "url must be on the demo site" };
      s.navigating = true;
      try { await s.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }); } finally { s.navigating = false; }
    } else if (action.type === "scroll") {
      const dy = action.direction === "up" ? -650 : action.direction === "top" ? -1e6 : (action.amount ?? 650);
      await s.page.evaluate((y) => window.scrollBy({ top: y, left: 0, behavior: "auto" }), dy);
    } else if (action.type === "click") {
      const clicked = await s.page.evaluate((needle: string) => {
        const t = needle.trim().toLowerCase();
        const nodes = Array.from(document.querySelectorAll("a, button, [role=button], [role=tab], input[type=submit]")) as HTMLElement[];
        const hit = nodes.find((n) => (n.innerText || (n as HTMLInputElement).value || "").trim().toLowerCase().includes(t));
        if (hit) { hit.scrollIntoView({ block: "center" }); (hit as HTMLElement).click(); return true; }
        return false;
      }, action.text || "");
      if (!clicked) return { ok: false, error: `nothing matching "${action.text}"` };
      await s.page.waitForNetworkIdle({ idleTime: 500, timeout: 4000 }).catch(() => {});
    } else if (action.type === "back") {
      await s.page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    }
    return { ok: true, url: s.page.url() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Current frame (JPEG) of the session's live page. Ensures the session exists so
// the very first poll shows the homepage.
export async function browserFrame(id: string, home: string): Promise<Buffer | null> {
  let s: Session;
  try { s = await ensure(id, home); } catch { return null; }
  if (s.navigating) { /* mid-nav: still return the last paintable frame */ }
  try {
    s.lastUsed = Date.now();
    return Buffer.from(await s.page.screenshot({ type: "jpeg", quality: 55 }));
  } catch { return null; }
}

export async function browserClose(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try { await s.browser.disconnect(); } catch { /* ignore */ }
}

// Reap idle sessions so we don't hold browserless slots forever.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsed > 10 * 60 * 1000 || !s.browser.connected) { sessions.delete(id); try { s.browser.disconnect(); } catch { /* ignore */ } }
  }
}, 60 * 1000).unref?.();
