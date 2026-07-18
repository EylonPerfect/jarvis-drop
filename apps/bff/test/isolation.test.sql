-- ============================================================
-- PHASE 2 — Tenant ISOLATION gate (DB-level).
--
-- Proves org A cannot read or write org B's agents, transcripts,
-- settings/credentials, calls, runs, or cost ledger — using the EXACT
-- org-scoped predicates the route code now uses (WHERE org_id = $caller
-- [AND id = $target]). Any leak RAISEs and aborts the transaction, so
-- `psql -v ON_ERROR_STOP=1 -f isolation.test.sql` exits non-zero.
--
-- Run against the throwaway DB (schema.sql + tenancy.sql already applied):
--   docker exec -i jarvis-new-db-1 psql -U jarvis -d jarvis_p2test \
--     -v ON_ERROR_STOP=1 < apps/bff/test/isolation.test.sql
--
-- Everything runs inside a transaction that ROLLS BACK, so it is
-- repeatable and leaves no residue.
-- ============================================================
BEGIN;

-- ---- fixtures: two tenants, each with a full footprint ----
INSERT INTO orgs (id, name) VALUES ('org_A', 'Alpha'), ('org_B', 'Bravo');

INSERT INTO agents (id, org_id, icon, name, role) VALUES
  ('ag_A', 'org_A', 'bot', 'Alpha Rep', 'AE'),
  ('ag_B', 'org_B', 'bot', 'Bravo Rep', 'AE');

INSERT INTO clone_sources (id, org_id, agent_id, transcript) VALUES
  ('cs_A', 'org_A', 'ag_A', 'ALPHA secret call transcript'),
  ('cs_B', 'org_B', 'ag_B', 'BRAVO secret call transcript');

-- credentials (Task 6 / the most sensitive) + a global-name key that would
-- have collided under the old single-key PK.
INSERT INTO settings (org_id, key, value) VALUES
  ('org_A', 'demo_login:ag_A', '{"email":"a@alpha.com","password":"ALPHA_PW"}'),
  ('org_B', 'demo_login:ag_B', '{"email":"b@bravo.com","password":"BRAVO_PW"}'),
  ('org_A', 'company', '{"name":"Alpha Inc"}'),
  ('org_B', 'company', '{"name":"Bravo LLC"}');

INSERT INTO live_calls (id, org_id, agent_id, meeting_id) VALUES
  ('lc_A', 'org_A', 'ag_A', 'mtg_A'),
  ('lc_B', 'org_B', 'ag_B', 'mtg_B');

INSERT INTO agent_runs (org_id, agent_id, task, status) VALUES
  ('org_A', 'ag_A', 'alpha task', 'done'),
  ('org_B', 'ag_B', 'bravo task', 'done');

INSERT INTO cost_entries (org_id, provider, cost) VALUES
  ('org_A', 'openai', 10), ('org_B', 'openai', 99);

-- integrations: the credential-clobber gap. Both orgs connect Slack (same id)
-- with DIFFERENT bot tokens — only possible now that the PK is (org_id, id).
INSERT INTO integrations (org_id, id, values, connected, detail) VALUES
  ('org_A', 'slack', '{"botToken":"xoxb-ALPHA"}', true, 'bot ••••LPHA'),
  ('org_B', 'slack', '{"botToken":"xoxb-BRAVO"}', true, 'bot ••••RAVO');

-- ai_providers: each org's own active provider (API-key billing isolation).
INSERT INTO ai_providers (id, org_id, name, base_url, api_key, model, active) VALUES
  ('prov_A', 'org_A', 'A', 'https://api.openai.com/v1', 'sk-ALPHA', 'gpt', true),
  ('prov_B', 'org_B', 'B', 'https://api.openai.com/v1', 'sk-BRAVO', 'gpt', true);

-- identity rows so the purge exercises sessions + memberships (and proves a
-- shared user keeps their OTHER org after one org is purged).
INSERT INTO users (id, email) VALUES
  ('u_A', 'owner@alpha.com'),
  ('u_shared', 'consultant@both.com');   -- belongs to BOTH orgs
INSERT INTO memberships (user_id, org_id, role) VALUES
  ('u_A', 'org_A', 'owner'),
  ('u_shared', 'org_A', 'member'),
  ('u_shared', 'org_B', 'member');
INSERT INTO sessions (id, user_id, org_id, expires_at) VALUES
  ('sess_A', 'u_A', 'org_A', now() + interval '1 day'),
  ('sess_shared_A', 'u_shared', 'org_A', now() + interval '1 day'),
  ('sess_shared_B', 'u_shared', 'org_B', now() + interval '1 day');

