// The seven super-admin panels. Each binds to the API contract and falls back
// to a clearly-labelled loading / empty / unreachable state (StateBlock) so
// nothing fabricated ever ships. Every mutation routes a reason to the backend.
import { useEffect, useMemo, useState } from "react";
import { saApi, useSa } from "./api";
import { C, healthColor, usageColor, statusMeta, sevMeta, Icon, KpiTile, StateBlock } from "./ui";
import type {
  FleetResp, LiveCall, Kpi, OrgsResp, Org, UsageResp, UsageRow,
  ReadinessRow, ReportRow, BillingResp, RateCardItem, ConfigResp, FeatureFlag,
  AuditResp, AuditEntry, PanelCtx,
} from "./types";

// Shared table shells --------------------------------------------------------
const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden" };
const cardHead: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "15px 18px", borderBottom: "1px solid var(--divider)" };
const th: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)", borderBottom: "1px solid var(--divider)", padding: "12px 18px" };
const row: React.CSSProperties = { alignItems: "center", padding: "13px 18px", borderBottom: "1px solid var(--divider)" };
const outlineBtn: React.CSSProperties = { height: 32, padding: "0 12px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 };
const bar = (pct: number, color: string, h = 7): React.ReactNode => (
  <div style={{ height: h, borderRadius: 9999, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
    <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 9999 }} />
  </div>
);

async function mut(ctx: PanelCtx, path: string, body: unknown, okMsg: string, reload?: () => void): Promise<void> {
  try {
    await saApi.post(path, body);
    ctx.toast(okMsg);
    reload?.();
  } catch (e) {
    ctx.toast(`Could not complete · ${String(e)}`, "error");
  }
}

// ─── 1. LIVE FLEET ──────────────────────────────────────────────────────────
export function FleetPanel({ ctx }: { ctx: PanelCtx }) {
  const { data, loading, error, reload } = useSa<FleetResp>("/api/superadmin/fleet");
  const calls = data?.calls ?? [];
  const kpis: Kpi[] = useMemo(() => {
    if (data?.kpis?.length) return data.kpis;
    const n = (s: string) => calls.filter((c) => c.status === s).length;
    const orgs = new Set(calls.map((c) => c.org)).size;
    return [
      { label: "Live calls", val: String(calls.length), sub: `across ${orgs} org${orgs === 1 ? "" : "s"}`, color: "#fff" },
      { label: "Healthy", val: String(n("healthy")), sub: "nominal", color: C.green },
      { label: "Stalling", val: String(n("stalling")), sub: "watch closely", color: C.amber },
      { label: "Bailing out", val: String(n("bailing")), sub: "needs action", color: C.red },
    ];
  }, [data, calls]);

  const watch = (c: LiveCall) => {
    ctx.toast(`Watching ${c.org} · ${c.clone}`);
    saApi.post(`/api/superadmin/calls/${c.id}/watch`, { reason: "operator watch" }).catch(() => {});
  };
  const kill = (c: LiveCall) =>
    ctx.openConfirm({
      title: "Kill this live call?", icon: "stop_circle", danger: true, cta: "Kill call",
      body: `This immediately ends ${c.clone}'s call with ${c.prospect} at ${c.org}. The prospect is dropped and the director is notified.`,
      run: (reason) => mut(ctx, `/api/superadmin/calls/${c.id}/kill`, { reason }, `Killed ${c.org} · ${c.clone}`, reload),
    });

  const cols = "1.4fr 1.2fr 1fr .8fr 1.2fr auto";
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        {kpis.map((k, i) => <KpiTile key={i} k={k} />)}
      </div>
      <div style={card}>
        <div style={cardHead}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.pink, animation: "saPulse 1.3s ease-in-out infinite" }} />
          <div style={{ fontSize: 14, fontWeight: 700 }}>Live calls across all orgs</div>
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink3)" }}>Real time · {calls.length} active</div>
        </div>
        <div style={{ ...th, display: "grid", gridTemplateColumns: cols, gap: 12 }}>
          <div>Org</div><div>Clone · prospect</div><div>Health</div><div>Duration</div><div>Status</div><div />
        </div>
        <StateBlock loading={loading} error={error} empty={calls.length === 0} emptyLabel="No live calls right now.">
          {calls.map((c) => {
            const s = statusMeta(c.status);
            return (
              <div key={c.id} className="sa-row" style={{ ...row, display: "grid", gridTemplateColumns: cols, gap: 12 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{c.org}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{c.clone} <span style={{ color: "var(--ink3)" }}>· {c.prospect}</span></div>
                <div>{bar(c.health, healthColor(c.health))}</div>
                <div style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums", color: "var(--ink2)" }}>{c.dur}</div>
                <div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 9999, background: s.bg, color: s.c }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.c, animation: s.anim ? "saPulse 1s ease-in-out infinite" : undefined }} />
                    {s.label}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 7 }}>
                  <button onClick={() => watch(c)} style={outlineBtn}><Icon name="visibility" size={16} />Watch</button>
                  <button onClick={() => kill(c)} style={{ height: 32, padding: "0 12px", borderRadius: 9999, border: "none", background: "rgba(255,0,49,.16)", color: C.red, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><Icon name="stop_circle" size={16} />Kill</button>
                </div>
              </div>
            );
          })}
        </StateBlock>
      </div>
    </>
  );
}

