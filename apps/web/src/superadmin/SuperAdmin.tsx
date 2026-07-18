// ============================================================
// After Human — platform super-admin console.
//
// A standalone, highest-privilege operator surface, mounted at /superadmin by
// main.tsx (outside the product app shell and its login gate, same pattern as
// /present and /live). Every rule in ./superadmin.css is namespaced under .sa,
// so this console touches no product screen or shared style.
//
// Faithful recreation of design_handoff/Super Admin.dc.html:
//   password-only gate (locked decision — the MFA path is kept dormant below),
//   sidebar + 7 panels, reason-required confirm modal, audit-log toast, and a
//   global emergency stop.
// ============================================================
import { useEffect, useState } from "react";
import "./superadmin.css";
import { saLogin, saApi, getSaToken, clearSaToken } from "./api";
import { Icon } from "./ui";
import type { ConfirmConfig } from "./types";
import {
  FleetPanel, OrgsPanel, CostPanel, QualityPanel, BillingPanel, ConfigPanel, AuditPanel,
  modalScrim, modalCard, modalCancel, modalConfirm,
} from "./panels";

type SectionKey = "fleet" | "orgs" | "cost" | "quality" | "billing" | "config" | "audit";

const NAV: { key: SectionKey; label: string; icon: string }[] = [
  { key: "fleet", label: "Live fleet", icon: "sensors" },
  { key: "orgs", label: "Orgs & users", icon: "apartment" },
  { key: "cost", label: "Cost & metering", icon: "payments" },
  { key: "quality", label: "Quality & incidents", icon: "gpp_maybe" },
  { key: "billing", label: "Billing & revenue", icon: "account_balance" },
  { key: "config", label: "Config & flags", icon: "tune" },
  { key: "audit", label: "Audit log", icon: "history" },
];
const TITLES: Record<SectionKey, string> = {
  fleet: "Live fleet · mission control",
  orgs: "Organizations & users",
  cost: "Cost & metering",
  quality: "Quality & incidents",
  billing: "Billing & revenue",
  config: "Global config & flags",
  audit: "Audit log",
};

export default function SuperAdmin() {
  const [locked, setLocked] = useState(() => !getSaToken());
  useEffect(() => {
    const onUnauth = () => setLocked(true);
    window.addEventListener("sa-unauthorized", onUnauth);
    return () => window.removeEventListener("sa-unauthorized", onUnauth);
  }, []);

  if (locked) return <Gate onUnlock={() => setLocked(false)} />;
  return <Console onLock={() => { clearSaToken(); setLocked(true); }} />;
}

// ─── PASSWORD-ONLY GATE ─────────────────────────────────────────────────────
function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await saLogin(password);
      onUnlock();
    } catch {
      setErr("Incorrect password, or the login endpoint is not reachable.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sa">
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "radial-gradient(circle at 30% 20%, #12124f, #04042A 70%)" }}>
        <div style={{ width: "100%", maxWidth: 420, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 24, padding: 34, boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", padding: "6px 12px", borderRadius: 9999, background: "rgba(255,6,96,.14)", color: "#FF6E9C", marginBottom: 20 }}>
            <Icon name="admin_panel_settings" size={16} />Platform superadmin
          </div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-.02em" }}>Enter password</h1>
          <p style={{ margin: "10px 0 22px", fontSize: 14, color: "var(--ink2)", lineHeight: 1.5 }}>This is the highest-privilege surface. Enter the platform superadmin password to continue. Every action here is audit-logged.</p>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 8 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="••••••••••••"
            autoFocus
            style={{ width: "100%", height: 56, padding: "0 18px", borderRadius: 14, border: `2px solid ${err ? "#FF6B84" : "var(--border)"}`, background: "var(--bg)", outline: "none", color: "#fff", fontSize: 20, fontWeight: 700, letterSpacing: ".12em" }}
          />
          {err && <div style={{ marginTop: 10, fontSize: 12.5, color: "#FF6B84", display: "flex", alignItems: "center", gap: 6 }}><Icon name="error" size={16} color="#FF6B84" />{err}</div>}
          <button onClick={submit} disabled={busy} style={{ width: "100%", height: 52, marginTop: 18, border: "none", borderRadius: 9999, background: "#FF0660", color: "#fff", fontSize: 15, fontWeight: 700, cursor: busy ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 8px 24px rgba(255,6,96,.3)", opacity: busy ? 0.8 : 1 }}>
            {busy ? <span className="sa-spinner" /> : <Icon name="lock_open" size={20} />}Verify and enter
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, fontSize: 12, color: "var(--ink3)" }}>
            <Icon name="verified_user" size={16} color="#2ED37D" />Role: superadmin · session recorded · IP allowlist enforced
          </div>
        </div>
      </div>
    </div>
  );
}