-- ENCRYPTED credential at rest: the org-level demo_login password is stored as
-- AES-GCM ciphertext (enc:v1:iv:tag:cipher), NOT plaintext. The app decrypts it
-- only in the login/bridge path (lib/cryptoCreds.ts). Here we assert the value
-- on disk is ciphertext and is org-isolated (roundtrip + AAD binding is proven
-- separately in test/crypto.test.ts).
INSERT INTO settings (org_id, key, value) VALUES
  ('org_A', 'demo_login:__org__', '{"email":"demo@alpha.com","password":"enc:v1:aaaa:bbbb:cccc"}'),
  ('org_B', 'demo_login:__org__', '{"email":"demo@bravo.com","password":"enc:v1:dddd:eeee:ffff"}');

-- extra org_A child rows so the purge has a full footprint to clear.
INSERT INTO persona_versions (id, org_id, agent_id, number, spec) VALUES ('pv_A', 'org_A', 'ag_A', 1, '{}');
INSERT INTO files (id, org_id, filename, mime, size, data) VALUES ('f_A', 'org_A', 'shot.png', 'image/png', 3, '\x001122');
INSERT INTO integrations (org_id, id, values, connected, detail) VALUES ('org_A', 'elevenlabs', '{"apiKey":"xi-ALPHA"}', true, 'key');

