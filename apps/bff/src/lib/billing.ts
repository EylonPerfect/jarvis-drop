// ============================================================
// BILLING — org subscription state + the free->paid LIVE gate.
//
// This is the wedge (CLAUDE.md PRICING / metric #3 free->went-live): rehearsal
// is free, but putting a clone LIVE (promote-to-live OR a live join) requires
// the org to hold an ACTIVE paid subscription with an AVAILABLE clone slot.
//
// The billable unit is a CERTIFIED/LIVE clone == an agent with a golden persona
// pinned (golden_persona_id). paid_clone_slots (from the Stripe subscription
// quantity, kept current by the webhook) is how many such clones the org paid
// for. Promoting a not-yet-live clone consumes the next slot; a live join of an
// already-live clone occupies its existing slot.
//
// SEPARATE from the >=70 readiness gate (the SAFETY stop, lib/readiness.ts) and
// from the metering caps (cost stop, lib/metering.ts). All three compose: a live
// join must clear readiness AND cost caps AND this billing gate.
//
// FAIL-OPEN on any DB error (consistent with the metering ethos): a transient DB
// blip must never block a paying customer's live call; safety is enforced
// elsewhere by the >=70 gate. Gate enforcement is also globally switched by
// config.billing.gateEnforced so the patch is INERT on the existing legacy
// tenant until the operator sets up Stripe + assigns plans, then flips it on.
// ============================================================
import { query, one } from "../db/pool.js";
import { config } from "../config.js";

export const PAID_PLANS = ["starter", "growth", "enterprise"] as const;
export type Plan = "free" | (typeof PAID_PLANS)[number];

// Marketing/entitlement catalog. maxSlots caps the checkout quantity per plan
// (CLAUDE.md: Starter up to 3, Growth up to 15). enterprise is contact-sales.
export const PLAN_CATALOG: Record<string, { label: string; maxSlots: number; selfServe: boolean }> = {
  free: { label: "Free / Rehearsal", maxSlots: 0, selfServe: false },
  starter: { label: "Starter", maxSlots: 3, selfServe: true },
  growth: { label: "Growth", maxSlots: 15, selfServe: true },
  enterprise: { label: "Enterprise", maxSlots: 1000, selfServe: false },
};

export interface OrgBillingState {
  orgId: string;
  plan: Plan;
  status: string; // inactive | active | trialing | past_due | canceled | ...
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  paidCloneSlots: number;
  currentPeriodEnd: string | null;
}

const DEFAULT_STATE = (orgId: string): OrgBillingState => ({
  orgId,
  plan: "free",
  status: "inactive",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  paidCloneSlots: 0,
  currentPeriodEnd: null,
});

/** Read an org's billing state, falling back to the free/inactive default. */
export async function getOrgBillingState(orgId: string): Promise<OrgBillingState> {
  try {
    const row = await one<any>(
      `SELECT org_id, plan, status, stripe_customer_id, stripe_subscription_id, paid_clone_slots, current_period_end
         FROM org_billing WHERE org_id = $1`,
      [orgId],
    );
    if (!row) return DEFAULT_STATE(orgId);
    return {
      orgId,
      plan: (row.plan ?? "free") as Plan,
      status: row.status ?? "inactive",
      stripeCustomerId: row.stripe_customer_id ?? null,
      stripeSubscriptionId: row.stripe_subscription_id ?? null,
      paidCloneSlots: Number(row.paid_clone_slots ?? 0),
      currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
    };
  } catch {
    return DEFAULT_STATE(orgId);
  }
}

/** Upsert billing state (used by the webhook + checkout customer creation). */
export async function upsertOrgBillingState(
  orgId: string,
  patch: Partial<Omit<OrgBillingState, "orgId">>,
): Promise<void> {
  // The UPDATE clause references the raw params ($2..$7) — NOT EXCLUDED — so a
  // partial patch preserves existing columns (EXCLUDED would carry the literal
  // INSERT defaults 'free'/'inactive'/0 and silently clobber them). The VALUES
  // COALESCEs only supply defaults for a first-time INSERT (NOT NULL columns).
  await query(
    `INSERT INTO org_billing (org_id, plan, status, stripe_customer_id, stripe_subscription_id, paid_clone_slots, current_period_end, updated_at)
     VALUES ($1,
             COALESCE($2,'free'), COALESCE($3,'inactive'),
             $4, $5, COALESCE($6,0), $7, now())
     ON CONFLICT (org_id) DO UPDATE SET
       plan                   = COALESCE($2, org_billing.plan),
       status                 = COALESCE($3, org_billing.status),
       stripe_customer_id     = COALESCE($4, org_billing.stripe_customer_id),
       stripe_subscription_id = COALESCE($5, org_billing.stripe_subscription_id),
       paid_clone_slots       = COALESCE($6, org_billing.paid_clone_slots),
       current_period_end     = COALESCE($7, org_billing.current_period_end),
       updated_at             = now()`,
    [
      orgId,
      patch.plan ?? null,
      patch.status ?? null,
      patch.stripeCustomerId ?? null,
      patch.stripeSubscriptionId ?? null,
      patch.paidCloneSlots ?? null,
      patch.currentPeriodEnd ?? null,
    ],
  );
}

