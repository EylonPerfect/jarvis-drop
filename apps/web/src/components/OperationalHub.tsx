import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../api/client";

// ============================================================
// Operational hub — cards folded into the live-agent Readiness
// screen. Matches the approved merge mockup.
//
// KpiStrip / TodayCard / EmailCard / SlackCard / ConnectedCard
// are EXAMPLE / holding states — clearly tagged where the mockup
// tags them (an "Example feed" pill on the three feeds). There is
// no email / Slack / calendar backend yet, so their content comes
// from static example constants and honest holding states.
//
// GoalsCard is REAL: it self-fetches GET /api/clones/:id/goals,
// pulls the live N-of-7 count from GET /api/clones/:id/gates, and
// persists edits with PUT /api/clones/:id/goals using optimistic
// updates that roll back on failure. Manual goals toggle by hand;
// quality-check ("gates") goals track the real gate count and
// complete on their own.
//
// The screen root is already `.pmx`, so these cards inherit the
// PDS mockup tokens. Card chrome uses the `card` class and the KPI
// strip uses `kpis5` / `kpi`; everything else is inline styles on
// CSS-variable tokens so both light and dark themes adapt.
// ============================================================

type Goal = { id: string; objective: string; kind: "manual" | "gates"; target?: string; done?: boolean; createdAt: string };
type AgendaRow = { time: string; ampm: string; title: string; who: string; kind: "done" | "next" | "upcoming"; tag: string };
type SlackPost = { channel: string; time: string; text: string; mention?: string };
type EmailRow = { kind: "sent" | "scheduled" | "draft"; tag: string; icon: string; subject: string; meta: string; to: string; preview: string };

