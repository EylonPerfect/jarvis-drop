// ============================================================
// PHASE 2 — small tenancy helpers shared across routes.
// ============================================================
import { one, query } from "../db/pool.js";
import { getSetting, setSetting } from "./settingsStore.js";
import { encryptSecret, decryptSecret, isEncrypted, credAad } from "./cryptoCreds.js";

/**
 * True iff `agentId` belongs to `org`. Gate every :agentId handler with this so
 * the (many) child-table queries filtered only by agent_id (clone_sources,
 * persona_versions, calibration_*, debriefs, live_calls, …) are safe: an agent
 * id is globally unique, so once we've confirmed it's this org's agent, its
 * children are this org's too.
 */
export async function agentInOrg(agentId: string, org: string): Promise<boolean> {
  const row = await one<{ id: string }>(`SELECT id FROM agents WHERE id = $1 AND org_id = $2`, [agentId, org]);
  return !!row;
}

// The org-level default demo/product account (Task 6). Stored per-org under this
// settings key; used when a clone has no own demo_login of its own.
export const ORG_DEMO_LOGIN_KEY = "demo_login:__org__";

export interface DemoLogin {
  system?: string; url?: string; notes?: string; email?: string; password?: string;
}

// The settings key holding a clone's own demo creds.
export const agentDemoKey = (agentId: string) => `demo_login:${agentId}`;

/**
 * Encrypt a demo-login blob's password before storage (bound to org+key). Store
 * the result via setSetting. Password is left as-is if already encrypted (so a
 * merge that kept the previous encrypted value doesn't double-encrypt) or empty.
 */
export function sealDemoLogin(org: string, key: string, value: DemoLogin): DemoLogin {
  const pw = value.password ?? "";
  return { ...value, password: pw && !isEncrypted(pw) ? encryptSecret(pw, credAad(org, key)) : pw };
}

/** Decrypt a stored demo-login's password (for the login/bridge path only). */
export function openDemoLogin(org: string, key: string, value: DemoLogin | null): DemoLogin | null {
  if (!value) return null;
  const pw = value.password ?? "";
  return { ...value, password: pw ? decryptSecret(pw, credAad(org, key)) : "" };
}

// ---- org-level demo account (Task 6), password encrypted at rest ----
export async function getOrgDemoLogin(org: string): Promise<DemoLogin | null> {
  // Returns the stored blob with the password STILL encrypted — callers that
  // only need email/hasPassword can use it directly; the bridge path uses
  // getOrgDemoLoginSecret to get plaintext.
  return getSetting<DemoLogin>(org, ORG_DEMO_LOGIN_KEY);
}
export async function getOrgDemoLoginSecret(org: string): Promise<DemoLogin | null> {
  return openDemoLogin(org, ORG_DEMO_LOGIN_KEY, await getSetting<DemoLogin>(org, ORG_DEMO_LOGIN_KEY));
}
export async function setOrgDemoLogin(org: string, value: DemoLogin): Promise<void> {
  await setSetting(org, ORG_DEMO_LOGIN_KEY, sealDemoLogin(org, ORG_DEMO_LOGIN_KEY, value));
}

/**
 * Resolve the plaintext demo/product creds for a clone the way the login bridge
 * should: the clone's own creds → the org default → (caller adds the global file
 * fallback if it wants). Decrypts as it reads. Server-side only.
 */
export async function resolveDemoLoginSecret(org: string, agentId: string): Promise<DemoLogin | null> {
  const own = await getSetting<DemoLogin>(org, agentDemoKey(agentId));
  if (own && (own.email ?? "").trim()) return openDemoLogin(org, agentDemoKey(agentId), own);
  return getOrgDemoLoginSecret(org);
}

/**
 * One-time, idempotent backfill: encrypt any plaintext demo_login passwords
 * already in `settings` (per-agent `demo_login:<id>` and org-level
 * `demo_login:__org__`), across every org, using each row's own org_id as AAD.
 * No-op when encryption is disabled or a value is already encrypted. Returns the
 * number of rows updated.
 */
export async function encryptExistingDemoLogins(): Promise<number> {
  const rows = await query<{ org_id: string; key: string; value: DemoLogin }>(
    `SELECT org_id, key, value FROM settings WHERE key LIKE 'demo_login:%'`,
  );
  let updated = 0;
  for (const r of rows) {
    const pw = r.value?.password ?? "";
    if (!pw || isEncrypted(pw)) continue;
    const sealed = sealDemoLogin(r.org_id, r.key, r.value);
    if (sealed.password === pw) continue; // encryption disabled (no key) — leave as-is
    await setSetting(r.org_id, r.key, sealed);
    updated++;
  }
  return updated;
}
