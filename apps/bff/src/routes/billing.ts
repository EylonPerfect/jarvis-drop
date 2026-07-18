import type { FastifyInstance, FastifyRequest } from "fastify";
import { one } from "../db/pool.js";
import { config } from "../config.js";
import { orgId } from "../lib/auth.js";
import {
  lemonSqueezyConfigured,
  createCheckout,
  getSubscription,
  mapSubscription,
  verifyWebhookSignature,
  LemonError,
} from "../lib/lemonsqueezy.js";
import {
  getOrgBillingState,
  upsertOrgBillingState,
  countLiveClones,
  PLAN_CATALOG,
  PAID_PLANS,
  type Plan,
} from "../lib/billing.js";
import { emit, EVENTS } from "../lib/analytics.js";
import { notifyFunnelEvent } from "../lib/alerts.js";

// ============================================================
// BILLING routes — Lemon Squeezy hosted Checkout + Customer Portal + webhook,
// plus the org's current billing state. Backs the pricing-page CTAs and the
// in-app Billing screen. Self-serve endpoints degrade gracefully to a clean
// "billing not configured" (400) when LEMONSQUEEZY_API_KEY is unset; the webhook
// is X-Signature verified and exempt from the shared BFF auth (LS calls it).
//
// The org_billing table + lib/billing.ts gate are provider-neutral and UNCHANGED
// from the Stripe version: the stripe_customer_id / stripe_subscription_id
// columns now hold the Lemon Squeezy customer id / subscription id.
// ============================================================

// Reverse-map an LS variant id -> our plan key (config.billing.variants).
function planForVariant(variantId: string | null | undefined): Plan | null {
  if (variantId == null) return null;
  const v = config.billing.variants;
  if (String(variantId) === String(v.starter)) return "starter";
  if (String(variantId) === String(v.growth)) return "growth";
  return null;
}

function variantForPlan(plan: string): string | undefined {
  if (plan === "starter") return config.billing.variants.starter;
  if (plan === "growth") return config.billing.variants.growth;
  return undefined;
}

// Base URL for the post-checkout redirect: explicit override, else the request
// Origin, else the first configured web origin.
function webBase(req: FastifyRequest): string {
  const origin = (req.headers["origin"] as string | undefined) || "";
  return (config.billing.successUrl ? "" : origin) || config.webOrigin[0] || "http://localhost:5173";
}

// Find the org a webhook event belongs to: prefer meta.custom_data.org_id, else
// look it up by the stored LS subscription/customer id.
async function resolveOrg(event: any): Promise<string | null> {
  const custom = event?.meta?.custom_data?.org_id;
  if (custom) return String(custom);
  const data = event?.data ?? {};
  const subId = data?.id != null ? String(data.id) : null;
  const custId = data?.attributes?.customer_id != null ? String(data.attributes.customer_id) : null;
  const row = await one<{ org_id: string }>(
    `SELECT org_id FROM org_billing WHERE stripe_subscription_id = $1 OR stripe_customer_id = $2 LIMIT 1`,
    [subId, custId],
  ).catch(() => null);
  return row?.org_id ?? null;
}

