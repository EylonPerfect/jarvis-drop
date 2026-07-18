// ============================================================
// PHASE 2 — Real deletion / HARD purge path.
//
// Authoritative decision (CLAUDE.md › DATA GOVERNANCE, 2026-07-18):
//   delete org / clone / call -> HARD purge of DB rows + stored files +
//   e2b artifacts + REVOKE the ElevenLabs cloned voice + WIPE stored product
//   credentials. Not soft-delete. When a customer leaves we hold neither their
//   biometric voice likeness nor their CRM/product keys.
//
// Shape of every purge:
//   1. GATHER external identifiers FIRST (ElevenLabs api key + voice ids, e2b
//      sandbox ids, on-disk artifact dirs) — BEFORE the DB rows that hold them
//      are deleted.
//   2. DB purge runs in ONE transaction (withTx): all rows + the audit record
//      commit atomically, or nothing does. A crash mid-purge leaves the org
//      fully intact, never half-deleted.
//   3. External side effects (ElevenLabs voice DELETE, e2b kill, fs rm) run
//      AFTER commit, best-effort with logged retry, and their outcome is written
//      as a second audit row. They are external systems: we cannot make them
//      transactional with Postgres, so the DB is the source of truth and the
//      external cleanup is idempotent + retried.
// ============================================================
import type { PoolClient } from "pg";
import { pool, query, one, withTx } from "../db/pool.js";
import { config } from "../config.js";

// On-disk artifact root (per-call screenshots + timelines, and the legacy
// product-login file). Matches routes/live.ts (`AH`), overridable for tests.
const AH = process.env.AH_DIR ?? "/app/ah";

// Every org-scoped table a purge must clear. Mirrors the tenancy.sql backfill
// set + settings + cost_entries. audit_log is intentionally ABSENT (it records
// the purge and must survive it).
const TENANT_TABLES = [
  "agents", "tasks", "reminders", "time_entries", "memory_facts", "style_profiles",
  "knowledge_sources", "collections", "tool_toggles", "provider_keys", "files", "cost_entries",
  "approvals", "settings", "agent_activity", "agent_comms", "agent_runs", "meetings",
  "integrations", "persona_versions", "calibration_sessions", "calibration_turns",
  "clone_sources", "debriefs", "live_calls", "rehearsal_grades", "company_people", "ai_providers",
];

// ---- small helpers ---------------------------------------------------------

