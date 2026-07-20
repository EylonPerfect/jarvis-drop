import { query } from "../db/pool.js";

// ============================================================================
// sandboxReaper.ts — PERIODIC SWEEPER that reclaims LEAKED E2B sandboxes.
//
// WHY: sandboxes are created for live rehearsals, live/Zoom calls, and the
// "Talk to Ava" demo pool. They are torn down only when the user EXPLICITLY
// ends (/api/live/end) or when a demo is polled past expiry. An abandoned
// session (closed tab, boot failure, auto-warm-on-open) holds its sandbox for
// the full 55-min e2b cap → the account drifts toward the 20-concurrent cap.
// This sweeper closes that gap with CONSERVATIVE, never-touch-an-active-session
// targets, running independently of any client poll.
//
// SAFETY (reviewed target-by-target — this must NEVER kill a live sandbox):
//   (a) Expired demos — only demo_sessions already PAST their own hard
//       expires_at (set to now()+sessionSec at lease). A session still inside
//       its window is never matched, so an in-progress demo is never touched.
//   (b) Stale live calls — only live_calls whose started_at is > 56 minutes
//       ago. Every sandbox is created (or, on the standby/wake path, its
//       timeout reset) to at most 55 minutes measured from ~started_at, so at
//       56 minutes the e2b sandbox is ALREADY DEAD by its own cap. The
//       connect+kill is therefore a best-effort reclaim (expected "not found"),
//       and the row is closed. 56 min guarantees we never end a call/rehearsal
//       still within its lifetime. (Matches — and slightly tightens — the
//       existing 65-min auto-expire in routes/live.ts.)
//
// The whole tick is wrapped so it can NEVER throw into the interval. Each
// connect+kill has its own try/catch: a paused/gone sandbox throwing
// "not found" is EXPECTED and counted as handled, not as an error.
// ============================================================================

const TICK_MS = 3 * 60 * 1000; // every 3 minutes
let timer: ReturnType<typeof setInterval> | null = null;

// Resolve the REAL e2b key ONCE per tick. Two integrations rows share id='e2b'
// (a real `e2b_...` key + a `demo-e2b-key` placeholder); pick the real one
// deterministically so a connect never authenticates with the placeholder.
async function resolveRealE2bKey(): Promise<string | null> {
  const rows = await query<{ k: string | null }>(
    `SELECT values->>'apiKey' AS k FROM integrations WHERE id='e2b'`,
  );
  const keys = rows.map((r) => r.k).filter((k): k is string => !!k);
  if (keys.length === 0) return null;
  return keys.find((k) => k.startsWith("e2b_")) ?? keys[0];
}

// Best-effort connect + kill. Reuses the same pattern as purge.ts /
// demoPool.connectSandbox / live.ts e2bSandbox.
async function killSandbox(sandboxId: string, apiKey: string): Promise<void> {
  const { Sandbox } = await import("@e2b/desktop");
  const d = await Sandbox.connect(sandboxId, { apiKey });
  await d.kill();
}

async function tick(): Promise<void> {
  let demosExpired = 0;
  let callsStale = 0;
  let killed = 0;
  let errs = 0;
  try {
    const apiKey = await resolveRealE2bKey();
    if (!apiKey) {
      // No real key → do nothing this tick (never authenticate with placeholder).
      console.warn("[reaper] no real e2b key resolved — skipping tick");
      return;
    }

    // (a) Expired demo sessions past their hard timeout. Only 'live'/'connecting'
    //     rows whose expires_at is already in the past — an active demo (still
    //     inside its window) can never match.
    const expiredDemos = await query<{ sandbox_id: string | null }>(
      `UPDATE demo_sessions SET status='expired', ended_at=now()
         WHERE status IN ('live','connecting') AND expires_at IS NOT NULL AND expires_at < now()
       RETURNING sandbox_id`,
    );
    demosExpired = expiredDemos.length;
    for (const row of expiredDemos) {
      if (!row.sandbox_id) continue;
      try {
        await killSandbox(row.sandbox_id, apiKey);
        killed++;
      } catch {
        /* paused/gone sandbox ("not found") is expected — handled, not an error */
      }
    }

    // (b) Stale live calls PAST the 55-min sandbox hard cap. The sandbox is
    //     already dead by 56 min; this reclaims + closes the books.
    const staleCalls = await query<{ id: string; sandbox_id: string }>(
      `SELECT id, sandbox_id FROM live_calls
         WHERE ended_at IS NULL AND sandbox_id IS NOT NULL
           AND started_at < now() - interval '56 minutes'`,
    );
    callsStale = staleCalls.length;
    for (const row of staleCalls) {
      try {
        await killSandbox(row.sandbox_id, apiKey);
        killed++;
      } catch {
        /* sandbox already dead by its own 55-min cap — expected, handled */
      }
      try {
        await query(`UPDATE live_calls SET ended_at=now() WHERE id=$1`, [row.id]);
      } catch (e) {
        errs++;
        console.warn(`[reaper] failed to close live_call ${row.id}: ${String(e)}`);
      }
    }
  } catch (e) {
    // Any unexpected failure (DB, key lookup) — swallow so the timer survives.
    errs++;
    console.error(`[reaper] tick failed: ${String(e)}`);
  } finally {
    console.log(`[reaper] demos_expired=${demosExpired} calls_stale=${callsStale} killed=${killed} errs=${errs}`);
  }
}

/**
 * Start the periodic sandbox reaper. Ticks every 3 minutes; the timer is
 * unref'd so it never holds the process open. Idempotent.
 */
export function startSandboxReaper(): void {
  if (timer) return;
  console.log("[reaper] starting sandbox reaper (tick every 3m)");
  timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
}