// ─── 2. ORGS & USERS ────────────────────────────────────────────────────────
export function OrgsPanel({ ctx }: { ctx: PanelCtx }) {
  const { data, loading, error, reload } = useSa<OrgsResp>("/api/superadmin/orgs");
  const orgs = data?.orgs ?? [];
  const [createOpen, setCreateOpen] = useState(false);

  const enter = (o: Org) =>
    ctx.openConfirm({
      title: `Enter ${o.name} as support?`, icon: "login", danger: false, cta: "Enter org",
      body: `You will impersonate an admin of ${o.name}. The org is notified, your session is fully recorded, and every action is attributed to you in their audit trail.`,
      run: (reason) => mut(ctx, `/api/superadmin/orgs/${o.id}/enter`, { reason }, `Entered ${o.name} (impersonation)`, reload),
    });
  const suspend = (o: Org) => {
    const on = !!o.suspended;
    ctx.openConfirm({
      title: `${on ? "Restore " : "Suspend "}${o.name}?`, icon: on ? "restart_alt" : "pause_circle", danger: !on, cta: on ? "Restore org" : "Suspend org",
      body: on ? `Restores access for all users at ${o.name}.` : `Immediately blocks all logins and pauses every clone at ${o.name}. In-progress calls are ended.`,
      run: (reason) => mut(ctx, `/api/superadmin/orgs/${o.id}/suspend`, { reason, suspend: !on }, `${on ? "Restored " : "Suspended "}${o.name}`, reload),
    });
  };

  const cols = "1.5fr .9fr .8fr 1fr 1fr auto";
  const planStyle = (plan?: string) =>
    plan === "Enterprise" ? { bg: "rgba(163,66,255,.16)", c: C.purple } : plan === "Growth" ? { bg: "rgba(0,187,255,.16)", c: C.blue } : { bg: "rgba(255,255,255,.1)", c: "#fff" };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--ink2)" }}>{orgs.length} customer org{orgs.length === 1 ? "" : "s"}</div>
        <button onClick={() => setCreateOpen(true)} style={{ marginLeft: "auto", height: 40, padding: "0 18px", borderRadius: 9999, border: "none", background: C.pink, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: "0 8px 24px rgba(255,6,96,.3)" }}><Icon name="add" size={18} />Create org</button>
      </div>
      <div style={card}>
        <div style={{ ...th, display: "grid", gridTemplateColumns: cols, gap: 12 }}>
          <div>Organization</div><div>Plan</div><div>Seats</div><div>Usage</div><div>Health</div><div />
        </div>
        <StateBlock loading={loading} error={error} empty={orgs.length === 0} emptyLabel="No organizations yet.">
          {orgs.map((o) => {
            const ps = planStyle(o.plan);
            const usage = o.usage ?? 0;
            const hc = o.suspended ? C.red : o.health === "Over cap" ? C.red : o.health === "Watch" ? C.amber : C.green;
            return (
              <div key={o.id} className="sa-row" style={{ ...row, display: "grid", gridTemplateColumns: cols, gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>{o.initials || o.name.slice(0, 1)}</div>
                  <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>{o.name}</div><div style={{ fontSize: 11, color: "var(--ink3)" }}>{o.domain}</div></div>
                </div>
                <div><span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 9999, background: ps.bg, color: ps.c }}>{o.plan}</span></div>
                <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{o.seats}</div>
                <div><div style={{ fontSize: 11.5, color: "var(--ink2)", marginBottom: 4 }}>{usage}% used</div>{bar(usage, usageColor(usage), 6)}</div>
                <div><span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: hc }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: hc }} />{o.suspended ? "Suspended" : o.health}</span></div>
                <div style={{ display: "flex", gap: 7 }}>
                  <button onClick={() => enter(o)} style={outlineBtn}><Icon name="login" size={16} />Enter org</button>
                  <button onClick={() => suspend(o)} style={{ height: 32, padding: "0 12px", borderRadius: 9999, border: "none", background: o.suspended ? "rgba(46,211,125,.16)" : "rgba(248,192,26,.16)", color: o.suspended ? C.green : C.amber, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{o.suspended ? "Restore" : "Suspend"}</button>
                </div>
              </div>
            );
          })}
        </StateBlock>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 12, display: "flex", alignItems: "center", gap: 7 }}>
        <Icon name="history_edu" size={16} />Entering an org (impersonation) and suspensions are written to the audit log with your identity, reason, and timestamp.
      </div>
      {createOpen && <CreateOrgModal ctx={ctx} onClose={() => setCreateOpen(false)} onCreated={reload} />}
    </>
  );
}