async function retry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<{ ok: boolean; error?: string }> {
  let lastErr = "";
  for (let i = 1; i <= attempts; i++) {
    try { await fn(); return { ok: true }; }
    catch (e) {
      lastErr = (e as Error).message ?? String(e);
      if (i < attempts) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  console.warn(`[purge] best-effort step failed after ${attempts} attempts: ${label}: ${lastErr}`);
  return { ok: false, error: lastErr };
}

async function writeAudit(
  db: PoolClient | null,
  row: { actor?: string; action: string; org_id: string; target: string; detail: Record<string, unknown> },
): Promise<void> {
  const sql = `INSERT INTO audit_log (actor, action, org_id, target, detail) VALUES ($1,$2,$3,$4,$5)`;
  const params = [row.actor ?? "system", row.action, row.org_id, row.target, JSON.stringify(row.detail)];
  if (db) await db.query(sql, params);
  else await query(sql, params);
}

// Revoke a set of ElevenLabs voice ids using the org's OWN api key. Only the
// org's cloned/generated voices are ours to delete; premade/library ids return
// an error which we swallow (best-effort). Returns per-voice outcomes.
async function revokeElevenVoices(apiKey: string | undefined, voiceIds: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (!apiKey) { for (const v of voiceIds) out[v] = false; return out; }
  for (const vid of voiceIds) {
    const r = await retry(`elevenlabs delete voice ${vid}`, async () => {
      const resp = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(vid)}`, {
        method: "DELETE", headers: { "xi-api-key": apiKey },
      });
      // 200 = deleted; 400/404 = already gone / not ours (premade) -> treat as settled, don't retry.
      if (!resp.ok && resp.status >= 500) throw new Error(`status ${resp.status}`);
    });
    out[vid] = r.ok;
  }
  return out;
}

async function killSandboxes(ids: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (!ids.length) return out;
  let Sandbox: any;
  try { ({ Sandbox } = await import("@e2b/desktop")); } catch { for (const id of ids) out[id] = false; return out; }
  for (const id of ids) {
    const r = await retry(`e2b kill ${id}`, async () => {
      const d = await Sandbox.connect(id);
      await d.kill();
    });
    out[id] = r.ok;
  }
  return out;
}

async function rmDirs(dirs: string[]): Promise<number> {
  const { rm } = await import("node:fs/promises");
  let removed = 0;
  for (const d of dirs) {
    const r = await retry(`rm ${d}`, async () => { await rm(d, { recursive: true, force: true }); });
    if (r.ok) removed++;
  }
  return removed;
}

// Collect the distinct ElevenLabs voice ids an org owns: agents.voice_id plus
// each persona's voice.elevenlabs_voice_id.
async function orgVoiceIds(org: string): Promise<string[]> {
  const rows = await query<{ voice_id: string | null; persona: any }>(
    `SELECT voice_id, persona FROM agents WHERE org_id = $1`, [org],
  );
  const set = new Set<string>();
  for (const r of rows) {
    if (r.voice_id) set.add(r.voice_id);
    const pv = r.persona?.voice?.elevenlabs_voice_id;
    if (typeof pv === "string" && pv) set.add(pv);
  }
  return [...set];
}

async function orgElevenKey(org: string): Promise<string | undefined> {
  const row = await one<{ values: Record<string, string> }>(
    `SELECT values FROM integrations WHERE org_id = $1 AND id = 'elevenlabs'`, [org],
  );
  return row?.values?.apiKey?.trim() || undefined;
}

// ---- PURGE: one org (customer leaves) --------------------------------------
export interface PurgeResult {
  ok: boolean;
  target: string;
  deleted: Record<string, number>;
  external: { voices?: Record<string, boolean>; sandboxes?: Record<string, boolean>; dirsRemoved?: number };
}

/**
 * HARD-purge an entire org. Never touches another org's rows. The org's users
 * are NOT deleted (a user may belong to other orgs) — only this org's
 * memberships + sessions go. Refuses to purge the legacy org unless forced.
 */
export async function purgeOrg(org: string, opts: { actor?: string; force?: boolean } = {}): Promise<PurgeResult> {
  if (org === config.legacyOrgId && !opts.force) {
    throw new Error("refusing to purge the legacy org without { force: true }");
  }
  // 1) gather external identifiers BEFORE deleting the rows that hold them.
  const elevenKey = await orgElevenKey(org);
  const voiceIds = await orgVoiceIds(org);
  const sandboxes = (await query<{ sandbox_id: string }>(
    `SELECT DISTINCT sandbox_id FROM live_calls WHERE org_id = $1 AND sandbox_id IS NOT NULL`, [org],
  )).map((r) => r.sandbox_id);
  const shotDirs = (await query<{ id: string }>(`SELECT id FROM clone_sources WHERE org_id = $1`, [org]))
    .map((r) => `${AH}/shots/${r.id}`);
  if (org === config.legacyOrgId) shotDirs.push(`${AH}/gp-login.json`); // legacy on-disk product creds

  // 2) atomic DB purge + core audit record.
  const deleted: Record<string, number> = {};
  await withTx(async (client) => {
    for (const t of TENANT_TABLES) {
      const res = await client.query(`DELETE FROM ${t} WHERE org_id = $1`, [org]);
      deleted[t] = res.rowCount ?? 0;
    }
    deleted["sessions"] = (await client.query(`DELETE FROM sessions WHERE org_id = $1`, [org])).rowCount ?? 0;
    deleted["memberships"] = (await client.query(`DELETE FROM memberships WHERE org_id = $1`, [org])).rowCount ?? 0;
    deleted["orgs"] = (await client.query(`DELETE FROM orgs WHERE id = $1`, [org])).rowCount ?? 0;
    await writeAudit(client, { actor: opts.actor, action: "purge_org", org_id: org, target: org, detail: { deleted } });
  });

  // 3) best-effort external cleanup, then a second audit row for the outcome.
  const voices = await revokeElevenVoices(elevenKey, voiceIds);
  const sbx = await killSandboxes(sandboxes);
  const dirsRemoved = await rmDirs(shotDirs);
  await writeAudit(null, {
    actor: opts.actor, action: "purge_org_external", org_id: org, target: org,
    detail: { voices, sandboxes: sbx, dirsRemoved, hadElevenKey: !!elevenKey },
  });

  return { ok: true, target: org, deleted, external: { voices, sandboxes: sbx, dirsRemoved } };
}

// ---- PURGE: one clone (agent) ----------------------------------------------
/**
 * HARD-purge a single clone and its entire footprint within its org. Caller
 * must already have confirmed the agent belongs to `org` (routes gate with
 * agentInOrg); we re-scope every statement by org_id anyway (defence in depth).
 */
export async function purgeAgent(org: string, agentId: string, opts: { actor?: string } = {}): Promise<PurgeResult> {
  // 1) gather this agent's external identifiers first.
  const agent = await one<{ voice_id: string | null; persona: any }>(
    `SELECT voice_id, persona FROM agents WHERE id = $1 AND org_id = $2`, [agentId, org],
  );
  if (!agent) return { ok: false, target: agentId, deleted: {}, external: {} };
  const voiceIds = [agent.voice_id, agent.persona?.voice?.elevenlabs_voice_id]
    .filter((v): v is string => typeof v === "string" && !!v);
  const elevenKey = await orgElevenKey(org);
  const sandboxes = (await query<{ sandbox_id: string }>(
    `SELECT DISTINCT sandbox_id FROM live_calls WHERE org_id = $1 AND agent_id = $2 AND sandbox_id IS NOT NULL`, [org, agentId],
  )).map((r) => r.sandbox_id);
  const shotDirs = (await query<{ id: string }>(`SELECT id FROM clone_sources WHERE org_id = $1 AND agent_id = $2`, [org, agentId]))
    .map((r) => `${AH}/shots/${r.id}`);

  // 2) atomic DB purge (child rows -> agent -> its settings keys) + audit.
  const deleted: Record<string, number> = {};
  await withTx(async (client) => {
    const del = async (label: string, sql: string, params: unknown[]) => {
      deleted[label] = ((await client.query(sql, params)).rowCount ?? 0);
    };
    // calibration_turns key on session_id -> subquery scoped by org + agent.
    await del("calibration_turns",
      `DELETE FROM calibration_turns WHERE session_id IN (SELECT id FROM calibration_sessions WHERE agent_id = $1 AND org_id = $2)`, [agentId, org]);
    for (const t of ["agent_runs", "agent_activity", "agent_comms", "calibration_sessions",
      "clone_sources", "persona_versions", "debriefs", "rehearsal_grades", "live_calls", "meetings"]) {
      await del(t, `DELETE FROM ${t} WHERE agent_id = $1 AND org_id = $2`, [agentId, org]);
    }
    // per-agent settings keys: demo_login:<id>, pipeline:<id>, fidelity_report:<id>,
    // verify_result:<id>, redteam_result:<id>, present:<id>, state:<id>, … (suffix match).
    await del("settings", `DELETE FROM settings WHERE org_id = $1 AND key LIKE $2`, [org, `%:${agentId}`]);
    await del("agents", `DELETE FROM agents WHERE id = $1 AND org_id = $2`, [agentId, org]);
    await writeAudit(client, { actor: opts.actor, action: "purge_agent", org_id: org, target: agentId, detail: { deleted } });
  });

  // 3) best-effort external cleanup + outcome audit.
  const voices = await revokeElevenVoices(elevenKey, voiceIds);
  const sbx = await killSandboxes(sandboxes);
  const dirsRemoved = await rmDirs(shotDirs);
  await writeAudit(null, {
    actor: opts.actor, action: "purge_agent_external", org_id: org, target: agentId,
    detail: { voices, sandboxes: sbx, dirsRemoved },
  });

  return { ok: true, target: agentId, deleted, external: { voices, sandboxes: sbx, dirsRemoved } };
}

// ---- PURGE: one call -------------------------------------------------------
/**
 * HARD-purge a single live_call: the row, its e2b sandbox, and its persisted
 * transcript + on-disk film (screenshots/timeline). Scoped by org so one org
 * can never purge another's call.
 */
export async function purgeCall(org: string, callId: string, opts: { actor?: string } = {}): Promise<PurgeResult> {
  const call = await one<{ id: string; sandbox_id: string | null; agent_id: string | null; started_at: string }>(
    `SELECT id, sandbox_id, agent_id, started_at FROM live_calls WHERE id = $1 AND org_id = $2`, [callId, org],
  );
  if (!call) return { ok: false, target: callId, deleted: {}, external: {} };
  const sandboxes = call.sandbox_id ? [call.sandbox_id] : [];
  // The transcript this call produced is a clone_source of kind 'live_call'
  // captured at end; correlate by same agent + created around/after the call.
  const sources = call.agent_id
    ? (await query<{ id: string }>(
        `SELECT id FROM clone_sources WHERE org_id = $1 AND agent_id = $2 AND kind = 'live_call' AND created_at >= $3`,
        [org, call.agent_id, call.started_at])).map((r) => r.id)
    : [];
  const shotDirs = sources.map((id) => `${AH}/shots/${id}`);

  const deleted: Record<string, number> = {};
  await withTx(async (client) => {
    deleted["rehearsal_grades"] = (await client.query(`DELETE FROM rehearsal_grades WHERE call_id = $1 AND org_id = $2`, [callId, org])).rowCount ?? 0;
    for (const id of sources) {
      deleted["clone_sources"] = (deleted["clone_sources"] ?? 0) + ((await client.query(`DELETE FROM clone_sources WHERE id = $1 AND org_id = $2`, [id, org])).rowCount ?? 0);
    }
    deleted["live_calls"] = (await client.query(`DELETE FROM live_calls WHERE id = $1 AND org_id = $2`, [callId, org])).rowCount ?? 0;
    await writeAudit(client, { actor: opts.actor, action: "purge_call", org_id: org, target: callId, detail: { deleted } });
  });

  const sbx = await killSandboxes(sandboxes);
  const dirsRemoved = await rmDirs(shotDirs);
  await writeAudit(null, { actor: opts.actor, action: "purge_call_external", org_id: org, target: callId, detail: { sandboxes: sbx, dirsRemoved } });

  return { ok: true, target: callId, deleted, external: { sandboxes: sbx, dirsRemoved } };
}
