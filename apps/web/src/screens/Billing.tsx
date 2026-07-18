import { useEffect, useState } from "react";
import { api } from "../api/client";
import "../pds.css";

// ============================================================
// Billing — the org's plan, clone slots, and subscription management.
// Reads GET /api/billing; Upgrade -> hosted Checkout, Manage -> the provider
// Customer Portal (Lemon Squeezy). Follows the After Human PDS token set
// (pds.css). Degrades gracefully when billing is not configured (shows a notice).
// ============================================================

const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));

type BillingState = {
  orgId: string;
  plan: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  paidCloneSlots: number;
  currentPeriodEnd: string | null;
};
type BillingResp = {
  configured: boolean;
  enforced: boolean;
  state: BillingState;
  liveClones: number;
  slotsAvailable: number;
  catalog: Record<string, { label: string; maxSlots: number; selfServe: boolean }>;
};

const PLAN_LABEL: Record<string, string> = { free: "Free / Rehearsal", starter: "Starter", growth: "Growth", enterprise: "Enterprise" };

function statusTone(status: string): string {
  if (status === "active" || status === "trialing") return "#0E8A4F";
  if (status === "past_due" || status === "incomplete") return "#C9820A";
  if (status === "canceled") return "#C0392B";
  return "var(--ink3)";
}

export default function Billing() {
  const [data, setData] = useState<BillingResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const theme = (document.documentElement.getAttribute("data-theme") as "light" | "dark") || "light";

  const load = () => api.get<BillingResp>("/api/billing").then(setData).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);

  async function checkout(plan: string) {
    setBusy(plan);
    setErr(null);
    try {
      const r = await api.post<{ url?: string; error?: string }>("/api/billing/checkout", { plan, quantity: 1 });
      if (r.url) { window.location.href = r.url; return; }
      setErr(r.error || "could not start checkout");
    } catch (e) { setErr(String(e)); }
    setBusy(null);
  }
  async function portal() {
    setBusy("portal");
    setErr(null);
    try {
      const r = await api.post<{ url?: string; error?: string }>("/api/billing/portal", {});
      if (r.url) { window.location.href = r.url; return; }
      setErr(r.error || "could not open the billing portal");
    } catch (e) { setErr(String(e)); }
    setBusy(null);
  }

  const s = data?.state;
  const isPaid = s ? ["starter", "growth", "enterprise"].includes(s.plan) && ["active", "trialing"].includes(s.status) : false;
  const slots = s?.paidCloneSlots ?? 0;
  const used = data?.liveClones ?? 0;
  const pct = slots > 0 ? Math.min(100, (used / slots) * 100) : 0;

  const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 18, padding: 24 };
  const btn = (bg: string, color: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, height: 44, padding: "0 20px", borderRadius: 9999, border: "none", background: bg, color, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" });

  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)", color: "var(--ink1)" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "34px 24px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 26, color: "#A342FF" }}>credit_card</span>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-.02em" }}>Billing</h1>
        </div>
        <p style={{ margin: "0 0 24px", color: "var(--ink2)", fontSize: 14 }}>
          You pay per clone that is cleared for live calls. Rehearsal and calibration are always free.
        </p>

        {err && <div style={{ ...card, borderColor: "#C0392B55", color: "#C0392B", marginBottom: 16, padding: "14px 18px" }}>{err}</div>}

        {data && !data.configured && (
          <div style={{ ...card, marginBottom: 16, background: "var(--ghost)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Billing is not configured yet</div>
            <div style={{ color: "var(--ink2)", fontSize: 13.5 }}>Self-serve checkout is unavailable until billing keys are set. Contact us to set up your plan.</div>
          </div>
        )}

        {/* Current plan */}
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 14 }}>Current plan</div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>{PLAN_LABEL[s?.plan ?? "free"] ?? s?.plan}</div>
              <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: statusTone(s?.status ?? "inactive") }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusTone(s?.status ?? "inactive") }} />
                {(s?.status ?? "inactive").replace("_", " ")}
                {s?.currentPeriodEnd && isPaid && <span style={{ color: "var(--ink3)", fontWeight: 500 }}>· renews {new Date(s.currentPeriodEnd).toLocaleDateString()}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {data?.configured && s?.stripeCustomerId && (
                <button onClick={portal} disabled={busy === "portal"} style={btn("transparent", "var(--ink1)")}>
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>settings</span>
                  {busy === "portal" ? "Opening…" : "Manage billing"}
                </button>
              )}
              <button onClick={() => nav("pricing")} style={btn("var(--ghost)", "var(--ink1)")}>See plans</button>
            </div>
          </div>
        </div>

        {/* Clone slots */}
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 14 }}>Clone slots</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 34, fontWeight: 800 }}>{used}</span>
            <span style={{ fontSize: 15, color: "var(--ink2)" }}>of {slots} live slot{slots === 1 ? "" : "s"} in use</span>
          </div>
          <div style={{ height: 10, borderRadius: 6, background: "var(--ghost)", overflow: "hidden", marginTop: 12 }}>
            <div style={{ width: pct + "%", height: "100%", background: pct >= 100 ? "#C0392B" : "linear-gradient(90deg,#A342FF,#00BBFF)" }} />
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--ink2)" }}>
            {slots === 0
              ? "No paid slots yet — a clone can rehearse for free, but going live needs a paid plan."
              : `${data?.slotsAvailable ?? 0} slot(s) available for a new live clone.`}
          </div>
        </div>

        {/* Upgrade CTAs (self-serve plans) */}
        {data?.configured && !isPaid && (
          <div style={{ ...card }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 6 }}>Go live</div>
            <div style={{ color: "var(--ink2)", fontSize: 13.5, marginBottom: 16 }}>Choose a plan to clear your first clone for live calls.</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button onClick={() => checkout("starter")} disabled={!!busy} style={btn("var(--ink1)", "var(--card)")}>
                {busy === "starter" ? "Starting…" : "Start Starter — $2,000/clone"}
              </button>
              <button onClick={() => checkout("growth")} disabled={!!busy} style={btn("#FF0660", "#fff")}>
                {busy === "growth" ? "Starting…" : "Start Growth — $1,500/clone"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
