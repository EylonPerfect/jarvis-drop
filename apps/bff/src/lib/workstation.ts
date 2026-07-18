import { Sandbox } from "@e2b/desktop";
import { getIntegrationValues } from "../routes/integrations.js";
import { checkCapsForAgent, orgForAgent, recordSandboxMinutes } from "./metering.js";

// Agent Workstation: each agent gets its own E2B virtual desktop (Linux GUI) it
// operates like a person — the Manus-style "give the agent a real computer".
// This module owns the sandbox lifecycle + low-level control; the computer-use
// loop and HUD stream sit on top. Sessions are kept in memory keyed by agentId.

interface WS { sandbox: Sandbox; streamUrl: string; lastUsed: number; startedAt: number }
const sessions = new Map<string, WS>();
const SESSION_MS = 30 * 60 * 1000;

async function e2bKey(org: string): Promise<string | null> {
  const v = await getIntegrationValues(org, "e2b");
  return v?.apiKey?.trim() || null;
}

export function wsHas(agentId: string): boolean { return sessions.has(agentId); }

// Meter the wall-clock minutes a desktop was alive, then clear the session.
// Fail-open: metering must never stop us from freeing the sandbox.
async function meterAndDrop(agentId: string, s: WS): Promise<void> {
  sessions.delete(agentId);
  const minutes = Math.max(0, (Date.now() - s.startedAt) / 60000);
  try {
    const orgId = await orgForAgent(agentId);
    await recordSandboxMinutes({ orgId, agentId }, minutes, { sandboxId: s.sandbox.sandboxId });
  } catch { /* fail-open */ }
}

// Start (or reuse) an agent's desktop; returns the embeddable live-stream URL.
// `org` scopes the E2B credential lookup to the caller's tenant.
export async function wsStart(org: string, agentId: string): Promise<{ ok: boolean; streamUrl?: string; sandboxId?: string; error?: string }> {
  const existing = sessions.get(agentId);
  if (existing) { existing.lastUsed = Date.now(); return { ok: true, streamUrl: existing.streamUrl, sandboxId: existing.sandbox.sandboxId }; }
  // Cost safety: refuse to spin up a NEW sandbox when the org is hard-capped or
  // the global circuit breaker / kill-switch is engaged (fail-open on error).
  const cap = await checkCapsForAgent(agentId);
  if (!cap.allowed) return { ok: false, error: `Cost cap: ${cap.reason}` };
  const key = await e2bKey(org);
  if (!key) return { ok: false, error: "E2B not connected (AI Core → AI services → E2B)." };
  try {
    const sandbox = await Sandbox.create({ apiKey: key, timeoutMs: SESSION_MS });
    await sandbox.stream.start({ requireAuth: true });
    const authKey = await sandbox.stream.getAuthKey();
    const streamUrl = sandbox.stream.getUrl({ authKey });
    sessions.set(agentId, { sandbox, streamUrl, lastUsed: Date.now(), startedAt: Date.now() });
    return { ok: true, streamUrl, sandboxId: sandbox.sandboxId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// PNG screenshot of the desktop (what the computer-use model "sees").
export async function wsScreenshot(agentId: string): Promise<Buffer | null> {
  const s = sessions.get(agentId);
  if (!s) return null;
  try { s.lastUsed = Date.now(); const img = await s.sandbox.screenshot(); return Buffer.from(img); } catch { return null; }
}

export type WsAction =
  | { type: "click"; x: number; y: number }
  | { type: "double_click"; x: number; y: number }
  | { type: "move"; x: number; y: number }
  | { type: "scroll"; amount?: number }
  | { type: "type"; text: string }
  | { type: "key"; keys: string | string[] }
  | { type: "wait"; ms?: number };

// Low-level action executor (used by the computer-use loop).
export async function wsAct(agentId: string, a: WsAction): Promise<{ ok: boolean; error?: string }> {
  const s = sessions.get(agentId);
  if (!s) return { ok: false, error: "no workstation session" };
  s.lastUsed = Date.now();
  const d = s.sandbox;
  try {
    if (a.type === "click") await d.leftClick(a.x, a.y);
    else if (a.type === "double_click") await d.doubleClick(a.x, a.y);
    else if (a.type === "move") await d.moveMouse(a.x, a.y);
    else if (a.type === "scroll") await d.scroll(a.amount ?? -3);
    else if (a.type === "type") await d.write(a.text);
    else if (a.type === "key") await d.press(a.keys);
    else if (a.type === "wait") await new Promise((r) => setTimeout(r, Math.min(5000, a.ms ?? 800)));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Open a URL in the desktop's default browser (seeds a task so the agent starts
// on the page instead of a blank desktop). Best-effort across browser binaries.
export async function wsOpenUrl(agentId: string, url: string): Promise<boolean> {
  const s = sessions.get(agentId);
  if (!s) return false;
  const safe = url.replace(/["`$\\]/g, "");
  const cmds = [`xdg-open "${safe}"`, `google-chrome "${safe}"`, `chromium "${safe}"`, `firefox "${safe}"`];
  for (const c of cmds) {
    try { await s.sandbox.commands.run(c, { background: true }); return true; } catch { /* try next */ }
  }
  return false;
}

export async function wsStop(agentId: string): Promise<void> {
  const s = sessions.get(agentId);
  if (!s) return;
  await meterAndDrop(agentId, s);
  try { await s.sandbox.kill(); } catch { /* ignore */ }
}

// Reap idle desktops so we don't pay for/hold abandoned sandboxes.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsed > SESSION_MS) { void meterAndDrop(id, s); s.sandbox.kill().catch(() => {}); }
  }
}, 60 * 1000).unref?.();
