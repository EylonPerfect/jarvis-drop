# Phase 2 — Tenancy Query-Scoping Map

Status of org-scoping for every BFF route file. The goal: every read/write of
tenant data is filtered by the caller's org (`req.orgId`, set by the auth hook).

**Scoping mechanics used**
- Direct tables: add `AND org_id = $n` to every WHERE, and `org_id` to every INSERT.
- `:agentId` handlers: gate with `agentInOrg(agentId, req.orgId)` (lib/tenancy.ts).
  Because an agent id is globally unique, once we confirm it's *this* org's
  agent, its child rows (clone_sources, persona_versions, calibration_*, debriefs,
  live_calls, agent_runs…) are this org's too. Child queries also get `org_id`
  where cheap (defence-in-depth).
- `settings`: PK is now `(org_id, key)`. Use `lib/settingsStore.ts`
  (`getSetting/setSetting/deleteSetting/listSettings`) — never raw `settings` SQL,
  so `ON CONFLICT (org_id, key)` lives in one place.
- Live-call blackboard (`lib/callstate.ts`): every entry carries `orgId`;
  `getCall(id, orgId)` refuses cross-org reads; `currentCallForOrg(orgId)`
  replaces the single global "current call".

Legend: **DONE** = every tenant query in the file is scoped · **PARTIAL** = the
sensitive paths are scoped, remainder TODO-marked · **TODO** = not yet scoped
(still functionally correct in access-code mode, since every request is pinned to
the legacy org — see below).

> **Why nothing breaks pre-cutover:** in `access-code` mode the auth hook pins
> every request to `org_legacy`, and every tenant column defaults to
> `'org_legacy'`. So even un-scoped (TODO) routes read/write the one legacy org,
> exactly like today's single tenant. Scoping only becomes load-bearing in
> `password` mode with multiple orgs.

## Summary

