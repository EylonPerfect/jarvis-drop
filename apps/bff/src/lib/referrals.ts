import { query, one } from "../db/pool.js";
import { newId } from "./auth.js";

// ============================================================================
// lib/referrals.ts — PLG viral backbone: referral graph + double-sided reward
// ledger shared by all three loops (Send-to-Ava / Clone-your-team / Brag-a-clip).
//
// Reward = "free clone-month": one active reward_grants row (free_clone_month)
// = +1 COMPED clone slot for 30 days, honored by lib/billing.ts slot math.
// CONVERSION = the referred org's FIRST paid subscription (billing
// subscription_created). See PLG-DESIGN.md.
// ============================================================================

const APP_URL = (process.env.APP_PUBLIC_URL ?? "https://afterhuman.srv1797540.hstgr.cloud").replace(/\/$/, "");
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Short, url-safe, low-ambiguity code (no 0/o/1/l/i).
function genCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 7; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/** Assign (once) and return an org's shareable referral code. Idempotent + race-safe. */
export async function ensureRefCode(orgId: string): Promise<string> {
  const row = await one<{ ref_code: string | null }>(`SELECT ref_code FROM orgs WHERE id=$1`, [orgId]);
  if (row?.ref_code) return row.ref_code;
  for (let i = 0; i < 6; i++) {
    const code = genCode();
    try {
      const upd = await one<{ ref_code: string }>(
        `UPDATE orgs SET ref_code=$2 WHERE id=$1 AND ref_code IS NULL RETURNING ref_code`, [orgId, code]);
      if (upd?.ref_code) return upd.ref_code;
      const cur = await one<{ ref_code: string | null }>(`SELECT ref_code FROM orgs WHERE id=$1`, [orgId]);
      if (cur?.ref_code) return cur.ref_code; // set concurrently
    } catch { /* unique collision on the code — retry with a new one */ }
  }
  throw new Error("could not assign referral code");
}

/** Resolve a referral code to its owning org (null if unknown). */
export async function resolveRefCode(code: string): Promise<{ orgId: string } | null> {
  const c = (code || "").trim().toLowerCase();
  if (!c) return null;
  const row = await one<{ id: string }>(`SELECT id FROM orgs WHERE ref_code=$1`, [c]);
  return row ? { orgId: row.id } : null;
}

/** Build the attributed share link (defaults to the public "meet Ava" landing). */
export function buildRefLink(code: string, opts?: { loop?: string; channel?: string; target?: "ava" | "signup" }): string {
  const params = new URLSearchParams({ ref: code, utm_source: "referral" });
  if (opts?.channel) params.set("utm_medium", opts.channel);
  if (opts?.loop) params.set("ref_loop", opts.loop);
  // Query lives BEFORE the hash so the SPA reads it from location.search on any
  // route; the landing captures + persists it, then attaches it at signup.
  const hash = opts?.target === "signup" ? "#/signup" : "";
  return `${APP_URL}/?${params.toString()}${hash}`;
}

export interface SignupMeta {
  referredEmail?: string | null;
  demoSession?: string | null;
  loop?: string;
  channel?: string;
  wowTrigger?: string | null;
}

/**
 * Record the graph edge at signup: the referred org came from refCode's org.
 * Guards: unknown code -> null; self-referral -> null; already-attributed org
 * -> null (unique(referred_org)). Returns the referral id on success.
 */
export async function attachSignup(referredOrg: string, refCode: string, meta: SignupMeta = {}): Promise<string | null> {
  const r = await resolveRefCode(refCode);
  if (!r) return null;
  if (r.orgId === referredOrg) return null; // no self-referral
  const id = newId("ref");
  try {
    await query(
      `INSERT INTO referrals
         (id, referrer_org, ref_code, loop, channel, wow_trigger, referred_email, referred_org, demo_session, status, signed_up_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'signed_up', now())`,
      [id, r.orgId, (refCode || "").trim().toLowerCase(), meta.loop ?? "ava", meta.channel ?? "link",
        meta.wowTrigger ?? null, meta.referredEmail ?? null, referredOrg, meta.demoSession ?? null]);
    return id;
  } catch {
    return null; // referred_org already attributed — keep the first
  }
}