function CreateOrgModal({ ctx, onClose, onCreated }: { ctx: PanelCtx; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [plan, setPlan] = useState("Team");
  const [reason, setReason] = useState("");
  const valid = name.trim() && reason.trim();
  const submit = async () => {
    await mut(ctx, "/api/superadmin/orgs", { name: name.trim(), domain: domain.trim(), plan, reason: reason.trim() }, `Created org ${name.trim()}`, onCreated);
    onClose();
  };
  const field: React.CSSProperties = { width: "100%", height: 44, padding: "0 14px", borderRadius: 12, border: "2px solid var(--border)", background: "var(--bg)", outline: "none", color: "#fff", fontSize: 13.5 };
  const label: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)", margin: "14px 0 6px" };
  return (
    <div style={modalScrim}>
      <div style={{ ...modalCard, maxWidth: 440 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(163,66,255,.16)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="apartment" size={24} color={C.purple} /></div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Create organization</div>
        </div>
        <label style={{ ...label, marginTop: 18 }}>Organization name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc" style={field} />
        <label style={label}>Domain</label>
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" style={field} />
        <label style={label}>Plan</label>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} style={{ ...field, appearance: "auto" }}>
          <option>Team</option><option>Growth</option><option>Enterprise</option>
        </select>
        <label style={label}>Reason (required, logged)</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you creating this org?" style={field} />
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={modalCancel}>Cancel</button>
          <button onClick={submit} disabled={!valid} style={{ ...modalConfirm, background: C.pink, opacity: valid ? 1 : 0.5, cursor: valid ? "pointer" : "not-allowed" }}>Create org</button>
        </div>
      </div>
    </div>
  );
}

// ─── 3. COST & METERING ─────────────────────────────────────────────────────
export function CostPanel({ ctx, killOn, onSyncKill, onToggleKill }: { ctx: PanelCtx; killOn: boolean; onSyncKill: (v: boolean) => void; onToggleKill: () => void }) {
  const { data, loading, error } = useSa<UsageResp>("/api/usage");
  const rows = data?.rows ?? [];
  const [breakerOn, setBreakerOn] = useState(true);

  useEffect(() => {
    if (typeof data?.breakerEnabled === "boolean") setBreakerOn(data.breakerEnabled);
    if (typeof data?.killSwitchEnabled === "boolean") onSyncKill(data.killSwitchEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const kpis = data?.kpis ?? [];
  const toggleBreaker = () => {
    const next = !breakerOn;
    setBreakerOn(next);
    mut(ctx, "/api/usage/kill-switch", { target: "breaker", enabled: next, reason: "operator toggle" }, `Circuit breaker ${next ? "enabled" : "disabled"}`);
  };
  const toggleStyle = (on: boolean, onColor: string): React.CSSProperties => ({ width: 52, height: 30, borderRadius: 9999, border: "none", background: on ? onColor : "rgba(255,255,255,.16)", cursor: "pointer", position: "relative", flex: "none" });
  const knob = (on: boolean): React.CSSProperties => ({ position: "absolute", top: 3, left: on ? 25 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left .15s" });
  const cols = "1.3fr 2fr .9fr .9fr auto";

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 18 }}>
        {kpis.length ? kpis.map((k, i) => <KpiTile key={i} k={k} big={26} />) : ([0, 1, 2, 3].map((i) => <KpiTile key={i} k={{ label: ["Total spend today", "vs allowance", "Unprofitable orgs", "Breaker trips today"][i], val: "—", sub: "pending backend", color: "var(--ink3)" }} big={26} />))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
        <div style={{ ...card, borderRadius: 16, border: `1px solid ${breakerOn ? "rgba(46,211,125,.35)" : "var(--border)"}`, padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="emergency_heat" size={22} color={C.amber} />
            <div style={{ fontSize: 14, fontWeight: 700 }}>Runaway-spend circuit breaker</div>
            <button onClick={toggleBreaker} style={{ ...toggleStyle(breakerOn, "#2ED37D"), marginLeft: "auto" }}><span style={knob(breakerOn)} /></button>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 10, lineHeight: 1.5 }}>Auto-pauses any org that exceeds 90% of its allowance in a rolling hour. {breakerOn ? "Active" : "Disabled"}.</div>
        </div>
        <div style={{ ...card, borderRadius: 16, border: `1px solid ${killOn ? "rgba(255,0,49,.45)" : "var(--border)"}`, padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="power_settings_new" size={22} color={C.red} />
            <div style={{ fontSize: 14, fontWeight: 700 }}>Global spend kill-switch</div>
            <button onClick={onToggleKill} style={{ ...toggleStyle(killOn, "#FF0031"), marginLeft: "auto" }}><span style={knob(killOn)} /></button>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 10, lineHeight: 1.5 }}>Halts all model spend platform-wide. Use only for a billing or vendor emergency. {killOn ? "ENGAGED — all spend halted" : "Standby"}.</div>
        </div>
      </div>
      <div style={card}>
        <div style={{ ...cardHead }}><div style={{ fontSize: 14, fontWeight: 700 }}>Per-org usage vs allowance</div><div style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink3)" }}>This billing period</div></div>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyLabel="No usage recorded this period.">
          {rows.map((r: UsageRow, i) => {
            const pct = r.pct ?? 0;
            return (
              <div key={r.id || i} className="sa-row" style={{ ...row, display: "grid", gridTemplateColumns: cols, gap: 14 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{r.org}</div>
                <div><div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--ink2)", marginBottom: 4 }}><span>{r.used}</span><span style={{ color: "var(--ink3)" }}>of {r.cap}</span></div>{bar(pct, usageColor(pct))}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{r.margin}</div>
                <div><span style={{ fontSize: 11.5, fontWeight: 700, color: r.profitable ? C.green : C.red }}>{r.profitable ? "Profitable" : "Unprofitable"}</span></div>
                <div><button style={{ ...outlineBtn, height: 30 }}>Adjust cap</button></div>
              </div>
            );
          })}
        </StateBlock>
      </div>
    </>
  );
}

// ─── 4. QUALITY & INCIDENTS ─────────────────────────────────────────────────
export function QualityPanel({ ctx, threshold }: { ctx: PanelCtx; threshold: number }) {
  const rd = useSa<{ readiness?: ReadinessRow[] } | ReadinessRow[]>("/api/superadmin/readiness");
  const rp = useSa<{ reports?: ReportRow[] } | ReportRow[]>("/api/superadmin/reports");
  const readiness: ReadinessRow[] = Array.isArray(rd.data) ? rd.data : rd.data?.readiness ?? [];
  const reports: ReportRow[] = Array.isArray(rp.data) ? rp.data : rp.data?.reports ?? [];

  const triage = (q: ReportRow) =>
    ctx.openConfirm({
      title: "Triage this report?", icon: "flag", danger: false, cta: "Triage",
      body: `Mark "${q.title}" as triaged and route it to the quality queue. ${q.meta || ""}`,
      run: (reason) => mut(ctx, `/api/superadmin/reports/${q.id}/triage`, { reason }, "Report triaged", rp.reload),
    });
  const scoreColor = (n: number) => (n >= 70 ? C.green : n >= 50 ? C.amber : C.red);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
      <div style={card}>
        <div style={cardHead}><div style={{ fontSize: 14, fontWeight: 700 }}>Readiness across all clones</div><div style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink3)" }}>Threshold {threshold} to go live</div></div>
        <StateBlock loading={rd.loading} error={rd.error} empty={readiness.length === 0} emptyLabel="No clones in calibration.">
          {readiness.map((r, i) => (
            <div key={r.id || i} className="sa-row" style={{ ...row, display: "grid", gridTemplateColumns: "1.4fr 2fr auto", gap: 14 }}>
              <div><div style={{ fontSize: 13, fontWeight: 700 }}>{r.clone}</div><div style={{ fontSize: 11, color: "var(--ink3)" }}>{r.org}</div></div>
              <div>{bar(r.score, scoreColor(r.score))}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 14, fontWeight: 800, color: scoreColor(r.score) }}>{r.score}</span><span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(r.score) }}>{r.score >= threshold ? "live" : "below"}</span></div>
            </div>
          ))}
        </StateBlock>
      </div>
      <div style={card}>
        <div style={{ ...cardHead, gap: 8 }}>
          <Icon name="flag" size={19} color={C.pinkInk} />
          <div style={{ fontSize: 14, fontWeight: 700 }}>Report-this-call queue</div>
          {reports.length > 0 && <span style={{ marginLeft: "auto", minWidth: 22, height: 22, padding: "0 7px", borderRadius: 9999, background: "rgba(255,6,96,.18)", color: C.pinkInk, fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{reports.length}</span>}
        </div>
        <StateBlock loading={rp.loading} error={rp.error} empty={reports.length === 0} emptyLabel="Queue is clear.">
          {reports.map((q) => (
            <div key={q.id} className="sa-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: "1px solid var(--divider)" }}>
              <Icon name={q.icon || "report"} size={20} color={q.color || C.pinkInk} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{q.title}</div><div style={{ fontSize: 11, color: "var(--ink3)" }}>{q.meta}</div></div>
              <button onClick={() => triage(q)} style={{ ...outlineBtn, height: 30 }}>Triage</button>
            </div>
          ))}
        </StateBlock>
      </div>
    </div>
  );
}