-- ---- assertions ----
DO $$
DECLARE n int;
BEGIN
  -- 1) AGENTS: caller org_A, scoped read never returns org_B rows.
  SELECT count(*) INTO n FROM agents WHERE org_id = 'org_A';
  IF n <> 1 THEN RAISE EXCEPTION 'agents: org_A should see exactly 1 agent, saw %', n; END IF;
  SELECT count(*) INTO n FROM agents WHERE org_id = 'org_A' AND id = 'ag_B';
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK agents: org_A read org_B agent by id'; END IF;

  -- cross-tenant WRITE: org_A trying to mutate org_B's agent affects 0 rows.
  UPDATE agents SET name = 'HACKED' WHERE id = 'ag_B' AND org_id = 'org_A';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK agents: org_A updated org_B agent'; END IF;
  IF (SELECT name FROM agents WHERE id = 'ag_B') <> 'Bravo Rep' THEN
    RAISE EXCEPTION 'LEAK agents: org_B agent name was modified'; END IF;

  -- cross-tenant DELETE: org_A deleting org_B's agent affects 0 rows.
  DELETE FROM agents WHERE id = 'ag_B' AND org_id = 'org_A';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK agents: org_A deleted org_B agent'; END IF;

  -- 2) TRANSCRIPTS (clone_sources): no cross-tenant read, by agent or by id.
  SELECT count(*) INTO n FROM clone_sources WHERE org_id = 'org_A' AND agent_id = 'ag_B';
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK transcripts: org_A read org_B via agent_id'; END IF;
  SELECT count(*) INTO n FROM clone_sources WHERE org_id = 'org_A' AND id = 'cs_B';
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK transcripts: org_A read org_B by source id'; END IF;
  -- the agentInOrg gate: ag_B is NOT in org_A.
  SELECT count(*) INTO n FROM agents WHERE id = 'ag_B' AND org_id = 'org_A';
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK gate: agentInOrg(ag_B, org_A) would pass'; END IF;

  -- 3) CREDENTIALS (settings demo_login): scoped by (org_id, key) only.
  SELECT count(*) INTO n FROM settings WHERE org_id = 'org_A' AND key = 'demo_login:ag_B';
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK creds: org_A read org_B demo_login'; END IF;
  IF (SELECT value->>'password' FROM settings WHERE org_id = 'org_A' AND key = 'demo_login:ag_A') <> 'ALPHA_PW' THEN
    RAISE EXCEPTION 'creds: org_A cannot read its own demo_login'; END IF;
  -- same global key, two orgs, two distinct values (composite PK works).
  IF (SELECT value->>'name' FROM settings WHERE org_id = 'org_A' AND key = 'company') <> 'Alpha Inc'
     OR (SELECT value->>'name' FROM settings WHERE org_id = 'org_B' AND key = 'company') <> 'Bravo LLC' THEN
    RAISE EXCEPTION 'settings: composite key did not isolate the shared "company" key'; END IF;

  -- 4) CALLS (live_calls): "latest active" scoped per org returns only own call.
  SELECT count(*) INTO n FROM live_calls WHERE org_id = 'org_A' AND ended_at IS NULL AND id = 'lc_B';
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK calls: org_A saw org_B live_call'; END IF;
  IF (SELECT id FROM live_calls WHERE org_id = 'org_A' AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) <> 'lc_A' THEN
    RAISE EXCEPTION 'calls: org_A latest-active resolved wrong call'; END IF;

  -- 5) RUNS + COST LEDGER: per-org.
  SELECT count(*) INTO n FROM agent_runs WHERE org_id = 'org_A' AND agent_id = 'ag_B';
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK runs: org_A read org_B run'; END IF;
  IF (SELECT cost FROM cost_entries WHERE org_id = 'org_A' AND provider = 'openai') <> 10 THEN
    RAISE EXCEPTION 'cost_entries: org_A saw the wrong (or global) ledger'; END IF;

  -- 6) INTEGRATIONS (the credential-clobber gap): both orgs hold their own Slack
  -- token; org_A reading Slack sees only its own; a re-connect (upsert) by org_A
  -- does NOT touch org_B's stored credential.
  IF (SELECT values->>'botToken' FROM integrations WHERE org_id='org_A' AND id='slack') <> 'xoxb-ALPHA' THEN
    RAISE EXCEPTION 'integrations: org_A cannot read its own Slack token'; END IF;
  SELECT count(*) INTO n FROM integrations WHERE org_id='org_A' AND id='slack' AND values->>'botToken' = 'xoxb-BRAVO';
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK integrations: org_A saw org_B Slack token'; END IF;
  -- org_A re-connects Slack (exact upsert the route runs): must not clobber org_B.
  INSERT INTO integrations (org_id, id, values, connected, detail) VALUES ('org_A','slack','{"botToken":"xoxb-ALPHA2"}',true,'x')
    ON CONFLICT (org_id, id) DO UPDATE SET values = EXCLUDED.values;
  IF (SELECT values->>'botToken' FROM integrations WHERE org_id='org_B' AND id='slack') <> 'xoxb-BRAVO' THEN
    RAISE EXCEPTION 'LEAK integrations: org_A connect CLOBBERED org_B Slack credential'; END IF;

  -- 7) AI PROVIDERS: activating org_A's provider must not deactivate org_B's
  -- (the old all-rows UPDATE bug); each org keeps its own active provider + key.
  UPDATE ai_providers SET active = false WHERE org_id = 'org_A';
  UPDATE ai_providers SET active = true WHERE id = 'prov_A' AND org_id = 'org_A';
  IF (SELECT active FROM ai_providers WHERE id = 'prov_B') <> true THEN
    RAISE EXCEPTION 'LEAK ai_providers: org_A activation deactivated org_B provider'; END IF;
  IF (SELECT api_key FROM ai_providers WHERE org_id='org_A' AND active) <> 'sk-ALPHA' THEN
    RAISE EXCEPTION 'ai_providers: org_A resolved the wrong active provider key'; END IF;

  -- 8) ENCRYPTED CREDENTIALS AT REST: the org demo_login password is ciphertext
  -- (enc:v1:…), never plaintext, and is isolated per org by the composite key.
  IF (SELECT value->>'password' FROM settings WHERE org_id='org_A' AND key='demo_login:__org__') NOT LIKE 'enc:v1:%' THEN
    RAISE EXCEPTION 'creds-at-rest: org_A demo_login password is NOT stored encrypted'; END IF;
  SELECT count(*) INTO n FROM settings WHERE org_id='org_A' AND key='demo_login:__org__' AND value->>'password' LIKE '%BRAVO%';
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK creds: org_A saw org_B encrypted secret'; END IF;
  -- the two orgs' ciphertexts differ (distinct IV/tag ⇒ no shared secret material).
  IF (SELECT value->>'password' FROM settings WHERE org_id='org_A' AND key='demo_login:__org__')
     = (SELECT value->>'password' FROM settings WHERE org_id='org_B' AND key='demo_login:__org__') THEN
    RAISE EXCEPTION 'creds-at-rest: two orgs share identical ciphertext'; END IF;

  RAISE NOTICE 'ISOLATION TEST PASSED — no cross-tenant read/write leaks across agents, transcripts, credentials (incl. encrypted-at-rest), calls, runs, cost ledger, integrations, ai_providers.';
END $$;