const newGoalId = (): string => `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const relDate = (iso: string): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
};

// Example content shown until the workspace backends exist. Every
// block that renders these carries an "Example feed" pill.
const EXAMPLE_AGENDA: AgendaRow[] = [
  { time: "9:00", ampm: "AM", title: "Discovery — Acme Robotics", who: "with Dana Whitfield, VP Talent", kind: "done", tag: "Done" },
  { time: "11:30", ampm: "AM", title: "Product demo — Globex", who: "3 attendees · autopilot driving", kind: "next", tag: "On now" },
  { time: "2:00", ampm: "PM", title: "Follow-up — Initech", who: "with Marcus Lee, Head of Recruiting", kind: "upcoming", tag: "Upcoming" },
];
const EXAMPLE_SLACK: SlackPost[] = [
  { channel: "#sales", time: "9:52 AM", text: "Wrapped discovery with Acme Robotics. Dana wants a decision by end of quarter and flagged engineering roles as the priority. Full recap and next steps in the thread." },
  { channel: "#deals", time: "9:54 AM", text: "Globex is looking at 20 more seats. Can you prep expansion pricing before Thursday so I can send it in the follow-up?", mention: "james (AE)" },
  { channel: "#cs-team", time: "8:00 AM", text: "Standup: 6 calls today, 1 follow-up blocked on a SOC 2 answer (Initech). Flagged it for a human." },
];
const EXAMPLE_EMAILS: EmailRow[] = [
  { kind: "sent", tag: "Sent", icon: "check", subject: "Recap and next steps · Acme Robotics", meta: "20m ago", to: "Dana Whitfield <dana@acmerobotics.com>", preview: "Hi Dana, great to connect. Recap plus the 3 match cards, and a Calendly link for the pilot kickoff." },
  { kind: "scheduled", tag: "Scheduled", icon: "schedule", subject: "Post-demo summary · Globex", meta: "5:00 PM", to: "Globex demo attendees", preview: "Post-demo summary with pricing tiers — held for your approval above before it leaves the outbox." },
  { kind: "draft", tag: "Draft", icon: "edit", subject: "Follow-up · Initech", meta: "blocked on SOC 2", to: "Marcus Lee <marcus@initech.com>", preview: "Follow-up to Marcus; waiting on the compliance answer before this is safe to send." },
];

// ---- shared style tokens (mirrors the mockup's .sec / .sech / tags) ----
const sec: CSSProperties = { padding: "20px 22px" };
const sech: CSSProperties = { display: "flex", alignItems: "center", gap: 9, marginBottom: 14 };
const h4: CSSProperties = { fontSize: 15, fontWeight: 800, margin: 0, letterSpacing: "-.02em" };
const spacer: CSSProperties = { flex: 1 };
const tagBase: CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6 };
const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };
const tnum: CSSProperties = { fontVariantNumeric: "tabular-nums" };

const secIc = (bg: string, color: string): CSSProperties => ({ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", flex: "none", background: bg, color });
const rowBorder = (i: number): CSSProperties => ({ borderTop: i === 0 ? "none" : "1px solid var(--divider)" });
const msym = (name: string, size: number, extra?: CSSProperties): JSX.Element => (
  <span className="material-symbols-rounded" style={{ fontSize: size, ...extra }}>{name}</span>
);

function SecHeader({ icon, iconBg, iconColor, title, right }: {
  icon: string; iconBg: string; iconColor: string; title: string; right?: JSX.Element;
}): JSX.Element {
  return (
    <div style={sech}>
      <div style={secIc(iconBg, iconColor)}>{msym(icon, 18)}</div>
      <h4 style={h4}>{title}</h4>
      {right ? <><div style={spacer} />{right}</> : null}
    </div>
  );
}

function ExampleFeedPill(): JSX.Element {
  return <span style={{ ...tagBase, background: "var(--decor-soft)", color: "var(--decor-ink)" }}>Example feed</span>;
}

// ============================================================
// KpiStrip — EXAMPLE numbers (Calls today / Meetings booked /
// Follow-ups sent / On-persona %).
// ============================================================
export function KpiStrip(): JSX.Element {
  const kpiLabel: CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink3)" };
  const kpiNum: CSSProperties = { ...tnum, fontSize: 30, fontWeight: 800, marginTop: 9, letterSpacing: "-.03em" };
  const kpiDetail: CSSProperties = { fontSize: 11.5, color: "var(--ink2)", marginTop: 3 };
  const items: { label: string; value: string; detail: string; color?: string }[] = [
    { label: "Calls today", value: "6", detail: "2 live · 4 completed" },
    { label: "Meetings booked", value: "3", detail: "from today's calls" },
    { label: "Follow-ups sent", value: "12", detail: "9 auto · 3 you approved" },
    { label: "On-persona", value: "100%", detail: "0 honesty flags", color: "var(--success-ink)" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginBottom: 20 }}>
      {items.map((k) => (
        <div key={k.label} className="card kpi">
          <div style={kpiLabel}>{k.label}</div>
          <div style={{ ...kpiNum, ...(k.color ? { color: k.color } : {}) }}>{k.value}</div>
          <div style={kpiDetail}>{k.detail}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// TodayCard — EXAMPLE agenda feed.
// ============================================================
const RTAG: Record<AgendaRow["kind"], CSSProperties> = {
  done: { background: "var(--ghost)", color: "var(--ink3)" },
  next: { background: "var(--accent-soft)", color: "var(--accent)" },
  upcoming: { background: "var(--sunk)", color: "var(--ink2)" },
};
export function TodayCard(): JSX.Element {
  const rtag: CSSProperties = { fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: 9999, flex: "none" };
  return (
    <div className="card" style={sec}>
      <SecHeader icon="today" iconBg="var(--accent-soft)" iconColor="var(--accent)" title="Today" right={<ExampleFeedPill />} />
      {EXAMPLE_AGENDA.map((a, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 0", ...rowBorder(i) }}>
          <div style={{ ...tnum, fontSize: 12, fontWeight: 800, color: "var(--ink2)", width: 56, flex: "none", textAlign: "right" }}>
            {a.time}<span style={{ display: "block", fontSize: 9.5, color: "var(--ink3)", fontWeight: 700 }}>{a.ampm}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{a.title}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 1 }}>{a.who}</div>
          </div>
          <span style={{ ...rtag, ...RTAG[a.kind] }}>{a.tag}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// EmailCard — EXAMPLE email & follow-ups feed.
// ============================================================
const FTAG: Record<EmailRow["kind"], CSSProperties> = {
  sent: { background: "var(--success-soft)", color: "var(--success-ink)" },
  scheduled: { background: "var(--warning-soft)", color: "var(--warning-ink)" },
  draft: { background: "var(--ghost)", color: "var(--ink3)" },
};
const FTAG_LABEL: Record<EmailRow["kind"], string> = { sent: "Sent", scheduled: "Scheduled", draft: "Draft" };
export function EmailCard(): JSX.Element {
  const ftag: CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, flex: "none" };
  return (
    <div className="card" style={sec}>
      <SecHeader icon="mail" iconBg="var(--decor-soft)" iconColor="var(--decor-ink)" title="Email & follow-ups" right={<ExampleFeedPill />} />
      {EXAMPLE_EMAILS.map((e, i) => (
        <div key={i} style={{ padding: "11px 0", ...rowBorder(i) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--ink2)", fontWeight: 700 }}>
            <span style={{ ...ftag, ...FTAG[e.kind] }}>{FTAG_LABEL[e.kind]}</span>
            <b style={{ color: "var(--ink1)" }}>{e.subject}</b>
            <span>· {e.meta}</span>
          </div>
          <div style={{ fontSize: 13, marginTop: 5, lineHeight: 1.45, color: "var(--ink1)" }}>{e.preview}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// SlackCard — EXAMPLE Slack posts feed.
// ============================================================
export function SlackCard(): JSX.Element {
  return (
    <div className="card" style={sec}>
      <SecHeader icon="forum" iconBg="var(--purple-soft)" iconColor="var(--purple-ink)" title="Slack posts" right={<ExampleFeedPill />} />
      {EXAMPLE_SLACK.map((s, i) => (
        <div key={i} style={{ padding: "11px 0", ...rowBorder(i) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--ink2)", fontWeight: 700 }}>
            <b style={{ color: "var(--ink1)" }}>{s.channel}</b>
            <span>· {s.time}</span>
          </div>
          <div style={{ fontSize: 13, marginTop: 5, lineHeight: 1.45, color: "var(--ink1)" }}>{s.text}</div>
          {s.mention ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 9999, background: "var(--decor-soft)", color: "var(--decor-ink)", marginTop: 7 }}>
              {msym("alternate_email", 13)}{s.mention}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// GoalsCard — REAL. Self-fetches goals + the live gate count,
// persists with optimistic update + rollback.
// ============================================================
export function GoalsCard({ agentId }: { agentId: string }): JSX.Element {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [gatesPassed, setGatesPassed] = useState(0);
  const [gatesTotal, setGatesTotal] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newObjective, setNewObjective] = useState("");
  const [newKind, setNewKind] = useState<Goal["kind"]>("manual");
  const [hoverGoal, setHoverGoal] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const [gl, gt] = await Promise.all([
        api.get<{ goals: Goal[] }>(`/api/clones/${agentId}/goals`).catch(() => null),
        api.get<{ passed: number; total: number }>(`/api/clones/${agentId}/gates`).catch(() => null),
      ]);
      if (!alive) return;
      if (gl) setGoals(gl.goals);
      else setError("Could not load goals");
      if (gt) {
        setGatesPassed(gt.passed ?? 0);
        setGatesTotal(gt.total ?? 7);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [agentId]);

  const gatesDone = gatesTotal > 0 && gatesPassed >= gatesTotal;

  async function persistGoals(next: Goal[]): Promise<void> {
    const prev = goals;
    setGoals(next);
    setError(null);
    setSaving(true);
    try {
      const r = await api.put<{ ok: boolean; goals: Goal[] }>(`/api/clones/${agentId}/goals`, { goals: next });
      setGoals(r.goals);
    } catch (e) {
      setGoals(prev);
      setError(`Save failed, change rolled back${e instanceof Error ? ` · ${e.message}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  function addGoal(): void {
    const objective = newObjective.trim();
    if (!objective || saving) return;
    setNewObjective("");
    void persistGoals([...goals, { id: newGoalId(), objective, kind: newKind, createdAt: new Date().toISOString() }]);
  }

  const field: CSSProperties = { flex: 1, minWidth: 0, height: 40, padding: "0 13px", borderRadius: 11, border: "2px solid var(--border)", background: "var(--card)", color: "var(--ink1)", fontSize: 12.5, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };
  const ckBox = (isDone: boolean): CSSProperties => ({ width: 22, height: 22, borderRadius: 7, flex: "none", display: "grid", placeItems: "center", padding: 0, border: "none", background: isDone ? "var(--success-soft)" : "var(--ghost)", color: isDone ? "var(--success-ink)" : "var(--ink3)" });

  const savingPill = saving
    ? <span style={{ ...tagBase, letterSpacing: 0, textTransform: "none", background: "var(--ghost)", color: "var(--ink3)" }}>Saving…</span>
    : <span style={{ ...tagBase, background: "var(--success-soft)", color: "var(--success-ink)" }}>Live</span>;

  return (
    <div className="card" style={sec}>
      <SecHeader icon="task_alt" iconBg="var(--success-soft)" iconColor="var(--success-ink)" title="Goals" right={savingPill} />

      {error ? (
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "var(--warning-ink)", background: "var(--warning-soft)", borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>
          {msym("error", 16)}{error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ fontSize: 12.5, color: "var(--ink3)", padding: "8px 0 4px" }}>Loading goals…</div>
      ) : error ? null : goals.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--ink3)", background: "var(--sunk)", borderRadius: 12, padding: "16px", textAlign: "center", marginBottom: 12 }}>
          No goals yet. Set what great looks like below.
        </div>
      ) : (
        goals.map((g, i) => {
          const done = g.kind === "gates" ? gatesDone : !!g.done;
          const meta = g.kind === "gates"
            ? "Quality checks"
            : `Manual${g.target ? ` · target ${g.target}` : ""}`;
          return (
            <div key={g.id}
              onMouseEnter={() => setHoverGoal(g.id)}
              onMouseLeave={() => setHoverGoal((h) => (h === g.id ? null : h))}
              style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", ...rowBorder(i) }}>
              {g.kind === "manual" ? (
                <button
                  onClick={() => void persistGoals(goals.map((x) => (x.id === g.id ? { ...x, done: !x.done } : x)))}
                  disabled={saving}
                  aria-label={done ? "Mark open" : "Mark done"}
                  title={done ? "Mark open" : "Mark done"}
                  style={{ ...ckBox(done), ...btnFont }}>
                  {done ? msym("check", 15) : null}
                </button>
              ) : (
                <div style={ckBox(done)}>{done ? msym("check", 15) : null}</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, textDecoration: done ? "line-through" : "none", color: done ? "var(--ink3)" : "var(--ink1)" }}>{g.objective}</div>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 1 }}>
                  {meta}{g.createdAt ? ` · added ${relDate(g.createdAt)}` : ""}
                </div>
              </div>
              {g.kind === "gates" ? (
                <span style={{ ...tnum, fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 9999, background: "var(--purple-soft)", color: "var(--purple-ink)", flex: "none" }}>
                  {gatesPassed} / {gatesTotal}
                </span>
              ) : null}
              <button
                onClick={() => void persistGoals(goals.filter((x) => x.id !== g.id))}
                disabled={saving}
                aria-label="Delete goal" title="Delete goal"
                style={{ width: 24, height: 24, flex: "none", borderRadius: "50%", border: "none", background: "transparent", color: "var(--ink3)", display: "grid", placeItems: "center", opacity: hoverGoal === g.id ? 1 : 0, transition: "opacity .12s", ...btnFont }}>
                {msym("close", 16)}
              </button>
            </div>
          );
        })
      )}

      {/* add row — stacked so the narrow right column never crushes the input:
          full-width field on top, then the kind toggle + Add beneath it. */}
      {!loading && !error ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: goals.length > 0 ? 14 : 0 }}>
          <input
            value={newObjective}
            onChange={(e) => setNewObjective(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addGoal(); }}
            placeholder="Add a goal — e.g. book 3 qualified demos a day"
            style={{ ...field, flex: "none", width: "100%" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ display: "flex", flex: "none", gap: 4, padding: 3, borderRadius: 9999, background: "var(--sunk)" }}>
              {(["manual", "gates"] as const).map((k) => (
                <button key={k} onClick={() => setNewKind(k)}
                  style={{ height: 32, padding: "0 12px", borderRadius: 9999, border: "none", background: newKind === k ? "var(--card)" : "transparent", color: newKind === k ? "var(--ink1)" : "var(--ink3)", boxShadow: newKind === k ? "var(--shadow)" : "none", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", ...btnFont }}>
                  {k === "manual" ? "Manual" : "Quality checks"}
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={addGoal} disabled={!newObjective.trim() || saving}
              style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 16px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 700, opacity: !newObjective.trim() || saving ? 0.5 : 1, ...btnFont }}>
              {msym("add", 18)}Add
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================
// ConnectedCard — display-only honest holding states.
// ============================================================
export function ConnectedCard({ firstName }: { firstName: string }): JSX.Element {
  const handle = firstName.trim().toLowerCase() || "clone";
  const anm: CSSProperties = { fontSize: 13.5, fontWeight: 700 };
  const ad: CSSProperties = { fontSize: 11.5, color: "var(--ink2)", marginTop: 1 };
  const aic = (color: string): CSSProperties => ({ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", flex: "none", background: "var(--sunk)", color });
  const rows: { icon: string; iconColor: string; name: string; detail: string; on: boolean }[] = [
    { icon: "mail", iconColor: "var(--decor-ink)", name: "Dedicated inbox", detail: `${handle}@goperfect.com`, on: true },
    { icon: "forum", iconColor: "var(--purple-ink)", name: "Slack", detail: `posts as @${handle} · #sales`, on: true },
    { icon: "calendar_month", iconColor: "var(--accent)", name: "Calendar", detail: "books demos for you", on: false },
  ];
  return (
    <div className="card" style={sec}>
      <SecHeader icon="badge" iconBg="var(--purple-soft)" iconColor="var(--purple-ink)" title="Connected accounts" />
      {rows.map((r, i) => (
        <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", ...rowBorder(i) }}>
          <div style={aic(r.iconColor)}>{msym(r.icon, 18)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={anm}>{r.name}</div>
            <div style={ad}>{r.detail}</div>
          </div>
          {r.on ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 800, color: "var(--success-ink)" }}>{msym("check", 15)}On</span>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ink3)" }}>Not wired yet</span>
          )}
        </div>
      ))}
    </div>
  );
}