// ─── 5. BILLING & REVENUE ───────────────────────────────────────────────────
// Real pricing (locked): Starter $2,000 first clone then $1,500/additional,
// Growth $1,500/clone, Enterprise custom, internal overage $1.50/live-call-min.
const DEFAULT_RATE_CARD: RateCardItem[] = [
  { id: "starter-first", item: "Starter · first certified clone / month", price: "$2,000" },
  { id: "starter-add", item: "Starter · each additional clone / month", price: "$1,500" },
  { id: "growth", item: "Growth · per certified clone / month", price: "$1,500" },
  { id: "enterprise", item: "Enterprise · per clone / month", price: "Custom" },
  { id: "overage", item: "Overage · per live-call minute (internal, fair-use)", price: "$1.50" },
];

export function BillingPanel({ ctx }: { ctx: PanelCtx }) {
  const { data, loading } = useSa<BillingResp>("/api/superadmin/billing");
  const [rateCard, setRateCard] = useState<RateCardItem[]>(DEFAULT_RATE_CARD);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => { if (data?.rateCard?.length) setRateCard(data.rateCard); }, [data]);

  const kpis = data?.kpis ?? [];
  const beginEdit = (r: RateCardItem) => { setEditId(r.id); setDraft(r.price); };
  const saveEdit = async (r: RateCardItem) => {
    const next = rateCard.map((x) => (x.id === r.id ? { ...x, price: draft } : x));
    setRateCard(next);
    setEditId(null);
    await mut(ctx, "/api/superadmin/billing/rate-card", { id: r.id, price: draft, reason: "rate card edit" }, `Updated rate: ${r.item}`);
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 18 }}>
        {kpis.length ? kpis.map((k, i) => <KpiTile key={i} k={k} big={26} />) : [0, 1, 2, 3].map((i) => <KpiTile key={i} k={{ label: ["MRR", "Net revenue retention", "Gross margin", "At-risk MRR"][i], val: "—", sub: loading ? "loading" : "pending backend", color: "var(--ink3)" }} big={26} />)}
      </div>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 18, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Rate card</div>
        {rateCard.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid var(--divider)" }}>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{r.item}</div>
            {editId === r.id ? (
              <>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus style={{ width: 110, height: 30, padding: "0 10px", borderRadius: 8, border: "2px solid var(--border)", background: "var(--bg)", color: "#fff", fontSize: 13, fontWeight: 700, textAlign: "right" }} />
                <button onClick={() => saveEdit(r)} style={{ height: 30, padding: "0 12px", borderRadius: 9999, border: "none", background: C.pink, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
                <button onClick={() => setEditId(null)} style={{ ...outlineBtn, height: 30 }}>Cancel</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)" }}>{r.price}</div>
                <button onClick={() => beginEdit(r)} style={{ ...outlineBtn, height: 30 }}>Edit</button>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── 6. CONFIG & FLAGS ──────────────────────────────────────────────────────
const DEFAULT_FLAGS: FeatureFlag[] = [
  { name: "Autonomous outreach", enabled: true },
  { name: "Live screen-share on calls", enabled: true },
  { name: "Voice cloning", enabled: true },
  { name: "Redteam sampling", enabled: false },
];

export function ConfigPanel({ ctx, onThreshold }: { ctx: PanelCtx; onThreshold: (n: number) => void }) {
  const { data, loading, error } = useSa<ConfigResp>("/api/superadmin/config");
  const [threshold, setThreshold] = useState(70);
  const [modelTier, setModelTier] = useState("Balanced (GPT-tier + Claude-tier)");
  const [authMode, setAuthMode] = useState("PASSWORD_ONLY");
  const [flags, setFlags] = useState<FeatureFlag[]>(DEFAULT_FLAGS);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (typeof data.certThreshold === "number") { setThreshold(data.certThreshold); onThreshold(data.certThreshold); }
    if (data.modelTier) setModelTier(data.modelTier);
    if (data.authMode) setAuthMode(data.authMode);
    if (data.flags?.length) setFlags(data.flags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const mark = () => setDirty(true);
  const toggleFlag = (name: string) => { setFlags((f) => f.map((x) => (x.name === name ? { ...x, enabled: !x.enabled } : x))); mark(); };
  const save = async () => {
    onThreshold(threshold);
    setDirty(false);
    await mut(ctx, "/api/superadmin/config", { certThreshold: threshold, modelTier, authMode, flags, reason: "config update" }, "Global config saved");
  };

  const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 14, padding: "16px 0", borderTop: "1px solid var(--divider)" };
  const selectStyle: React.CSSProperties = { height: 38, padding: "0 12px", borderRadius: 10, border: "2px solid var(--border)", background: "var(--bg)", color: "#fff", fontSize: 12.5, fontWeight: 600, appearance: "auto" };

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 18, padding: 22, maxWidth: 720 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Global configuration</div>
      <div style={{ fontSize: 12.5, color: "var(--ink3)", marginBottom: 18 }}>Platform-wide defaults. Changes are audit-logged and take effect immediately. {loading ? "· loading current values" : error ? "· using defaults (backend unreachable)" : ""}</div>

      <div style={rowStyle}>
        <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700 }}>Certification threshold</div><div style={{ fontSize: 12, color: "var(--ink3)" }}>Minimum readiness score a clone must clear to go live</div></div>
        <input type="number" min={0} max={100} value={threshold} onChange={(e) => { setThreshold(Math.max(0, Math.min(100, Number(e.target.value) || 0))); mark(); }} style={{ width: 80, height: 44, padding: "0 12px", borderRadius: 10, border: "2px solid var(--border)", background: "var(--bg)", color: "#A342FF", fontSize: 22, fontWeight: 800, textAlign: "center" }} />
      </div>
      <div style={rowStyle}>
        <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700 }}>Model tier default</div><div style={{ fontSize: 12, color: "var(--ink3)" }}>Routing profile applied to new orgs</div></div>
        <select value={modelTier} onChange={(e) => { setModelTier(e.target.value); mark(); }} style={selectStyle}>
          <option>Economy (fast-tier)</option>
          <option>Balanced (GPT-tier + Claude-tier)</option>
          <option>Premium (frontier-tier)</option>
        </select>
      </div>
      <div style={rowStyle}>
        <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700 }}>AUTH_MODE</div><div style={{ fontSize: 12, color: "var(--ink3)" }}>Platform authentication policy</div></div>
        <select value={authMode} onChange={(e) => { setAuthMode(e.target.value); mark(); }} style={selectStyle}>
          <option value="PASSWORD_ONLY">PASSWORD_ONLY</option>
          <option value="SSO_MFA">SSO + MFA required</option>
        </select>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, margin: "22px 0 6px" }}>Feature flags</div>
      {flags.map((f) => (
        <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", borderTop: "1px solid var(--divider)" }}>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{f.name}</div>
          <button onClick={() => toggleFlag(f.name)} style={{ width: 48, height: 28, borderRadius: 9999, border: "none", background: f.enabled ? C.pink : "rgba(255,255,255,.16)", cursor: "pointer", position: "relative" }}>
            <span style={{ position: "absolute", top: 3, left: f.enabled ? 23 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
          </button>
        </div>
      ))}

      <button onClick={save} disabled={!dirty} style={{ marginTop: 22, height: 44, padding: "0 22px", borderRadius: 9999, border: "none", background: C.pink, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: dirty ? "pointer" : "not-allowed", opacity: dirty ? 1 : 0.45, display: "inline-flex", alignItems: "center", gap: 8 }}><Icon name="save" size={18} />Save changes</button>
    </div>
  );
}

