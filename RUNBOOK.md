# Containment Runbook — After Human

One page. Built on tools that already exist. When an incident is suspected, act
top-down: **contain → assess → communicate → recover**. Every mutation below is
audit-logged. Super-admin endpoints require `X-Superadmin-Key: $SUPERADMIN_API_KEY`.

---

## 0. Triggers (an alert fired, or you suspect a problem)
Alerts arrive on the configured webhook/Slack channel. Kinds:
`new_ip_superadmin`, `cost_runaway`, `bailout_spike`, `report_spike`, `lockdown`.
Check posture any time: `GET /api/admin/security`.

## 1. CONTAIN (stop the bleeding)

| Situation | Action |
|---|---|
| **Super-admin account may be compromised** (new-IP login alert, unexpected access) | **One-click LOCKDOWN:** `POST /api/admin/lockdown` — flips MFA on, restricts the IP allowlist (to your IP unless you pass `{"allowlist":[...]}`), and invalidates **all** super-admin sessions. Then rotate the super-admin password + `SUPERADMIN_API_KEY`. |
| **Cost runaway** (spend spike alert) | Flip the voice kill-switch: set `settings.call_voice_mode='openai'` (stops EL character billing). Hit Phase-3 spend breaker / per-org cap. End live calls (below). |
| **A single call going wrong** | `POST /api/live/end` (graceful goodbye + sandbox teardown) or super-admin `POST /api/superadmin/calls/:id/kill` (reason required) in the fleet view. |
| **A whole org misbehaving / abusive** | Suspend it: super-admin `POST /api/superadmin/orgs/:id/suspend` (reason required; notifies the org). |
| **Bad data / biometric or credential exposure on delete** | Run the hard purge path (Data Governance): delete org/clone/call → purge DB rows + files + e2b artifacts + **revoke the ElevenLabs cloned voice** + **wipe stored product credentials**. |
| **Platform-wide** | Stop new joins by tripping the platform concurrency/spend cap; if needed take the BFF down (`docker compose stop bff`) — note law 1: never restart while an un-ended live call exists unless you accept killing mid-boot calls. |

## 2. ASSESS (what happened, scope)
- **Forensics = the audit log:** `GET /api/superadmin/audit` (super-admin actions, IPs, reasons) + `superadmin_logins` (login IPs / new-IP flags) + `incident_alerts` (what fired).
- **Blast radius:** `GET /api/superadmin/fleet` (live calls across orgs), `GET /api/superadmin/readiness` (clone scores), `GET /api/superadmin/reports` (report queue).
- **Spend:** `spend_events` (per-provider, timestamped) over the incident window.

## 3. COMMUNICATE
- **Public status:** post an incident — `POST /api/status/incidents {title,body,severity,status}`; update/resolve with `PATCH /api/status/incidents/:id {status,body,resolved:true}`. Public page: `GET /status`.
- **Affected orgs:** each org has a `security_contact`. Breach-notification commitment is **72h** (DPA / trust page). Notify per DPA.

## 4. RECOVER
- **Data loss / corruption:** restore from backup — see `BACKUP-RESTORE.md` (tested restore proven on `jarvis_p10test`).
- **After LOCKDOWN:** once verified clean, relax posture via `POST /api/admin/security` state (re-open allowlist if appropriate — keep at least one of {MFA, allowlist} on per the launch gate), re-issue super-admin credentials, bring sessions back by logging in fresh.
- **Post-incident:** resolve the status incident, write the timeline from the audit log, tune thresholds via `POST /api/admin/security/config`.

---

### Where the super-admin FE LOCKDOWN button wires
The super-admin front-end (the separate super-admin app / "other copy") binds its
**Lockdown** control to `POST /api/admin/lockdown` with the super-admin credential.
On success it should force a re-auth (all sessions were just invalidated). The
**new-IP login alert** is driven by the FE calling `POST /api/admin/superadmin/login-event`
right after a successful super-admin authentication (or the super-admin backend
calling `recordSuperadminLogin()` inline in its `/login` handler).

### Key knobs
- Kill-switch (voice cost): `settings.call_voice_mode = 'openai'`
- Alert channels/thresholds: `POST /api/admin/security/config` (or `settings.incident_config`)
- Security posture: `settings.security_state` ({mfaEnabled, ipAllowlist, lockdownAt})