| File | Tenant tables | Status | Notes |
|---|---|---|---|
| **agents.ts** | agents, agent_activity, agent_comms, agent_runs, +child deletes, settings(agent_draft/runs) | **DONE** | roster, CRUD, run, runs, activity, comms, both DELETEs, runtime all org-scoped |
| **call.ts** | agents; callstate blackboard | **DONE** | agent-ownership gate on start; every `getCall` org-guarded |
| **lib/callstate.ts** | (in-memory) | **DONE** | per-org keying + `currentCallForOrg` |
| **auth.ts** (new) | users, orgs, memberships, sessions, settings(demo_login:__org__) | **DONE** | signup/login/logout/me/switch-org + org-level demo account (Task 6) |
| **studio.ts** | agents, clone_sources, persona_versions, calibration_*, rehearsal_grades, debriefs, settings(demo_login/verify/redteam/golden) | **DONE** | 19 `agentInOrg` gates cover every `:agentId`/agentId-in-body handler; per the gate design, child-by-`agent_id` queries + the `agentRow`/gated `UPDATE agents` helpers are org-safe once the gate passes. Source delete/settings reads defence-in-depth org-scoped |
| **fathom.ts** | agents, clone_sources, integrations | **DONE** | clone-voice/observed/observe-screens/enrich all agent+transcript scoped; **`/connect` now writes `integrations` with `org_id` + `ON CONFLICT (org_id,id)`** (was the last gap) |
| **live.ts** | live_calls, agents, persona_versions, clone_sources, settings | **DONE** | every "latest active call" read scoped `WHERE org_id=$1 [AND agent_id]`; settings via org; new `DELETE /api/live/call/:id` → `purgeCall`. Recall-exempt GET/token/act still fall back to legacy org (cookieless) — see "Exempt endpoints" |
| **integrations.ts** | integrations | **DONE** | composite PK `(org_id,id)`; `stateFor/getIntegrationValues/getConnectedIntegrationIds` + connect/test/delete all org-scoped; connect upsert is `ON CONFLICT (org_id,id)` (no cross-org clobber) |
| **admin.ts** | ALL | **DONE** | `TRUNCATE` → per-org `DELETE … WHERE org_id=$1` loop (now incl. `files`); seed limited to legacy org; new owner-gated **self-serve `DELETE /api/admin/org/:orgId`** → `purgeOrg` (own org only) |
| **aicore.ts** | ai_providers, provider_keys, settings(ai_core) | **DONE** | the all-rows `UPDATE ai_providers SET active=false` now `WHERE org_id=$1`; every provider/key read+write org-scoped; `ai_core` via settingsStore |
| **company.ts** | settings(company), company_people, agents | **DONE** | `getCompany(org)` threads org from every caller; company_people + settings org-scoped |
| **knowledge.ts** | knowledge_sources, collections | **DONE** | all CRUD + both bulk `DELETE … WHERE org_id=$1` |
| **tasks.ts** | tasks | **DONE** | incl. `DELETE FROM tasks WHERE org_id=$1` |
| **tools.ts** | tool_toggles | **DONE** | incl. bulk delete scoped |
| **calendar.ts** | reminders, time_entries | **DONE** | incl. bulk deletes scoped |
| **memory.ts** | memory_facts, style_profiles, cost_entries, settings(…) | **DONE** | tables org-scoped; vector_store/personal_intelligence/conversations via settingsStore |
| **files.ts** | files | **DONE** | `GET /api/files/:id` now `WHERE id=$1 AND org_id=$2` (evidence screenshots isolated) |
| **meetings.ts** | meetings, agents | **DONE** | incl. `DELETE FROM meetings WHERE id=$1 AND org_id=$2` |
| **approvals.ts** | approvals, settings(ledger) | **DONE** | CRUD + bulk delete + ledger all org-scoped |
| **workflows.ts** | settings(workflows/workflow_runs) | **DONE** | routed via settingsStore (helpers threaded org) |
| **cartographer.ts** | settings(site_map/site_map_diff/site_map_status) | **DONE** | settings per-org; the global run-log file left as-is |
| **coach.ts** | agents, settings(site_map) | **DONE** | |
| **command.ts** | agents, settings(feed) | **DONE** | `feed` via settingsStore; `systemContext` roster read scoped `WHERE org_id=$1` |
| **present.ts** | agents, meetings, settings(present:$id) | **DONE** | writes org-scoped; cookieless GET reads `present:$id` by unguessable id — see "Exempt endpoints" |
| **pipeline.ts** | agents, clone_sources, settings(pipeline:$id/fidelity_report:$id) | **DONE** | `agentInOrg` gates; `loadDoc/saveDoc`+Runner thread org; settings via store |
| **readiness.ts** | agents, clone_sources, persona_versions, live_calls, settings(…) | **DONE** | all 3 `:agentId` GET/act handlers gated; child tables org-scoped |
| **fidelity.ts** | agents, clone_sources, settings(call_voice_mode/fidelity_report:$id) | **DONE** | `run` gated; voice-mode + report via store |
| **system.ts** | memory_facts, agents, ai_providers, settings(ledger/slow_turns/logs) | **DONE** | counts + settings org-scoped |
| **state.ts** | settings(state:$key) | **DONE** | via settingsStore |
| **voicechat.ts** | agents, settings(elevenlabs_convai_agent) | **DONE** | session gated; ConvAI agent provisioned per-org |
| **artifacts.ts** | agents | **DONE** | roster read scoped `WHERE org_id=$1` |
| **workstation.ts** | agents | **DONE** | internal (driven by scoped call.ts); the agent read scoped `AND org_id=$2` |
| **chat.ts** | approvals | **DONE** | `queueApproval(org,…)` INSERT now carries `org_id` |
| **lib/callVision.ts** | settings(site_map) | **DONE** | `siteMapVocabulary(org)` reads via settingsStore |
| **browser.ts / voice.ts / cloneCalls.ts** | none | n/a | no direct tenant SQL (voice/cloneCalls read via already-scoped helpers) |

**Tally:** all 34 route files + `lib/callstate.ts` + `lib/callVision.ts` are now
**fully org-scoped**. Every settings access routes through `settingsStore`; every
`:agentId` handler is gated with `agentInOrg`. The hardest-first danger items
(integrations credential-clobber, admin TRUNCATE, aicore all-rows UPDATE, live
"single active call") are closed.

**Remaining, by design (not gaps):** the cookieless Recall endpoints
(`GET /api/present/*`, `GET /api/live/*`, `POST /api/live/*/token|act`,
`POST /api/meetings/webhook`) resolve org from the unguessable resource id and,
absent a cookie, fall back to the legacy org — acceptable in access-code mode;
password-mode multi-tenant hardening of the fully-cookieless bridge is the one
open follow-up (see "Exempt endpoints"). The 15 pre-existing non-tenancy `tsc`
errors (PersonaDelta/`Agent.persona`/scroll domain types) predate this patch and
are unchanged by it.