export default async function billingRoutes(app: FastifyInstance) {
  // ---- current org billing state (backs the Billing screen) ----
  app.get("/api/billing", async (req) => {
    const org = orgId(req);
    const state = await getOrgBillingState(org);
    const liveClones = await countLiveClones(org);
    return {
      configured: lemonSqueezyConfigured(),
      enforced: config.billing.gateEnforced,
      provider: "lemonsqueezy",
      state,
      liveClones,
      slotsAvailable: Math.max(0, state.paidCloneSlots - liveClones),
      catalog: PLAN_CATALOG,
    };
  });

  // ---- start a hosted Checkout for a paid plan ----
  app.post("/api/billing/checkout", async (req, reply) => {
    if (!lemonSqueezyConfigured()) return reply.code(400).send({ error: "billing not configured", code: "not_configured" });
    if (!config.billing.storeId) return reply.code(400).send({ error: "billing not configured (LEMONSQUEEZY_STORE_ID unset)", code: "not_configured" });
    const org = orgId(req);
    const b = (req.body ?? {}) as { plan?: string; quantity?: number };
    const plan = (b.plan ?? "").trim();
    if (!(PAID_PLANS as readonly string[]).includes(plan) || plan === "enterprise") {
      return reply.code(400).send({ error: "plan must be 'starter' or 'growth' (enterprise is contact-sales)" });
    }
    const variant = variantForPlan(plan);
    if (!variant) return reply.code(400).send({ error: `no Lemon Squeezy variant configured for plan '${plan}' (set LEMONSQUEEZY_VARIANT_${plan.toUpperCase()})`, code: "variant_missing" });
    const max = PLAN_CATALOG[plan]?.maxSlots ?? 1;
    const quantity = Math.min(Math.max(1, Math.floor(Number(b.quantity ?? 1))), max);

    try {
      const base = webBase(req);
      const co = await createCheckout({
        storeId: config.billing.storeId,
        variantId: variant,
        quantity,
        custom: { org_id: org, plan },
        redirectUrl: `${base}/#/billing?checkout=success`,
      });
      if (!co.url) return reply.code(502).send({ error: "Lemon Squeezy did not return a checkout URL" });
      return { url: co.url, id: co.id };
    } catch (e) {
      const err = e as LemonError;
      req.log.error({ err: err.message }, "checkout failed");
      return reply.code(err.status && err.status < 600 ? 502 : 500).send({ error: err.message });
    }
  });

  // ---- open the Lemon Squeezy Customer Portal (manage/update payment/cancel) ----
  app.post("/api/billing/portal", async (req, reply) => {
    if (!lemonSqueezyConfigured()) return reply.code(400).send({ error: "billing not configured", code: "not_configured" });
    const org = orgId(req);
    const state = await getOrgBillingState(org);
    if (!state.stripeSubscriptionId) return reply.code(400).send({ error: "no subscription yet — start a plan first", code: "no_subscription" });
    try {
      // LS exposes the customer-portal URL on the subscription object.
      const sub = await getSubscription(state.stripeSubscriptionId);
      const url = mapSubscription(sub).portalUrl;
      if (!url) return reply.code(502).send({ error: "Lemon Squeezy did not return a customer-portal URL" });
      return { url };
    } catch (e) {
      const err = e as LemonError;
      return reply.code(502).send({ error: err.message });
    }
  });

  // ---- Lemon Squeezy webhook: keep org_billing in sync with the subscription ----
  // Exempt from the shared BFF auth (see index.ts); authorized by X-Signature.
  app.post("/api/billing/webhook", async (req, reply) => {
    const raw = (req as any).rawBody as string | undefined;
    const sig = req.headers["x-signature"] as string | undefined;
    const check = verifyWebhookSignature(raw ?? "", sig, config.billing.webhookSecret);
    if (!check.ok) {
      req.log.warn({ reason: check.reason }, "lemonsqueezy webhook rejected");
      return reply.code(400).send({ error: `webhook signature failed: ${check.reason}` });
    }
    let event: any;
    try {
      event = JSON.parse(raw!);
    } catch {
      return reply.code(400).send({ error: "invalid JSON" });
    }

    try {
      const name = event?.meta?.event_name as string | undefined;
      const data = event?.data ?? {};
      switch (name) {
        case "subscription_created":
        case "subscription_updated":
        case "subscription_resumed":
        case "subscription_unpaused": {
          const org = await resolveOrg(event);
          if (!org) break;
          const m = mapSubscription(data);
          await upsertOrgBillingState(org, {
            plan: planForVariant(m.variantId) ?? (event?.meta?.custom_data?.plan as Plan) ?? undefined,
            status: m.status,
            stripeCustomerId: m.customerId,
            stripeSubscriptionId: m.subId,
            paidCloneSlots: m.slots,
            currentPeriodEnd: m.periodEnd,
          });
          if (name === "subscription_created") {
            // OBSERVABILITY: a NEW paid subscription = revenue signal + payment ping.
            void emit(EVENTS.MRR_CHANGE, { orgId: org, props: { plan: planForVariant(m.variantId) ?? null, slots: m.slots, kind: "new" } }).catch(() => {});
            void notifyFunnelEvent("payment", { orgId: org, plan: planForVariant(m.variantId) ?? null, slots: m.slots, subscriptionId: m.subId }).catch(() => {});
          }
          break;
        }
        case "subscription_cancelled": {
          // Cancelled = will not renew (LS keeps it live until it expires). We
          // record the mapped id/customer so a later expiry event resolves, and
          // set status 'canceled' so the gate stops new go-lives.
          const org = await resolveOrg(event);
          if (!org) break;
          const m = mapSubscription(data);
          await upsertOrgBillingState(org, {
            status: "canceled",
            stripeCustomerId: m.customerId,
            stripeSubscriptionId: m.subId,
          });
          break;
        }
        case "subscription_expired": {
          const org = await resolveOrg(event);
          if (!org) break;
          await upsertOrgBillingState(org, { status: "expired", paidCloneSlots: 0 });
          break;
        }
        case "order_created":
        default:
          break; // subscription_* events carry everything we persist
      }
    } catch (e) {
      req.log.error({ err: (e as Error).message, event: event?.meta?.event_name }, "webhook handler error");
      // 200 anyway so LS doesn't hammer retries on a non-transient bug; periodic
      // subscription_updated events reconcile state regardless.
    }
    return { received: true };
  });
}
