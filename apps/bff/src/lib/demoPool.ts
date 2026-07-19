import { spawn } from "node:child_process";
import { openSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { one } from "../db/pool.js";
import { config } from "../config.js";
import { resetDemoTenant } from "./demoTenant.js";

// ============================================================================
// demoPool.ts — WARM-POOL MANAGER for the public "Talk to Ava" demo.
//
// Keeps DEMO_POOL_SIZE pre-warmed E2B sandboxes, each booted EXACTLY like a
// rehearsal call (reuses /app/ah/rehearsal.mjs — the same launcher the live
// path spawns in routes/live.ts) against the fixed DEMO AGENT on the DEMO
// tenant, with the access gate already passed and the app dashboard idle.
//
// HOW IT REUSES THE LIVE BOOT PATH (no reinvention):
//   * boot         → spawn("node", [`${AH}/rehearsal.mjs`, "0"], { AH_AGENT_ID })
//                    — byte-for-byte the rehearsal branch of POST /api/live/join.
//   * progress     → tail the pipeline log for `PHASE SANDBOX <id>` /
//                    `PHASE STREAM <url>` / `PHASE READY` (same markers + regex
//                    as live.ts startMonitor()).
//   * inject turn  → append {kind:"guest"} to /tmp/nudges.jsonl in the sandbox
//                    (same channel as POST /api/live/nudge).
//   * transcript   → read /tmp/duplexnav7.log (same source as /api/live/feed).
//   * teardown     → e2b Sandbox.connect(id).kill() (same as /api/live/end).
//
// SAFETY: the warming loop is OFF unless DEMO_POOL_ENABLED=true. Importing this
// module or registering routes/demo.ts creates ZERO sandboxes. The coordinator
// flips the flag for the controlled live test — nothing warms during a build.
// A HARD global cap (config.demo.maxSandboxes) bounds pool + in-use sandboxes.
// ============================================================================

const AH = "/app/ah";
const D = config.demo;

type SlotState = "warming" | "ready" | "leased" | "dead";

interface Slot {
  id: string;              // internal slot id (not the guest session id)
  logPath: string;
  pid: number | null;
  state: SlotState;
  bootedAt: number;        // ms
  readyAt: number | null;  // ms when PHASE READY seen
  sandboxId: string;       // filled from PHASE SANDBOX
  streamUrl: string;       // filled from PHASE STREAM
  sessionId: string | null; // guest session bound on lease
  leasedAt: number | null;
}

// In-memory pool state (single-process; the bff runs one node process).
const slots: Slot[] = [];
const bootMonitors = new Map<string, ReturnType<typeof setInterval>>();
let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

// ---- e2b connection (mirrors routes/live.ts e2bSandbox) --------------------
async function connectSandbox(sandboxId: string) {
  const { Sandbox } = await import("@e2b/desktop");
  const scoped = await one<{ values: { apiKey: string } }>(
    `SELECT values FROM integrations WHERE id='e2b' AND org_id=$1`, [config.legacyOrgId],
  );
  const any = scoped ?? (await one<{ values: { apiKey: string } }>(`SELECT values FROM integrations WHERE id='e2b'`));
  if (!any?.values?.apiKey) throw new Error("e2b integration key not configured");
  return Sandbox.connect(sandboxId, { apiKey: any.values.apiKey });
}

// ---- counts / cap ----------------------------------------------------------
function alive(): Slot[] { return slots.filter((s) => s.state !== "dead"); }
function warmingOrReady(): Slot[] { return slots.filter((s) => s.state === "warming" || s.state === "ready"); }
function totalSandboxes(): number { return alive().length; }
function readySlot(): Slot | undefined { return slots.find((s) => s.state === "ready"); }

export interface DemoPoolStats {
  enabled: boolean;
  target: number;
  hardCap: number;
  total: number;
  ready: number;
  warming: number;
  leased: number;
}
export function poolStats(): DemoPoolStats {
  return {
    enabled: D.poolEnabled,
    target: D.poolSize,
    hardCap: D.maxSandboxes,
    total: totalSandboxes(),
    ready: slots.filter((s) => s.state === "ready").length,
    warming: slots.filter((s) => s.state === "warming").length,
    leased: slots.filter((s) => s.state === "leased").length,
  };
}

// ---- boot one warm slot (reuses the rehearsal launcher) --------------------
function bootOne(): void {
  if (!D.agentId) { console.warn("[demoPool] DEMO_AGENT_ID unset — cannot warm (coordinator must supply it)"); return; }
  if (totalSandboxes() >= D.maxSandboxes) return;
  const id = `dslot_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const logPath = `${AH}/demo_${id}.log`;
  const slot: Slot = {
    id, logPath, pid: null, state: "warming", bootedAt: Date.now(),
    readyAt: null, sandboxId: "", streamUrl: "", sessionId: null, leasedAt: null,
  };
  try {
    const out = openSync(logPath, "a");
    // EXACT reuse of the live rehearsal boot: same script, same detached spawn,
    // same AH_AGENT_ID env override — scoped to the fixed demo agent/tenant.
    const child = spawn("node", [`${AH}/rehearsal.mjs`, "0"], {
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, AH_AGENT_ID: D.agentId },
    });
    child.unref();
    slot.pid = child.pid ?? null;
    appendFileSync(logPath, `\n[demoPool] warming slot ${id} pid=${child.pid}\n`);
  } catch (e) {
    appendFileSync(logPath, `[demoPool] spawn failed: ${String(e)}\n`);
    slot.state = "dead";
  }
  slots.push(slot);
  if (slot.state === "warming") monitorBoot(slot);
}

// Tail the pipeline log until PHASE READY (or boot timeout). Same PHASE markers
// as routes/live.ts startMonitor(): SANDBOX / STREAM / READY.
function monitorBoot(slot: Slot): void {
  if (bootMonitors.has(slot.id)) return;
  const iv = setInterval(() => {
    try {
      if (slot.state === "dead") { stopBootMonitor(slot.id); return; }
      const text = existsSync(slot.logPath) ? readFileSync(slot.logPath, "utf8") : "";
      for (const line of text.split("\n")) {
        const m = line.match(/^PHASE ([A-Z_]+)\s*(.*)$/);
        if (!m) continue;
        const detail = (m[2] || "").trim();
        if (m[1] === "SANDBOX" && !slot.sandboxId) slot.sandboxId = detail.split(/\s+/)[0] || "";
        if (m[1] === "STREAM" && detail) slot.streamUrl = detail;
        if (m[1] === "READY") { if (slot.state === "warming") { slot.state = "ready"; slot.readyAt = Date.now(); } }
      }
      if (slot.state === "ready") { stopBootMonitor(slot.id); return; }
      // Boot watchdog: never reached READY in time → reap whatever partial
      // sandbox exists and drop the slot (refill picks it up next tick).
      if (Date.now() - slot.bootedAt > D.bootTimeoutSec * 1000) {
        appendFileSync(slot.logPath, `[demoPool] boot timeout after ${D.bootTimeoutSec}s — reaping slot ${slot.id}\n`);
        killSlot(slot);
        stopBootMonitor(slot.id);
      }
    } catch { /* keep polling */ }
  }, 3000);
  bootMonitors.set(slot.id, iv);
}
function stopBootMonitor(id: string): void {
  const iv = bootMonitors.get(id);
  if (iv) { clearInterval(iv); bootMonitors.delete(id); }
}

// Kill a slot's sandbox (best-effort) and mark it dead. Never reuse a browser.
function killSlot(slot: Slot): void {
  slot.state = "dead";
  const sid = slot.sandboxId;
  if (!sid) return;
  void (async () => {
    try { const d = await connectSandbox(sid); await d.kill().catch(() => {}); }
    catch { /* sandbox may already be gone */ }
  })();
}

// ---- public API ------------------------------------------------------------
export type LeaseResult =
  | { ok: true; sandboxId: string; streamUrl: string }
  | { ok: false; queued: true; position: number };

/**
 * Hand a ready warm slot to a new demo session. Binds the slot to sessionId,
 * fires a best-effort demo-tenant reset (Agent-2), and triggers async refill.
 * Empty pool → queued with a position (number of leased+warming ahead).
 */
// After a lease-time reset re-seeds the demo agent with its seed persona, restore
// the pinned demo-HOST golden (stored once in settings.demo_host_golden) so Ava
// stays the product tour host across resets. Best-effort.
async function restoreDemoHostGolden(): Promise<void> {
  try {
    const r = await one<{ instructions: string }>(
      `SELECT value->>'instructions' AS instructions FROM settings WHERE org_id=$1 AND key='demo_host_golden'`, [D.orgId],
    );
    if (r && r.instructions && D.agentId) {
      await one(`UPDATE agents SET golden_instructions=$1 WHERE id=$2 AND org_id=$3 RETURNING id`, [r.instructions, D.agentId, D.orgId]);
    }
  } catch { /* best-effort — demo still works with the seed golden */ }
}

export async function lease(sessionId: string): Promise<LeaseResult> {
  const slot = readySlot();
  if (!slot) {
    // No warm slot. Nudge a refill (respecting the hard cap) and report queued.
    refill();
    const position = slots.filter((s) => s.state === "leased").length + 1;
    return { ok: false, queued: true, position };
  }
  slot.state = "leased";
  slot.sessionId = sessionId;
  slot.leasedAt = Date.now();
  // Clean the shared demo tenant for the next guest (best-effort; never blocks).
  void resetDemoTenant(D.orgId).then(() => restoreDemoHostGolden()).catch(() => { /* Agent-2's reset is best-effort */ });
  // Async refill so the pool trends back to target.
  refill();
  return { ok: true, sandboxId: slot.sandboxId, streamUrl: slot.streamUrl };
}

/** Tear down the sandbox behind a session (never reuse it) and refill. */
export async function reap(sessionId: string): Promise<boolean> {
  const slot = slots.find((s) => s.sessionId === sessionId && s.state !== "dead");
  if (!slot) return false;
  killSlot(slot);
  refill();
  return true;
}

/** Inject a guest turn into the live bridge (same channel as /api/live/nudge). */
export async function sayTo(sessionId: string, text: string): Promise<boolean> {
  const slot = slots.find((s) => s.sessionId === sessionId && s.state === "leased");
  if (!slot?.sandboxId) return false;
  try {
    const d = await connectSandbox(slot.sandboxId);
    const payload = JSON.stringify({ kind: "guest", text: (text || "").slice(0, 500), t: Date.now() }).replace(/'/g, "'\\''");
    await d.commands.run(`echo '${payload}' >> /tmp/nudges.jsonl`, { timeoutMs: 10000 });
    return true;
  } catch { return false; }
}

/** The bound sandbox for a session (status/stream lookups). */
export function slotForSession(sessionId: string): { sandboxId: string; streamUrl: string; state: SlotState } | null {
  const slot = slots.find((s) => s.sessionId === sessionId && s.state !== "dead");
  return slot ? { sandboxId: slot.sandboxId, streamUrl: slot.streamUrl, state: slot.state } : null;
}

/**
 * Read the live transcript for a session from the bridge log (same parse as
 * /api/live/feed). Returns a compact turn list; empty on any failure.
 */
export async function transcriptFor(sessionId: string): Promise<{ role: string; text: string }[]> {
  const slot = slots.find((s) => s.sessionId === sessionId && s.state === "leased");
  if (!slot?.sandboxId) return [];
  try {
    const d = await connectSandbox(slot.sandboxId);
    const r = await d.commands.run("cat /tmp/duplexnav7.log 2>/dev/null | tail -c 40000", { timeoutMs: 12000 });
    const out: { role: string; text: string }[] = [];
    for (const ln of ((r.stdout || "") + "").split("\n")) {
      let m;
      if ((m = ln.match(/^SAY (.*)$/))) out.push({ role: "ava", text: m[1] });
      else if ((m = ln.match(/^GUEST (.*)$/)) || (m = ln.match(/^NUDGE guest (.*)$/))) out.push({ role: "guest", text: m[1] });
    }
    return out.slice(-60);
  } catch { return []; }
}

/**
 * Stream the bound sandbox's ACTUAL spoken output — the vspk PulseAudio sink —
 * as base64 PCM s16le/24k/mono. This is a byte-for-byte lift of the capture /
 * poll mechanism in GET /api/live/audio (routes/live.ts): the ONLY difference
 * is that the sandbox is resolved from the demo pool (by sessionId) instead of
 * the authenticated live_calls row. Delivers Ava's REAL voice (same EL hybrid
 * voice + pacing a Zoom listener hears) to the public demo browser.
 *
 *   after < 0  → self-start the recorder in e2b BACKGROUND mode (a foreground
 *                nohup gets SIGKILLed with its process group when the RPC
 *                returns) and return the live-edge offset. The marker file lets
 *                a later poll know the writer is already up. vspk is a null-sink
 *                whose monitor emits real PCM while the hybrid EL player writes
 *                to it — exactly what a Zoom listener hears.
 *   after >= 0 → tail up to 72KB (~1.5s) from that offset, base64-encoded.
 */
export async function audioFor(
  sessionId: string,
  after: number,
): Promise<{ live: boolean; offset: number; chunk: string; rate: number }> {
  const slot = slots.find((s) => s.sessionId === sessionId && s.state === "leased");
  if (!slot?.sandboxId) return { live: false, offset: 0, chunk: "", rate: 24000 };
  try {
    const d = await connectSandbox(slot.sandboxId);
    if (after < 0) {
      const chk = await d.commands.run(`test -f /tmp/room_audio.started && echo up || echo down`, { timeoutMs: 10000 });
      if ((chk.stdout || "").trim() !== "up") {
        await d.commands.run(
          `touch /tmp/room_audio.started; pacat --record --format=s16le --rate=24000 --channels=1 --device=vspk.monitor > /tmp/room_audio.raw 2>/dev/null`,
          { background: true },
        ).catch(() => { /* poll will retry */ });
        await new Promise((res) => setTimeout(res, 600));
      }
      const r = await d.commands.run(`stat -c %s /tmp/room_audio.raw 2>/dev/null || echo 0`, { timeoutMs: 10000 });
      const size = parseInt(((r.stdout || "0").trim().split("\n").pop() || "0"), 10) || 0;
      return { live: true, offset: size, chunk: "", rate: 24000 };
    }
    const r = await d.commands.run(`tail -c +${after + 1} /tmp/room_audio.raw 2>/dev/null | head -c 72000 | base64 -w0`, { timeoutMs: 10000 });
    const b64 = (r.stdout || "").replace(/\s+/g, "");
    const bytes = b64 ? Buffer.from(b64, "base64").length : 0;
    return { live: true, offset: after + bytes, chunk: b64, rate: 24000 };
  } catch {
    return { live: false, offset: Math.max(0, after), chunk: "", rate: 24000 };
  }
}

// ---- maintenance loop ------------------------------------------------------
function refill(): void {
  if (!D.poolEnabled) return;
  // Keep warming+ready at target, but never exceed the hard cap counting leased.
  let want = Math.min(
    D.poolSize - warmingOrReady().length,       // toward target
    D.maxSandboxes - totalSandboxes(),          // under the hard cap
  );
  while (want-- > 0) bootOne();
}

function maintain(): void {
  // 1) prune dead slots.
  for (let i = slots.length - 1; i >= 0; i--) if (slots[i].state === "dead") { stopBootMonitor(slots[i].id); slots.splice(i, 1); }
  // 2) idle-TTL: a READY (unleased) slot older than TTL is recycled (e2b hard-
  //    caps at 55 min anyway — never hand out a stale browser).
  const now = Date.now();
  for (const s of slots) {
    if (s.state === "ready" && s.readyAt && now - s.readyAt > D.slotTtlSec * 1000) {
      appendFileSync(s.logPath, `[demoPool] idle TTL — recycling ready slot ${s.id}\n`);
      killSlot(s);
    }
  }
  // 3) refill toward target under the cap.
  refill();
}

/**
 * Start the warm pool. NO-OP unless DEMO_POOL_ENABLED=true — so importing this
 * module or registering the demo routes never touches E2B during a build. The
 * coordinator sets the flag for the controlled live test.
 */
export function startDemoPool(): void {
  if (!D.poolEnabled) { console.log("[demoPool] disabled (DEMO_POOL_ENABLED!=true) — no sandboxes will warm"); return; }
  if (!D.agentId || !D.orgId) { console.warn("[demoPool] DEMO_AGENT_ID/DEMO_ORG_ID unset — pool cannot start"); return; }
  if (maintenanceTimer) return;
  console.log(`[demoPool] starting: target=${D.poolSize} hardCap=${D.maxSandboxes} agent=${D.agentId} org=${D.orgId}`);
  refill();
  maintenanceTimer = setInterval(maintain, 5000);
  maintenanceTimer.unref?.();
}

/** Stop warming + tear down every sandbox (graceful shutdown / tests). */
export function stopDemoPool(): void {
  if (maintenanceTimer) { clearInterval(maintenanceTimer); maintenanceTimer = null; }
  for (const s of slots) if (s.state !== "dead") killSlot(s);
  for (const id of [...bootMonitors.keys()]) stopBootMonitor(id);
}