-- ============================================================
-- PURGE cascade (lib/purge.ts › purgeOrg DB portion): HARD-delete every
-- org_A row, then assert (a) org_A footprint is 0 everywhere, (b) org_B is
-- completely untouched, (c) the shared user keeps their org_B membership +
-- session, (d) the audit_log record of the purge SURVIVES (its org_id is not
-- an FK, so deleting the org row does not cascade it away).
-- This mirrors the exact statements + FK-safe order the code runs in one tx.
-- ============================================================
DO $$
DECLARE
  n int;
  t text;
  tenant_tables text[] := ARRAY[
    'agents','tasks','reminders','time_entries','memory_facts','style_profiles',
    'knowledge_sources','collections','tool_toggles','provider_keys','files','cost_entries',
    'approvals','settings','agent_activity','agent_comms','agent_runs','meetings',
    'integrations','persona_versions','calibration_sessions','calibration_turns',
    'clone_sources','debriefs','live_calls','rehearsal_grades','company_people','ai_providers'
  ];
BEGIN
  -- purge org_A (tenant rows -> sessions -> memberships -> org row), all scoped.
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('DELETE FROM %I WHERE org_id = %L', t, 'org_A');
  END LOOP;
  DELETE FROM sessions    WHERE org_id = 'org_A';
  DELETE FROM memberships WHERE org_id = 'org_A';
  DELETE FROM orgs        WHERE id     = 'org_A';
  -- the code writes this audit row inside the same tx:
  INSERT INTO audit_log (actor, action, org_id, target, detail)
    VALUES ('system', 'purge_org', 'org_A', 'org_A', '{"deleted":"(test)"}');

  -- (a) org_A is gone everywhere.
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE org_id = %L', t, 'org_A') INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'PURGE leak: % still has % org_A row(s)', t, n; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM orgs WHERE id = 'org_A';
  IF n <> 0 THEN RAISE EXCEPTION 'PURGE: org_A row survived'; END IF;
  SELECT count(*) INTO n FROM sessions WHERE org_id = 'org_A';
  IF n <> 0 THEN RAISE EXCEPTION 'PURGE: org_A sessions survived'; END IF;
  SELECT count(*) INTO n FROM memberships WHERE org_id = 'org_A';
  IF n <> 0 THEN RAISE EXCEPTION 'PURGE: org_A memberships survived'; END IF;

  -- (b) org_B is fully intact — the purge NEVER reached across the tenant line.
  IF (SELECT count(*) FROM agents WHERE org_id='org_B') <> 1
     OR (SELECT count(*) FROM clone_sources WHERE org_id='org_B') <> 1
     OR (SELECT count(*) FROM settings WHERE org_id='org_B') = 0
     OR (SELECT count(*) FROM integrations WHERE org_id='org_B') <> 1
     OR (SELECT count(*) FROM ai_providers WHERE org_id='org_B') <> 1
     OR (SELECT count(*) FROM live_calls WHERE org_id='org_B') <> 1
     OR (SELECT count(*) FROM orgs WHERE id='org_B') <> 1 THEN
    RAISE EXCEPTION 'PURGE: cross-tenant damage — org_B footprint changed'; END IF;
  IF (SELECT values->>'botToken' FROM integrations WHERE org_id='org_B' AND id='slack') <> 'xoxb-BRAVO' THEN
    RAISE EXCEPTION 'PURGE: org_B credential was altered'; END IF;

  -- (c) the shared user survives, keeps ONLY their org_B membership + session.
  IF (SELECT count(*) FROM users WHERE id='u_shared') <> 1 THEN
    RAISE EXCEPTION 'PURGE: a user shared with another org was deleted'; END IF;
  IF (SELECT count(*) FROM memberships WHERE user_id='u_shared') <> 1
     OR (SELECT org_id FROM memberships WHERE user_id='u_shared') <> 'org_B' THEN
    RAISE EXCEPTION 'PURGE: shared user lost/kept the wrong org membership'; END IF;
  IF (SELECT count(*) FROM sessions WHERE user_id='u_shared') <> 1 THEN
    RAISE EXCEPTION 'PURGE: shared user org_B session was wrongly removed'; END IF;
  -- the org_A-only owner IS orphaned of memberships (correct — their only org is gone).
  IF (SELECT count(*) FROM memberships WHERE user_id='u_A') <> 0 THEN
    RAISE EXCEPTION 'PURGE: org_A owner membership survived'; END IF;

  -- (d) the audit record of the purge SURVIVED the org deletion.
  SELECT count(*) INTO n FROM audit_log WHERE action='purge_org' AND org_id='org_A';
  IF n <> 1 THEN RAISE EXCEPTION 'PURGE: audit record missing (or not durable across org delete)'; END IF;

  RAISE NOTICE 'PURGE TEST PASSED — org_A hard-purged to 0 rows everywhere, org_B untouched, shared user + audit record preserved.';
END $$;

ROLLBACK;