// ─── 7. AUDIT LOG ───────────────────────────────────────────────────────────
export function AuditPanel() {
  const { data, loading, error } = useSa<AuditResp | AuditEntry[]>("/api/superadmin/audit");
  const entries: AuditEntry[] = Array.isArray(data) ? data : data?.entries ?? [];
  return (
    <div style={card}>
      <div style={{ ...cardHead, gap: 8 }}>
        <Icon name="history" size={19} color={C.green} />
        <div style={{ fontSize: 14, fontWeight: 700 }}>Audit log</div>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink3)" }}>Immutable · every cross-org action</div>
      </div>
      <StateBlock loading={loading} error={error} empty={entries.length === 0} emptyLabel="No audit entries yet.">
        {entries.map((a, i) => {
          const s = sevMeta(a.severity || "");
          return (
            <div key={a.id || i} style={{ display: "grid", gridTemplateColumns: "130px 1fr auto", gap: 14, alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--divider)", animation: "saRise .3s ease" }}>
              <div style={{ fontSize: 11.5, color: "var(--ink3)", fontVariantNumeric: "tabular-nums" }}>{a.time}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <Icon name={a.icon || "bolt"} size={18} color={a.color || "#fff"} />
                <div style={{ fontSize: 13 }}><span style={{ fontWeight: 700 }}>{a.actor}</span> <span style={{ color: "var(--ink2)" }}>{a.action}</span> <span style={{ fontWeight: 600 }}>{a.target}</span></div>
              </div>
              <div><span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 9999, background: s.bg, color: s.c }}>{a.severity}</span></div>
            </div>
          );
        })}
      </StateBlock>
    </div>
  );
}

// Shared modal styles (used by CreateOrgModal + the global confirm modal). ----
export const modalScrim: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 60, background: "rgba(4,4,30,.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
export const modalCard: React.CSSProperties = { width: "100%", maxWidth: 440, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 22, padding: 26, boxShadow: "0 30px 80px rgba(0,0,0,.5)", animation: "saRise .2s ease" };
export const modalCancel: React.CSSProperties = { flex: 1, height: 46, borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 14, fontWeight: 700, cursor: "pointer" };
export const modalConfirm: React.CSSProperties = { flex: 1, height: 46, borderRadius: 9999, border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" };