async function grantReward(orgId: string, referralId: string, role: "referrer" | "referred"): Promise<void> {
  const id = newId("rw");
  const expires = new Date(Date.now() + MONTH_MS).toISOString();
  try {
    await query(
      `INSERT INTO reward_grants (id, org_id, kind, months, reason, referral_id, role, status, expires_at)
       VALUES ($1,$2,'free_clone_month',1,'referral',$3,$4,'active',$5)`,
      [id, orgId, referralId, role, expires]);
  } catch { /* unique(referral_id, role) — already granted (idempotent) */ }
}

/**
 * Fire on the referred org's first paid subscription: mark the referral
 * converted and grant BOTH sides a free clone-month. Idempotent (safe on
 * webhook retries). No-op if this org wasn't referred.
 */
export async function convertReferral(referredOrg: string): Promise<{ referralId: string; referrerOrg: string } | null> {
  const ref = await one<{ id: string; referrer_org: string; status: string }>(
    `SELECT id, referrer_org, status FROM referrals WHERE referred_org=$1 ORDER BY created_at LIMIT 1`, [referredOrg]);
  if (!ref) return null;
  if (ref.status !== "converted" && ref.status !== "rewarded") {
    await query(`UPDATE referrals SET status='converted', converted_at=now() WHERE id=$1 AND status NOT IN ('converted','rewarded')`, [ref.id]);
  }
  await grantReward(ref.referrer_org, ref.id, "referrer");
  await grantReward(referredOrg, ref.id, "referred");
  await query(`UPDATE referrals SET status='rewarded', rewarded_at=now() WHERE id=$1 AND status <> 'rewarded'`, [ref.id]);
  return { referralId: ref.id, referrerOrg: ref.referrer_org };
}

/** Active free_clone_month grants = extra live clone slots the org has earned. */
export async function countCompedSlots(orgId: string): Promise<number> {
  try {
    const row = await one<{ n: string }>(
      `SELECT COUNT(*)::int AS n FROM reward_grants
        WHERE org_id=$1 AND kind='free_clone_month' AND status='active'
          AND (expires_at IS NULL OR expires_at > now())`, [orgId]);
    return Number(row?.n ?? 0);
  } catch { return 0; }
}

export interface RefStats {
  refCode: string;
  link: string;
  invited: number;   // referral rows (signed_up and beyond)
  converted: number; // reached paid
  rewardsActive: number;
  rewards: { id: string; role: string | null; expiresAt: string | null; status: string }[];
  referrals: { status: string; referredEmail: string | null; loop: string; createdAt: string; convertedAt: string | null }[];
}

/** Everything the referral dashboard needs for one org. */
export async function listForOrg(orgId: string): Promise<RefStats> {
  const refCode = await ensureRefCode(orgId);
  const rows = await query<{ status: string; referred_email: string | null; loop: string; created_at: string; converted_at: string | null }>(
    `SELECT status, referred_email, loop, created_at, converted_at FROM referrals WHERE referrer_org=$1 ORDER BY created_at DESC`, [orgId]);
  const grants = await query<{ id: string; role: string | null; expires_at: string | null; status: string }>(
    `SELECT id, role, expires_at, status FROM reward_grants WHERE org_id=$1 ORDER BY created_at DESC`, [orgId]);
  const converted = rows.filter((r) => r.status === "converted" || r.status === "rewarded").length;
  const rewardsActive = await countCompedSlots(orgId);
  return {
    refCode,
    link: buildRefLink(refCode, { loop: "ava", channel: "link" }),
    invited: rows.length,
    converted,
    rewardsActive,
    rewards: grants.map((g) => ({ id: g.id, role: g.role, expiresAt: g.expires_at, status: g.status })),
    referrals: rows.map((r) => ({ status: r.status, referredEmail: r.referred_email, loop: r.loop, createdAt: r.created_at, convertedAt: r.converted_at })),
  };
}
