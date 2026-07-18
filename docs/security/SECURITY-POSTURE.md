# AfterHuman — Security & Data-Handling Posture

> Canonical capture of the CLAUDE.md **DATA GOVERNANCE (#2)** decisions (plus the
> relevant parts of the 2026-07-18 launch decisions). This is the source of truth
> behind the public trust page and the answer sheet for security questionnaires.
> Status: **pre-launch, single operator, no real customer data yet.** Items marked
> **[DEPLOY GATE]** must be true before the first real customer org is onboarded.

## 1. What we hold

For each customer organization we may store:

- Call recordings and transcripts of the cloned rep.
- A voice sample and the derived ElevenLabs cloned voice.
- The extracted persona / clone artifacts.
- Credentials for the systems the customer connects (CRM, email/calendar, Slack,
  demo env, notetaker, etc.).

Secrets are stored **server-side only** and never returned to the browser — the UI
only ever sees a masked hint.

## 2. Encryption at rest

Customer data and stored credentials are encrypted at rest. Application secrets
live in the BFF/database layer, not in client code.

## 3. Per-org isolation

Clones, sources, and connected systems are scoped to the owning org. A clone can
only be summoned by a member of its own org — never cross-org, never public
(see INSTANT-LINK ACCESS CONTROL). Per-org enforcement hardens in **Phase 2**
(auth/roles + org_id).

## 4. Audit logging

Privileged and super-admin actions are audit-logged (actor, action, resource,
time). The audit log is the forensic record for incident response and access
reviews.

## 5. Admin / control-plane posture

- The BFF is guarded by an access key (`BFF_API_KEY`); a public deployment must
  set it and/or sit behind an authenticating reverse proxy.
- Current pre-launch state: IP allowlist = allow-all (`SUPERADMIN_IP_ALLOWLIST`
  unset), MFA dormant → effectively password-only, internet-reachable. Accepted
  only because there is no real customer data yet.
- **[DEPLOY GATE]** Enable at least one of {MFA, IP allowlist} before onboarding
  any real customer org — super-admin is the likeliest breach vector and has
  whole-company blast radius.
- **[DEPLOY GATE]** Enable Fastify `trustProxy` so `X-Forwarded-For` yields the
  real client IP behind Traefik.
- Highest-value incident build: new-IP super-admin-login alert + one-click
  LOCKDOWN (flip MFA + allowlist on, kill all sessions).

## 6. AI disclosure on calls

On every live call — scheduled or instant, production or demo org — the clone
discloses that it is an AI. Presence is logo + cloned voice + screenshare; **no
synthetic human face/avatar** (uncanny + collides with deepfake/disclosure).
Disclosure fires regardless of join method. Two hard, non-configurable landmines:
(1) never invent a number it was not given; (2) never finalize/sign a binding
contract by voice.

## 7. Retention

- Default: **keep data while the clone is active, purge on delete.**
- Optional per-org: **hard time-box** — purge data older than a chosen window.
- Stored under the `settings` key `retention`; shape below. Surfaced in-app on the
  Retention settings screen (`#/retention`) via `GET/PUT /api/retention`.

```json
{
  "mode": "keep-while-active | hard-timebox",
  "purgeOnDelete": true,
  "hardTimeboxDays": null,
  "updatedAt": "ISO-8601 | null"
}
```

`purgeOnDelete` is non-negotiable and always `true` (not surfaced as an off switch).

## 8. Deletion (the real purge)

Deleting an org, clone, or call runs a **hard cascade purge** (not soft-delete):

1. Delete DB rows.
2. Delete stored files + e2b sandbox artifacts.
3. Revoke the ElevenLabs cloned voice.
4. Wipe stored product credentials.

When a customer leaves we hold neither their biometric voice likeness nor their
CRM keys. **The purge cascade itself is built by the Phase 2 agent** — this posture
defines the policy; Phase 2 implements the execution and reads the retention
policy via `getRetentionPolicy()` (see Integration below).

## 9. Subprocessors

| Subprocessor | Purpose | Data processed |
| --- | --- | --- |
| OpenAI | Language + reasoning models | Call context, transcripts, prompts |
| ElevenLabs | Voice cloning + speech synthesis | Rep voice sample, generated speech |
| e2b | Isolated cloud sandboxes | Live-call session artifacts (ephemeral) |
| Hostinger | Application + database hosting | All platform data at rest |

We maintain a signed DPA with each subprocessor and disclose changes before they
take effect.

## 10. Region

Single region at launch, disclosed. EU data residency is an enterprise fast-follow.

## 11. Incident / breach

- Named per-org security contact.
- 72-hour breach-notification commitment (in the DPA + on the trust page).
- Containment tools already exist: kill-switch, suspend-org, kill-call, purge,
  dormant MFA + allowlist.
- Minimal build: new-IP super-admin-login alert, cost-runaway alert,
  bail-out/report-spike alert; one-page containment runbook; automated DB backups
  with tested restore; operational status page; audit log = forensics.

## 12. SOC 2

Deferred. Launch on the security-basics story; start the formal SOC 2 process when
enterprise pull appears. Until then we answer questionnaires and share this doc.

---

## Integration — what Phase 2 (the purge/retention job) reads

- **Retention policy read target:** `getRetentionPolicy()` exported from
  `apps/bff/src/routes/retention.ts`. Always returns a complete, defaulted
  `RetentionPolicy` (never throws on a missing row). Backed by the `settings`
  table key `retention` (no schema migration — reuses the existing key/value
  table; validated on `jarvis_p9test`).
- **Contract:** if `mode === "hard-timebox"`, purge data older than
  `hardTimeboxDays`. Always honor `purgeOnDelete` on org/clone/call delete.
- **Multi-org note:** single-org today (single operator). When Phase 2 introduces
  `org_id`, key the retention value per org (e.g. `retention:<orgId>`) and extend
  `getRetentionPolicy(orgId)` accordingly.
