import { query } from "../db/pool.js";

// ============================================================================
// ANALYTICS — the ONE emit layer for the six launch metrics (CLAUDE.md BATCH 4).
// Every instrumented funnel step calls emit(): it (1) appends to the usage_events
// ledger (source of truth for the rollups in routes/metrics.ts) and (2) mirrors
// the event to PostHog (the connected analytics tool) fire-and-forget. Never
// throws into the caller — instrumentation must not break product flows.
// ============================================================================

// Canonical event names. Keep in sync with routes/metrics.ts rollups and the
// PostHog event taxonomy. Grouped by the metric they feed.
export const EVENTS = {
  // funnel / activation
  LANDING_VIEW: "landing_view",         // marketing landing page viewed
  AVA_SESSION: "ava_session",           // Ava (AH's own AI rep) demo session
  SIGNUP_STARTED: "signup_started",     // began signup
  SIGNUP: "signup",                     // account/org created  → activation denominator
  REACHED_70: "reached_70",             // a clone first crossed readiness 70 → activation numerator
  WENT_LIVE: "went_live",               // clone promoted to live / org free->paid
  // north-star + live-call health
  LIVE_CALL_RUN: "live_call_run",       // a live (non-rehearsal) call started  → NS weekly calls
  LIVE_CALL_COMPLETED: "live_call_completed",
  CALL_BAIL_OUT: "call_bail_out",       // clone bailed out gracefully → bail-out rate
  CALL_REPORT: "call_report",           // "report this call" filed → report rate
  // revenue
  MRR_CHANGE: "mrr_change",             // org mrr_cents changed (new/upgrade/downgrade/churn)
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS] | string;

export type EmitOpts = {
  orgId?: string | null;
  agentId?: string | null;
  callId?: string | null;
  value?: number | null;      // optional numeric (readiness score, minutes, $...)
  props?: Record<string, unknown>;
  distinctId?: string;        // PostHog distinct id (defaults to org/agent/anon)
};

const POSTHOG_HOST = (process.env.POSTHOG_HOST ?? "https://us.i.posthog.com").replace(/\/$/, "");
const POSTHOG_KEY = process.env.POSTHOG_API_KEY ?? process.env.POSTHOG_KEY ?? "";

async function toPostHog(name: string, o: EmitOpts): Promise<void> {
  if (!POSTHOG_KEY) return; // analytics-optional: no key → ledger-only, no throw
  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event: name,
        distinct_id: o.distinctId ?? o.orgId ?? o.agentId ?? "anon",
        properties: {
          ...(o.props ?? {}),
          org_id: o.orgId ?? undefined,
          agent_id: o.agentId ?? undefined,
          call_id: o.callId ?? undefined,
          value: o.value ?? undefined,
          $lib: "after-human-bff",
        },
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* PostHog is best-effort; the ledger is the source of truth */
  }
}

/** Record a funnel/usage event. Ledger write is awaited; PostHog is fired off. */
export async function emit(name: EventName, o: EmitOpts = {}): Promise<void> {
  try {
    await query(
      `INSERT INTO usage_events (name, org_id, agent_id, call_id, value, props)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [name, o.orgId ?? null, o.agentId ?? null, o.callId ?? null, o.value ?? null, JSON.stringify(o.props ?? {})],
    );
  } catch (err) {
    // A missing table (pre-migration) or DB blip must not break the product flow.
    console.error("[analytics] ledger write failed:", (err as Error).message);
  }
  void toPostHog(name, o);
}

/** Record an incremental spend event (feeds cost-runaway detection). */
export async function recordSpend(provider: string, costUsd: number, o: { orgId?: string | null; callId?: string | null; detail?: string } = {}): Promise<void> {
  try {
    await query(
      `INSERT INTO spend_events (provider, org_id, call_id, cost_usd, detail) VALUES ($1,$2,$3,$4,$5)`,
      [provider, o.orgId ?? null, o.callId ?? null, costUsd, o.detail ?? null],
    );
  } catch (err) {
    console.error("[analytics] spend write failed:", (err as Error).message);
  }
}