## Settings keys reference

`settings` is one table used two ways; both are handled by the composite
`(org_id, key)` PK + `settingsStore`:
- **Global-name keys** (would have collided across orgs pre-migration; now
  isolated by org_id): `ai_core, ledger, agent_draft, runs, company, feed,
  vector_store, personal_intelligence, conversations, workflows, workflow_runs,
  slow_turns, logs, call_voice_mode, live_golden_instructions, live_persona_mode,
  elevenlabs_convai_agent, site_map, site_map_diff, site_map_status`.
- **Per-agent / per-resource keys** (`…:<id>`): `demo_login:<agentId>` (creds),
  `fidelity_report:<agentId>`, `verify_result:<agentId>`,
  `redteam_result:<agentId>`, `pipeline:<agentId>`, `present:<id>`,
  `state:<key>`. Plus the new org-level `demo_login:__org__` (Task 6).

## Exempt endpoints (no session cookie)

`/api/present/*` (GET), `/api/live/*` (GET + token/act POST), and
`/api/meetings/webhook` run inside Recall's headless browser with no login —
authorized by an unguessable id in the URL. In access-code mode they inherit the
legacy org. In **password** mode they have no cookie, so those handlers must
resolve org **from the resource** (e.g. `live_calls.org_id`, the present
session's stored org) rather than from `req`. This is the main open item for the
live path and is called out in the runbook.

## Credential encryption at rest (Task 2)

`demo_login` passwords were stored PLAINTEXT in the `settings` JSONB despite the
UI claiming "Stored encrypted". Now (`lib/cryptoCreds.ts` + `lib/tenancy.ts`):

- **Cipher:** AES-256-GCM. Ciphertext format `enc:v1:<ivHex>:<tagHex>:<cipherHex>`.
- **Key:** from env **`CRED_ENC_KEY`** only — never the DB or the repo. Accepts
  64-hex, 32-byte base64, or any passphrase (SHA-256 → 32 bytes). Unset ⇒ values
  pass through as plaintext and the BFF logs a loud boot warning (dev only).
- **Per-org binding:** the GCM **AAD = `"<org> <settingsKey>"`** (`credAad`). A
  ciphertext row physically copied to another org or another key **fails the auth
  tag** on decrypt — so a leaked/tampered row can't be reused cross-tenant.
- **Encrypt on write / decrypt on read-where-needed:** `sealDemoLogin` encrypts
  the password before `setSetting`; only the login/bridge path calls
  `openDemoLogin`/`resolveDemoLoginSecret`/`getOrgDemoLoginSecret` to get
  plaintext. Everything else (UI "hasPassword", email display) uses the sealed
  blob. `isEncrypted` guards make encrypt/decrypt idempotent; legacy plaintext
  decrypts unchanged so reads keep working before the backfill.
- **One-time backfill:** `encryptExistingDemoLogins()` runs at boot (idempotent),
  encrypting any pre-existing plaintext `demo_login:*` password in place, per row,
  using that row's own `org_id` as AAD. No-op when the key is unset or a value is
  already ciphertext.
- **Validated:** `test/crypto.test.ts` (roundtrip, ciphertext≠plaintext,
  cross-ORG + cross-KEY AAD rejection, legacy passthrough) — GREEN with a key set.
  The SQL isolation test additionally asserts the value at rest is `enc:v1:%`
  (never plaintext) and is per-org distinct.
- **Scope note:** integration secrets in `integrations.values` (Slack/ElevenLabs
  keys, the demo-env password) remain plaintext-at-rest — out of Task 2's scope
  (which named the `demo_login` password); same `cryptoCreds` primitive can wrap
  them next, keyed by `credAad(org, 'integration:'+id)`.

## Deletion / purge (Task 3 — `lib/purge.ts`)

HARD purge (never soft-delete), per the DATA GOVERNANCE decision. Three entry
points, all org-scoped and idempotent:

- **`purgeOrg(org)`** — customer leaves. Wired to owner-gated, self-org-only
  `DELETE /api/admin/org/:orgId`. Refuses the legacy org unless `{force:true}`.
- **`purgeAgent(org, agentId)`** — one clone. Wired into `DELETE /api/agents/:id`
  (replaces the old partial cascade; gated by `agentInOrg`).
- **`purgeCall(org, callId)`** — one call. Wired to `DELETE /api/live/call/:id`.

**Order of operations (why it's safe):**
1. **Gather external identifiers FIRST** — the org's ElevenLabs api key + owned
   `voice_id`s, active e2b `sandbox_id`s, and on-disk artifact dirs — *before*
   the rows holding them are deleted.
2. **Atomic DB purge in ONE transaction (`withTx`)** — every `org_id` table (the
   canonical list incl. `settings`, `cost_entries`, **`files`**), then `sessions`
   → `memberships` → the `orgs` row (FK-safe order), then the **audit record**,
   all commit together or roll back together. A crash mid-purge leaves the org
   fully intact — never half-deleted. Users shared with other orgs are **not**
   deleted (only this org's memberships/sessions).
3. **Best-effort external cleanup AFTER commit** (cannot be transactional with
   Postgres): revoke each ElevenLabs cloned voice (`DELETE /v1/voices/{id}` with
   the org's own key), kill e2b sandboxes, `rm -rf` the on-disk film dirs
   (`$AH/shots/<sourceId>`; legacy org also `gp-login.json`). Each step retries
   (3×, backoff) and logs; the outcome is written as a **second audit row**
   (`purge_*_external`). The DB is the source of truth; external cleanup is
   idempotent and re-runnable.

**Transactional vs best-effort:** DB rows + credential/settings wipe + audit =
**transactional**. ElevenLabs voice revoke + e2b kill + file `rm` =
**best-effort with logged retry** (external systems).

**Audit:** new append-only `audit_log` table (`tenancy.sql`). Its `org_id` is
**not** an FK and it is **excluded from every purge cascade + admin "clear"**, so
the record of a purge SURVIVES the org's deletion. Actor = `req.user?.id` (or
`system`).

**Validated:** the SQL isolation test's PURGE block runs the exact DB cascade and
asserts org_A → 0 rows in every table, org_B completely untouched, the shared
user keeps their org_B membership+session, and the audit row survives.

## Migration & cutover runbook

The migration is `tenancy.sql`, applied by `migrate.ts` AFTER `schema.sql` on
every boot (idempotent). It adds identity tables, `org_id` on every tenant table
(+ a **transition-safety `DEFAULT 'org_legacy'`**), the composite PKs
(`settings`, `integrations`, `cost_entries`), the `audit_log` table, and backfills
all existing rows into `org_legacy`.

Cutover (mirrors CLAUDE.md › PROD INTEGRATION runbook; each step reversible until
the last safe point):

1. **Deploy in `access-code` mode** (`AUTH_MODE` unset). Migration runs: `org_id`
   everywhere + backfill to `org_legacy` + new tables. Behaviour UNCHANGED (every
   request pins to the legacy org; `DEFAULT 'org_legacy'` catches any unscoped
   write). Validate the app + a real rehearsal. Set **`CRED_ENC_KEY`** here so the
   boot backfill encrypts existing `demo_login` passwords; confirm no plaintext
   remains.
2. **Confirm all route scoping done** (this doc) and **run the isolation test on
   the migrated schema** — must be GREEN (isolation + purge).
3. **Drop the `org_id` DEFAULT** on every tenant table (and `settings`,
   `cost_entries`) so a forgotten `org_id` FAILS LOUD instead of silently leaking
   a row into the legacy tenant.
4. Create the superadmin/org-admin account, **VERIFY login**, then flip
   **`AUTH_MODE=password`**. Keep access-code as a one-flag rollback until login
   is confirmed.
5. Enable Fastify `trustProxy`; keep the DB backup from before step 3.

### ⚠️ Single riskiest cutover step

**Flipping `AUTH_MODE=password` before the `org_id` DEFAULT is dropped (step 4
before step 3).** In password mode multiple real orgs exist, but while the
`DEFAULT 'org_legacy'` is still in place any INSERT that misses `org_id` **silently
lands in the legacy tenant instead of erroring** — a cross-tenant data leak that
looks like success and is invisible until data shows up in the wrong org. The
DEFAULT is the pre-cutover safety net; it becomes a footgun the instant more than
one tenant is live. **Order is non-negotiable: scope-complete → isolation GREEN →
drop DEFAULT → only then AUTH_MODE=password.** Rollback: `AUTH_MODE=access-code`
+ prior image; restore the DB backup only if taken before the DEFAULT was dropped.
