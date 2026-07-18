import { query, one } from "../db/pool.js";
import { config } from "../config.js";

// ============================================================
// Phase 3 — metering & cost safety.
//
// Central, ORG-SCOPED usage ledger writer + hybrid caps engine. Everything here
// is FAIL-OPEN: a metering hiccup (DB blip, missing column while the Phase-2
// tenancy migration is still rolling out) must NEVER block or crash a live call.
// Writes are best-effort and swallowed; cap checks default to "allow" on error.
// ============================================================

export type UsageEventType = "sandbox_minute" | "llm_tokens" | "tts_chars" | "live_call_minute";

export interface UsageContext {
  orgId?: string | null;
  agentId?: string | null;
  callId?: string | null;
}

interface RecordArgs extends UsageContext {
  eventType: UsageEventType;
  quantity: number;
  unitCost: number;
  cost?: number; // defaults to quantity * unitCost
  meta?: Record<string, unknown>;
}

const DEFAULT_ORG = "default";

// The kill-switch and circuit-breaker flags are GLOBAL platform config living in
// the settings table — pin their reads and writes to the platform-config org so
// they don't rely on the (soon-dropped) org_id DEFAULT and never mis-scope.
const PLATFORM_ORG = config.legacyOrgId;

/** Resolve an agent's org, fail-open to 'default' (works before Phase-2 lands). */
export async function orgForAgent(agentId?: string | null): Promise<string> {
  if (!agentId) return DEFAULT_ORG;
  try {
    const row = await one<{ org_id: string | null }>(`SELECT org_id FROM agents WHERE id = $1`, [agentId]);
    return row?.org_id?.trim() || DEFAULT_ORG;
  } catch {
    // org_id column not present yet (tenancy migration separate) — degrade cleanly.
    return DEFAULT_ORG;
  }
}