/** Count an org's LIVE clones (agents with a golden persona pinned). */
export async function countLiveClones(orgId: string): Promise<number> {
  try {
    const row = await one<{ n: string }>(
      `SELECT COUNT(*)::int AS n FROM agents WHERE org_id = $1 AND golden_persona_id IS NOT NULL`,
      [orgId],
    );
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Whether this specific agent already occupies a live slot (golden pinned). */
export async function agentIsLive(agentId: string, orgId: string): Promise<boolean> {
  try {
    const row = await one<{ id: string }>(
      `SELECT id FROM agents WHERE id = $1 AND org_id = $2 AND golden_persona_id IS NOT NULL`,
      [agentId, orgId],
    );
    return !!row;
  } catch {
    return false;
  }
}

export type GoLiveCode = "ok" | "gate_disabled" | "no_subscription" | "no_slot" | "error";

export interface GoLiveDecision {
  allowed: boolean;
  code: GoLiveCode;
  reason: string;
  plan: Plan;
  status: string;
  slots: number;      // paid_clone_slots
  liveClones: number; // slots currently occupied
}

function activePaid(state: OrgBillingState): boolean {
  return (PAID_PLANS as readonly string[]).includes(state.plan) && (state.status === "active" || state.status === "trialing");
}

/**
 * THE FREE->PAID LIVE GATE. Call before promoting a clone to live OR before a
 * live (zoom) join. Returns allowed + a machine code + a human reason.
 *
 * - Global switch off (config.billing.gateEnforced=false) -> always allowed
 *   (code "gate_disabled"): the patch is inert until billing is turned on.
 * - No active paid subscription -> blocked ("no_subscription").
 * - Active sub but no free slot for a NEW live clone -> blocked ("no_slot").
 * - An already-live clone (its slot is already counted) needs only the active
 *   subscription (so scheduled/instant re-joins of a paid clone always pass).
 */
export async function orgCanGoLive(orgId: string, agentId: string): Promise<GoLiveDecision> {
  try {
    const state = await getOrgBillingState(orgId);
    const base = { plan: state.plan, status: state.status, slots: state.paidCloneSlots };

    if (!config.billing.gateEnforced) {
      const liveClones = await countLiveClones(orgId);
      return { allowed: true, code: "gate_disabled", reason: "billing gate disabled", ...base, liveClones };
    }

    if (!activePaid(state)) {
      const liveClones = await countLiveClones(orgId);
      return {
        allowed: false,
        code: "no_subscription",
        reason: "Going live requires an active paid plan. Upgrade to put this clone live — rehearsal stays free.",
        ...base,
        liveClones,
      };
    }

    const alreadyLive = await agentIsLive(agentId, orgId);
    const liveClones = await countLiveClones(orgId);
    const required = liveClones + (alreadyLive ? 0 : 1);
    if (required > state.paidCloneSlots) {
      return {
        allowed: false,
        code: "no_slot",
        reason: `All ${state.paidCloneSlots} paid clone slot(s) are in use. Add a clone to your plan to put another one live.`,
        ...base,
        liveClones,
      };
    }
    return { allowed: true, code: "ok", reason: "active subscription with an available clone slot", ...base, liveClones };
  } catch (err) {
    // Fail-OPEN: never block a live call on a billing-lookup error.
    console.warn("[billing] orgCanGoLive failed (fail-open, allowing):", (err as Error).message);
    return { allowed: true, code: "error", reason: "billing check unavailable — allowing (fail-open)", plan: "free", status: "unknown", slots: 0, liveClones: 0 };
  }
}
