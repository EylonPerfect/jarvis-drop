// ============================================================
// Lemon Squeezy — thin REST client + webhook verifier, ZERO new dependencies.
//
// Merchant-of-record provider (handles global tax/VAT) for the self-serve
// motion. Same design as the prior Stripe layer: global `fetch` (undici) +
// node:crypto for the webhook HMAC — no `@lemonsqueezy/*` SDK, so the docker
// build needs no package.json / package-lock change.
//
// Everything degrades gracefully when LEMONSQUEEZY_API_KEY is absent:
// `lemonSqueezyConfigured()` is false and the routes return a clean
// "billing not configured" instead of crashing. LS API v1, JSON:API.
// ============================================================
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const API = "https://api.lemonsqueezy.com/v1";
const JSONAPI = "application/vnd.api+json";

export function lemonSqueezyConfigured(): boolean {
  return !!config.billing.apiKey;
}

export class LemonError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Call the Lemon Squeezy REST API (JSON:API). Throws LemonError on non-2xx. */
export async function lsRequest<T = any>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const key = config.billing.apiKey;
  if (!key) throw new LemonError("billing not configured (LEMONSQUEEZY_API_KEY unset)", 503);
  const headers: Record<string, string> = {
    authorization: `Bearer ${key}`,
    accept: JSONAPI,
  };
  if (body !== undefined) headers["content-type"] = JSONAPI;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const msg = json?.errors?.[0]?.detail || json?.errors?.[0]?.title || `LemonSqueezy ${method} ${path} → ${res.status}`;
    throw new LemonError(msg, res.status);
  }
  return json as T;
}

// ---- Checkout ------------------------------------------------------------
// Create a hosted checkout for a store+variant, quantity = clone slots, with
// our org_id/plan carried in checkout_data.custom (echoed back on the webhook
// as meta.custom_data). Returns the hosted checkout URL (data.attributes.url).
export async function createCheckout(args: {
  storeId: string;
  variantId: string;
  quantity: number;
  custom: Record<string, string>;
  redirectUrl?: string;
}): Promise<{ url: string; id: string }> {
  const variantNum = Number(args.variantId);
  const payload = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          custom: args.custom,
          // Set the subscription quantity for the variant (billable = live clones).
          variant_quantities: [{ variant_id: variantNum, quantity: Math.max(1, args.quantity) }],
        },
        ...(args.redirectUrl ? { product_options: { redirect_url: args.redirectUrl } } : {}),
      },
      relationships: {
        store: { data: { type: "stores", id: String(args.storeId) } },
        variant: { data: { type: "variants", id: String(args.variantId) } },
      },
    },
  };
  const r = await lsRequest<any>("POST", "/checkouts", payload);
  return { url: r?.data?.attributes?.url, id: r?.data?.id };
}

// ---- Subscription --------------------------------------------------------
export async function getSubscription(id: string): Promise<any> {
  const r = await lsRequest<any>("GET", `/subscriptions/${id}`);
  return r?.data;
}

// LS subscription.attributes -> the fields we persist. status map: active->active,
// on_trial->trialing (both count as an ACTIVE paid subscription for the gate);
// everything else (past_due, cancelled, expired, paused, unpaid) is stored as
// its neutral form so the gate blocks it.
export function mapSubscription(sub: any): {
  status: string;
  slots: number;
  variantId: string | null;
  customerId: string | null;
  subId: string | null;
  periodEnd: string | null;
  portalUrl: string | null;
} {
  const a = sub?.attributes ?? {};
  const lsStatus = String(a.status ?? "").toLowerCase();
  const status =
    lsStatus === "active" ? "active"
    : lsStatus === "on_trial" ? "trialing"
    : lsStatus === "cancelled" ? "canceled"
    : lsStatus || "inactive";
  const slots = Number(a.first_subscription_item?.quantity ?? 0);
  return {
    status,
    slots,
    variantId: a.variant_id != null ? String(a.variant_id) : null,
    customerId: a.customer_id != null ? String(a.customer_id) : null,
    subId: sub?.id != null ? String(sub.id) : null,
    periodEnd: a.renews_at ? new Date(a.renews_at).toISOString() : (a.ends_at ? new Date(a.ends_at).toISOString() : null),
    portalUrl: a.urls?.customer_portal ?? null,
  };
}

// ---- Webhook signature verification --------------------------------------
// LS signs the RAW request body: HMAC-SHA256(rawBody, signing secret), hex,
// delivered in the `X-Signature` header. Constant-time compared.
export function verifyWebhookSignature(
  rawBody: string,
  sigHeader: string | undefined,
  secret: string | undefined,
): { ok: boolean; reason?: string } {
  if (!secret) return { ok: false, reason: "LEMONSQUEEZY_WEBHOOK_SECRET unset" };
  if (!sigHeader) return { ok: false, reason: "missing X-Signature header" };
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expBuf = Buffer.from(expected, "utf8");
  const sigBuf = Buffer.from(sigHeader.trim(), "utf8");
  if (sigBuf.length !== expBuf.length) return { ok: false, reason: "signature length mismatch" };
  if (!timingSafeEqual(sigBuf, expBuf)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}