// Dormant MFA step — kept per the locked decision (build password-only for now,
// keep the MFA code path hidden). Wire this in front of the console when
// AUTH_MODE flips to SSO_MFA. Intentionally not rendered.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function MfaGate({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState("");
  return (
    <div className="sa">
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 420, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 24, padding: 34 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Multi-factor required</h1>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="000000" style={{ width: "100%", height: 56, marginTop: 18, textAlign: "center", fontSize: 26, letterSpacing: ".5em", borderRadius: 14, border: "2px solid var(--border)", background: "var(--bg)", color: "#fff" }} />
          <button onClick={onUnlock} style={{ width: "100%", height: 52, marginTop: 18, border: "none", borderRadius: 9999, background: "#FF0660", color: "#fff", fontSize: 15, fontWeight: 700 }}>Verify and enter</button>
        </div>
      </div>
    </div>
  );
}

// ─── CONSOLE SHELL ──────────────────────────────────────────────────────────
function Console({ onLock }: { onLock: () => void }) {
  const [section, setSection] = useState<SectionKey>("fleet");
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null);
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "error" } | null>(null);
  const [killOn, setKillOn] = useState(false);
  const [threshold, setThreshold] = useState(70);
  const [reportCount, setReportCount] = useState<number | null>(null);

  const showToast = (msg: string, kind: "ok" | "error" = "ok") => {
    setToast({ msg, kind });
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToast(null), 3200);
  };
  const openConfirm = (c: ConfirmConfig) => { setConfirm(c); setReason(""); };
  const ctx = { openConfirm, toast: showToast };

  // Fetch the report count once so the sidebar badge reflects the real queue.
  useEffect(() => {
    saApi.get<any>("/api/superadmin/reports")
      .then((d) => setReportCount(Array.isArray(d) ? d.length : d?.reports?.length ?? 0))
      .catch(() => setReportCount(null));
  }, []);

  // Global spend kill-switch (shared: drives the sidebar state + the cost panel
  // toggle + the emergency-stop button). Engaging always requires a reason.
  const toggleKill = () => {
    if (killOn) {
      setKillOn(false);
      saApi.post("/api/usage/kill-switch", { target: "global", enabled: false, reason: "operator release" })
        .then(() => showToast("Global kill-switch released"))
        .catch((e) => showToast(`Could not complete · ${String(e)}`, "error"));
    } else {
      openConfirm({
        title: "Engage global kill-switch?", icon: "power_settings_new", danger: true, cta: "Halt all spend",
        body: "Halts ALL model spend platform-wide. Every clone stops working until you release it. Billing or vendor emergencies only.",
        run: async (r) => { setKillOn(true); try { await saApi.post("/api/usage/kill-switch", { target: "global", enabled: true, reason: r }); showToast("Global kill-switch ENGAGED"); } catch (e) { showToast(`Could not complete · ${String(e)}`, "error"); } },
      });
    }
  };
  const emergencyStop = () =>
    openConfirm({
      title: "Global emergency stop?", icon: "bolt", danger: true, cta: "Stop everything",
      body: "Immediately ends every live call across all orgs and pauses all clones platform-wide. Use only for a genuine emergency. This is the highest-impact action available.",
      run: async (r) => { setKillOn(true); try { await saApi.post("/api/superadmin/emergency-stop", { reason: r }); showToast("Global emergency stop engaged"); } catch (e) { showToast(`Could not complete · ${String(e)}`, "error"); } },
    });

  const doConfirm = async () => {
    const c = confirm;
    setConfirm(null);
    if (c) await c.run(reason.trim());
  };

  return (
    <div className="sa">
      <div style={{ height: "100vh", display: "grid", gridTemplateColumns: "248px 1fr" }}>
        {/* SIDEBAR */}
        <div style={{ background: "var(--panel)", borderRight: "1px solid var(--divider)", display: "flex", flexDirection: "column", padding: "18px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 18px" }}>
            <img src="/assets/afterhuman-mark.svg" alt="After Human" style={{ width: 30, height: 30 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1 }}>After Human</div>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#FF6E9C", marginTop: 3 }}>Superadmin</div>
            </div>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink3)", padding: "6px 10px" }}>Platform</div>
          {NAV.map((n) => {
            const active = section === n.key;
            const badge = n.key === "quality" && reportCount ? reportCount : 0;
            return (
              <button key={n.key} onClick={() => setSection(n.key)} className="sa-row" style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", height: 42, padding: "0 12px", marginBottom: 2, border: "none", borderRadius: 12, background: active ? "#FF0660" : "transparent", color: active ? "#fff" : "var(--ink2)", fontSize: 13.5, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                <Icon name={n.icon} size={20} />
                <span style={{ flex: 1 }}>{n.label}</span>
                {badge > 0 && <span style={{ minWidth: 20, height: 20, padding: "0 6px", borderRadius: 9999, background: "rgba(255,6,96,.2)", color: "#FF6E9C", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>}
              </button>
            );
          })}
          <div style={{ marginTop: "auto", padding: 12, borderRadius: 14, background: "var(--card)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: killOn ? "#FF6B84" : "#4BE39A" }} />
              {killOn ? "Platform halted" : "Platform nominal"}
            </div>
            <button onClick={emergencyStop} style={{ width: "100%", height: 40, marginTop: 10, border: "none", borderRadius: 10, background: "rgba(255,0,49,.16)", color: "#FF6B84", fontSize: 12.5, fontWeight: 800, letterSpacing: ".04em", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              <Icon name="bolt" size={18} />Global emergency stop
            </button>
          </div>
        </div>

        {/* MAIN */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: "none", height: 66, display: "flex", alignItems: "center", gap: 14, padding: "0 26px", borderBottom: "1px solid var(--divider)", background: "var(--panel)" }}>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.01em" }}>{TITLES[section]}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 10px", borderRadius: 9999, background: "rgba(46,211,125,.14)", color: "#4BE39A", fontSize: 11, fontWeight: 700 }}>
              <Icon name="verified_user" size={14} />Authenticated
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 14px", borderRadius: 9999, background: "var(--card)", border: "1px solid var(--border)", color: "var(--ink3)", fontSize: 13 }}>
                <Icon name="search" size={18} />Search orgs, users, calls
              </div>
              <button onClick={onLock} title="Lock console" style={{ display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 8px 0 4px", borderRadius: 9999, background: "transparent", border: "none", cursor: "pointer", color: "var(--ink1)" }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "radial-gradient(circle at 30% 30%, rgba(255,6,96,.5), rgba(163,66,255,.45))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>OP</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2, textAlign: "left" }}>Ops root<div style={{ fontSize: 11, color: "var(--ink3)" }}>superadmin</div></div>
              </button>
            </div>
          </div>

          <div className="sa-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 26px 40px" }}>
            {section === "fleet" && <FleetPanel ctx={ctx} />}
            {section === "orgs" && <OrgsPanel ctx={ctx} />}
            {section === "cost" && <CostPanel ctx={ctx} killOn={killOn} onSyncKill={setKillOn} onToggleKill={toggleKill} />}
            {section === "quality" && <QualityPanel ctx={ctx} threshold={threshold} />}
            {section === "billing" && <BillingPanel ctx={ctx} />}
            {section === "config" && <ConfigPanel ctx={ctx} onThreshold={setThreshold} />}
            {section === "audit" && <AuditPanel />}
          </div>
        </div>
      </div>

      {/* CONFIRM MODAL (reason required) */}
      {confirm && (
        <div style={modalScrim}>
          <div style={{ ...modalCard }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: confirm.danger ? "rgba(255,0,49,.16)" : "rgba(163,66,255,.16)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={confirm.icon} size={24} color={confirm.danger ? "#FF6B84" : "#CBA3FF"} />
              </div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{confirm.title}</div>
            </div>
            <p style={{ margin: "16px 0 8px", fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.55 }}>{confirm.body}</p>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)", margin: "14px 0 6px" }}>Reason (required, logged)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you doing this?" autoFocus style={{ width: "100%", height: 44, padding: "0 14px", borderRadius: 12, border: "2px solid var(--border)", background: "var(--bg)", outline: "none", color: "#fff", fontSize: 13.5 }} />
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setConfirm(null)} style={modalCancel}>Cancel</button>
              <button onClick={doConfirm} disabled={!reason.trim()} style={{ ...modalConfirm, background: confirm.danger ? "#FF0031" : "#FF0660", opacity: reason.trim() ? 1 : 0.5, cursor: reason.trim() ? "pointer" : "not-allowed" }}>{confirm.cta}</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 70, display: "flex", alignItems: "center", gap: 10, padding: "13px 20px", borderRadius: 9999, background: "#161659", border: "1px solid var(--border)", boxShadow: "0 16px 40px rgba(0,0,0,.5)", animation: "saRise .25s ease" }}>
          <Icon name={toast.kind === "error" ? "error" : "check_circle"} size={20} color={toast.kind === "error" ? "#FF6B84" : "#4BE39A"} />
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{toast.msg}</span>
          {toast.kind === "ok" && <span style={{ fontSize: 12, color: "var(--ink3)" }}>· written to audit log</span>}
        </div>
      )}
    </div>
  );
}