/** Insert one usage event. Never throws. */
export async function recordUsage(a: RecordArgs): Promise<void> {
  try {
    if (!(a.quantity > 0)) return; // nothing to meter
    const cost = a.cost ?? a.quantity * a.unitCost;
    await query(
      `INSERT INTO usage_ledger (org_id, event_type, quantity, unit_cost, cost, agent_id, call_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        a.orgId?.trim() || DEFAULT_ORG,
        a.eventType,
        a.quantity,
        a.unitCost,
        cost,
        a.agentId ?? null,
        a.callId ?? null,
        JSON.stringify(a.meta ?? {}),
      ],
    );
  } catch (err) {
    console.warn("[metering] recordUsage failed (fail-open):", (err as Error).message);
  }
}

// ---- rough token estimate (fallback when a provider omits usage) ----
// ~4 chars/token is the standard English heuristic.
export function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

/** Cost of an LLM call from token counts, using the configured blended rates. */
export function llmCost(tokensIn: number, tokensOut: number): number {
  const m = config.metering;
  return (tokensIn / 1000) * m.llmUsdPer1kInput + (tokensOut / 1000) * m.llmUsdPer1kOutput;
}

/** Record an LLM call (tokens in/out). Blended unit_cost = cost / total tokens. */
export async function recordLlmUsage(
  ctx: UsageContext,
  tokensIn: number,
  tokensOut: number,
  meta?: Record<string, unknown>,
): Promise<void> {
  const total = (tokensIn || 0) + (tokensOut || 0);
  if (total <= 0) return;
  const cost = llmCost(tokensIn || 0, tokensOut || 0);
  await recordUsage({
    ...ctx,
    eventType: "llm_tokens",
    quantity: total,
    unitCost: total > 0 ? cost / total : 0,
    cost,
    meta: { tokens_in: tokensIn, tokens_out: tokensOut, ...meta },
  });
}

export async function recordSandboxMinutes(ctx: UsageContext, minutes: number, meta?: Record<string, unknown>) {
  await recordUsage({ ...ctx, eventType: "sandbox_minute", quantity: minutes, unitCost: config.metering.sandboxUsdPerMin, meta });
}

export async function recordTtsChars(ctx: UsageContext, chars: number, meta?: Record<string, unknown>) {
  await recordUsage({ ...ctx, eventType: "tts_chars", quantity: chars, unitCost: config.metering.ttsUsdPerChar, meta });
}

export async function recordLiveCallMinutes(ctx: UsageContext, minutes: number, meta?: Record<string, unknown>) {
  await recordUsage({ ...ctx, eventType: "live_call_minute", quantity: minutes, unitCost: config.metering.liveCallUsdPerMin, meta });
}

// ============================================================
// Hybrid caps + circuit breaker
// ============================================================

export interface OrgBilling {
  includedMinutes: number; // soft cap (allowance)
  hardCapMinutes: number;  // hard cap
  overagePerMin: number;
  paused: boolean;
}

/** Per-org billing config, falling back to env defaults for any NULL/absent field. */
export async function getOrgBilling(orgId: string): Promise<OrgBilling> {
  const m = config.metering;
  const fallback: OrgBilling = {
    includedMinutes: m.includedMinutesDefault,
    hardCapMinutes: m.hardCapMinutesDefault,
    overagePerMin: m.overagePerMinDefault,
    paused: false,
  };
  try {
    const row = await one<{
      included_minutes: number | null;
      hard_cap_minutes: number | null;
      overage_per_min: string | null;
      paused: boolean | null;
    }>(`SELECT included_minutes, hard_cap_minutes, overage_per_min, paused FROM org_billing_config WHERE org_id = $1`, [orgId]);
    if (!row) return fallback;
    return {
      includedMinutes: row.included_minutes ?? fallback.includedMinutes,
      hardCapMinutes: row.hard_cap_minutes ?? fallback.hardCapMinutes,
      overagePerMin: row.overage_per_min != null ? Number(row.overage_per_min) : fallback.overagePerMin,
      paused: row.paused ?? false,
    };
  } catch {
    return fallback;
  }
}

/** Live-call-minutes an org has consumed in the current calendar month. */
export async function orgMonthMinutes(orgId: string): Promise<number> {
  try {
    const row = await one<{ mins: string | null }>(
      `SELECT COALESCE(SUM(quantity),0) AS mins FROM usage_ledger
       WHERE org_id = $1 AND event_type = 'live_call_minute'
         AND created_at >= date_trunc('month', now())`,
      [orgId],
    );
    return Number(row?.mins ?? 0);
  } catch {
    return 0;
  }
}

/** Total COGS across ALL orgs in the trailing runaway window (USD). */
export async function globalWindowSpend(): Promise<number> {
  try {
    const win = Math.max(1, config.metering.runawayWindowMinutes);
    const row = await one<{ spend: string | null }>(
      `SELECT COALESCE(SUM(cost),0) AS spend FROM usage_ledger
       WHERE created_at >= now() - ($1::text || ' minutes')::interval`,
      [String(win)],
    );
    return Number(row?.spend ?? 0);
  } catch {
    return 0;
  }
}

const KILL_KEY = "metering_kill_switch";

export async function isKillSwitchOn(): Promise<boolean> {
  try {
    const row = await one<{ value: { on?: boolean } }>(`SELECT value FROM settings WHERE org_id = $1 AND key = $2`, [PLATFORM_ORG, KILL_KEY]);
    return !!row?.value?.on;
  } catch {
    return false;
  }
}

export async function setKillSwitch(on: boolean, note?: string): Promise<void> {
  await query(
    `INSERT INTO settings (org_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [PLATFORM_ORG, KILL_KEY, JSON.stringify({ on, note: note ?? null, at: new Date().toISOString() })],
  );
}

// Runaway-spend circuit breaker enable flag. The super-admin cost panel (p6)
// exposes it as a toggle; DEFAULT ENABLED (absent flag ⇒ true) so the automatic
// breaker keeps its existing always-on behavior unless an operator disables it.
const BREAKER_KEY = "metering_breaker_enabled";

export async function isBreakerEnabled(): Promise<boolean> {
  try {
    const row = await one<{ value: { on?: boolean } }>(`SELECT value FROM settings WHERE org_id = $1 AND key = $2`, [PLATFORM_ORG, BREAKER_KEY]);
    return row?.value?.on !== false; // absent or true ⇒ enabled
  } catch {
    return true;
  }
}

export async function setBreakerEnabled(on: boolean, note?: string): Promise<void> {
  await query(
    `INSERT INTO settings (org_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [PLATFORM_ORG, BREAKER_KEY, JSON.stringify({ on, note: note ?? null, at: new Date().toISOString() })],
  );
}

export type CapState = "ok" | "over_allowance" | "hard_capped" | "circuit_broken" | "killed" | "paused";

export interface CapDecision {
  allowed: boolean;
  state: CapState;
  reason: string;
  orgId: string;
  minutesUsed: number;
  includedMinutes: number;
  hardCapMinutes: number;
}

/**
 * Gate a new call/sandbox for an org. Order of precedence:
 *   global kill switch → global runaway breaker → org paused → org hard cap.
 * Being over the allowance (soft cap) is ALLOWED — it just meters as overage.
 * Fail-open: any error returns allowed=true so metering never blocks the product.
 */
export async function checkCaps(orgId: string): Promise<CapDecision> {
  const base = { orgId, minutesUsed: 0, includedMinutes: 0, hardCapMinutes: 0 };
  try {
    if (await isKillSwitchOn()) {
      return { ...base, allowed: false, state: "killed", reason: "Global kill-switch is engaged — new calls are paused platform-wide." };
    }
    const limit = config.metering.runawayUsdLimit;
    if (limit > 0 && (await isBreakerEnabled())) {
      const spend = await globalWindowSpend();
      if (spend > limit) {
        return { ...base, allowed: false, state: "circuit_broken", reason: `Runaway-spend circuit breaker tripped: $${spend.toFixed(2)} in the last ${config.metering.runawayWindowMinutes} min exceeds the $${limit.toFixed(2)} limit.` };
      }
    }
    const billing = await getOrgBilling(orgId);
    if (billing.paused) {
      return { ...base, includedMinutes: billing.includedMinutes, hardCapMinutes: billing.hardCapMinutes, allowed: false, state: "paused", reason: "This org is paused (billing hold)." };
    }
    const used = await orgMonthMinutes(orgId);
    const info = { orgId, minutesUsed: used, includedMinutes: billing.includedMinutes, hardCapMinutes: billing.hardCapMinutes };
    if (billing.hardCapMinutes > 0 && used >= billing.hardCapMinutes) {
      return { ...info, allowed: false, state: "hard_capped", reason: `Org hard cap reached (${used.toFixed(0)}/${billing.hardCapMinutes} live-call-minutes this month).` };
    }
    if (billing.includedMinutes > 0 && used >= billing.includedMinutes) {
      return { ...info, allowed: true, state: "over_allowance", reason: `Over included allowance (${used.toFixed(0)}/${billing.includedMinutes} min) — billing as overage.` };
    }
    return { ...info, allowed: true, state: "ok", reason: "Within allowance." };
  } catch (err) {
    console.warn("[metering] checkCaps failed (fail-open, allowing):", (err as Error).message);
    return { ...base, allowed: true, state: "ok", reason: "Cap check unavailable — allowing (fail-open)." };
  }
}

/** Convenience: resolve org from agent, then gate. */
export async function checkCapsForAgent(agentId?: string | null): Promise<CapDecision> {
  return checkCaps(await orgForAgent(agentId));
}
