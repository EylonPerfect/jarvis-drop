import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../api/client";
import "../pds.css";

// ============================================================
// Agent workspace — Perfect Design System 2026 v2
// (from Agent Workspace.dc.html). The certified clone on the
// clock: its own connected accounts, the day's calls, Slack
// posts and email follow-ups.
// REAL: agent identity from GET /api/agents (pds_agent aware),
// the certification state from GET /api/clones/:id/versions
// (golden pinned), and GOALS from GET/PUT /api/clones/:id/goals
// (optimistic updates, rollback on failure). Gate-kind goals show
// a live "n of 7 gates" chip derived from the same cheap data the
// certification screen uses (sources/persona/playbook/golden/voice
// pass; verify + red team stay open here — no slow verify calls).
// There is no clone email, Slack or calendar
// backend yet, so the account cards are honest holding states
// and the day / Slack / email feeds are clearly labeled
// examples. Join goes to the real pre-call gate; AI core goes
// to model settings.
// ============================================================

type PersonaVoice = { elevenlabs_voice_id?: string };
type Persona = { identity?: unknown; voice?: PersonaVoice };
type Agent = {
  id: string; name: string; role?: string; icon?: string; status?: string;
  buildTrack?: string; persona?: Persona; golden_persona_id?: string; voice_id?: string;
};
type VersionRow = { id: string; number: number };
type PlaybookStage = { id: string; name: string };
type Goal = { id: string; objective: string; kind: "manual" | "gates"; target?: string; done?: boolean; createdAt: string };

type AgendaRow = { time: string; ampm: string; title: string; who: string; kind: "done" | "next" | "upcoming"; tag: string };
type SlackPost = { channel: string; time: string; text: string; mention?: string };
type EmailRow = { kind: "sent" | "scheduled" | "draft"; tag: string; icon: string; subject: string; meta: string; to: string; preview: string };

const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
const initials = (n: string) => n.split(/\s+/).map((w) => w.charAt(0)).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;
const newGoalId = () => `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const relDate = (iso: string) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
};

const card: CSSProperties = { background: "var(--card)", borderRadius: 20, boxShadow: "var(--shadow)", padding: 22 };
const pill: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 9999 };
const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

// Example content shown until the workspace backends (email, Slack,
// calendar) exist. Every block rendering these carries an Example pill.
const EXAMPLE_AGENDA: AgendaRow[] = [
  { time: "9:00", ampm: "AM", title: "QBR · Northwind Talent", who: "Dana Klein · +2 guests", kind: "done", tag: "Done" },
  { time: "11:30", ampm: "AM", title: "Discovery · Brightpath Recruiting", who: "Alex Rivera", kind: "next", tag: "Next · 8 min" },
  { time: "1:00", ampm: "PM", title: "Renewal · Apex Staffing", who: "Dana Klein", kind: "upcoming", tag: "Upcoming" },
  { time: "3:30", ampm: "PM", title: "Check-in · Meridian Hiring", who: "Sam Osei · +1", kind: "upcoming", tag: "Upcoming" },
];
const EXAMPLE_SLACK: SlackPost[] = [
  { channel: "#northwind-account", time: "9:52 AM", text: "Wrapped the QBR with Dana. She wants a decision by end of quarter and flagged engineering roles as the priority. Full summary and next steps in the thread." },
  { channel: "#deals", time: "9:54 AM", text: "Northwind is looking at 20 more seats. Can you prep expansion pricing before Thursday so I can send it in the follow-up?", mention: "james (AE)" },
  { channel: "#cs-team", time: "8:00 AM", text: "Standup: 4 calls today, 1 renewal at risk (Apex). Will flag a human if Apex pushes on price." },
];
const EXAMPLE_EMAILS: EmailRow[] = [
  { kind: "sent", tag: "Sent", icon: "check", subject: "Recap and next steps · Northwind QBR", meta: "sent 9:58 AM", to: "Dana Klein <dana@northwindtalent.com>", preview: "Hi Dana, great to reconnect. To recap: we agreed engineering roles are the priority, and I will send expansion pricing for 20 seats by Thursday. Recording and notes attached." },
  { kind: "scheduled", tag: "Scheduled", icon: "schedule", subject: "Following up on the engineering pipeline", meta: "sends in 3 days", to: "Dana Klein <dana@northwindtalent.com>", preview: "Hi Dana, checking in as promised. Here is how the engineering pipeline scored this week, and two candidates I think are worth a look before your next sprint." },
  { kind: "draft", tag: "Draft · needs review", icon: "edit", subject: "Expansion pricing for 20 seats", meta: "waiting on James", to: "Dana Klein <dana@northwindtalent.com>", preview: "Hi Dana, as promised, here is pricing for the additional 20 seats along with the cost-per-hire impact at your volume. Happy to walk through it on a quick call." },
];

const EMAIL_TAG: Record<EmailRow["kind"], { bg: string; color: string }> = {
  sent: { bg: "var(--success-soft)", color: "var(--success-ink)" },
  scheduled: { bg: "var(--warning-soft)", color: "var(--warning-ink)" },
  draft: { bg: "var(--purple-soft)", color: "var(--purple-ink)" },
};

function ExamplePill() {
  return (
    <span style={{ ...pill, background: "var(--purple-soft)", color: "var(--purple-ink)" }}>
      <span className="material-symbols-rounded" style={{ fontSize: 13 }}>experiment</span>Example
    </span>
  );
}

export default function AgentWorkspace() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [goldenPinned, setGoldenPinned] = useState(false);
  const [goldenNumber, setGoldenNumber] = useState<number | null>(null);
  const [verifyPass, setVerifyPass] = useState(false);
  const [redteamPass, setRedteamPass] = useState(false);
  const [sourceCount, setSourceCount] = useState(0);
  const [stageCount, setStageCount] = useState(0);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(true);
  const [goalsError, setGoalsError] = useState<string | null>(null);
  const [savingGoals, setSavingGoals] = useState(false);
  const [newObjective, setNewObjective] = useState("");
  const [newKind, setNewKind] = useState<Goal["kind"]>("manual");
  const [hoverGoal, setHoverGoal] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const list = await api.get<Agent[]>("/api/agents").catch(() => [] as Agent[]);
      const stored = localStorage.getItem("pds_agent");
      const a = list.find((x) => x.id === stored) ?? list[0] ?? null;
      setAgent(a);
      if (a) {
        localStorage.setItem("pds_agent", a.id);
        const [ver, src, pb, gl] = await Promise.all([
          api.get<{ versions: VersionRow[]; goldenVersionId: string | null; verifyLatest?: { average: number } | null }>(`/api/clones/${a.id}/versions`).catch(() => null),
          api.get<{ sources: { id: string }[] }>(`/api/clones/${a.id}/sources`).catch(() => ({ sources: [] as { id: string }[] })),
          api.get<{ playbook: { stages: PlaybookStage[] } }>(`/api/clones/${a.id}/playbook`).catch(() => ({ playbook: { stages: [] as PlaybookStage[] } })),
          api.get<{ goals: Goal[] }>(`/api/clones/${a.id}/goals`).catch(() => null),
        ]);
        const gid = ver?.goldenVersionId ?? a.golden_persona_id ?? null;
        setGoldenPinned(!!gid);
        setGoldenNumber(gid ? ver?.versions.find((v) => v.id === gid)?.number ?? null : null);
        setVerifyPass((ver?.verifyLatest?.average ?? 0) >= 0.7);
        setRedteamPass((((ver as unknown as { redteamLatest?: { average: number } | null })?.redteamLatest?.average) ?? 0) >= 0.7);
        setSourceCount(src.sources.length);
        setStageCount(pb.playbook?.stages?.length ?? 0);
        if (gl) setGoals(gl.goals);
        else setGoalsError("Could not load goals");
      }
      setGoalsLoading(false);
      setLoading(false);
    })();
  }, []);

  // Same cheap gate derivation as the certification screen: 7 gates,
  // 5 knowable from cheap data (sources, persona, playbook, golden,
  // voice). Verify and red team stay open here — no slow verify runs.
  const hasPersona = !!agent?.persona?.identity;
  const voiceReady = !!(agent?.voice_id || agent?.persona?.voice?.elevenlabs_voice_id);
  const gatesPassed = [sourceCount > 0, hasPersona, stageCount > 0, goldenPinned, voiceReady, verifyPass, redteamPass].filter(Boolean).length;
  const GATES_TOTAL = 7;

  async function persistGoals(next: Goal[]) {
    if (!agent) return;
    const prev = goals;
    setGoals(next);
    setGoalsError(null);
    setSavingGoals(true);
    try {
      const r = await api.put<{ ok: boolean; goals: Goal[] }>(`/api/clones/${agent.id}/goals`, { goals: next });
      setGoals(r.goals);
    } catch (e) {
      setGoals(prev);
      setGoalsError(`Save failed, change rolled back · ${e instanceof Error ? e.message : String(e)}`);
    }
    setSavingGoals(false);
  }

  function addGoal() {
    const objective = newObjective.trim();
    if (!objective || savingGoals) return;
    setNewObjective("");
    void persistGoals([...goals, { id: newGoalId(), objective, kind: newKind, createdAt: new Date().toISOString() }]);
  }

  const themeIcon = theme === "dark" ? "light_mode" : "dark_mode";
  const sourceGrad = theme === "dark"
    ? "radial-gradient(circle at 30% 30%, rgba(255,6,96,.4), rgba(163,66,255,.35))"
    : "radial-gradient(circle at 30% 30%, #FFE0EB, #F1E3FF)";
  const inputBg = theme === "dark" ? "rgba(255,255,255,.05)" : "#FFFFFF";
  const decorSoft = theme === "dark" ? "rgba(0,187,255,.18)" : "#D6F3FF";
  const field: CSSProperties = { width: "100%", height: 40, padding: "0 13px", borderRadius: 11, border: "2px solid var(--border)", background: inputBg, color: "var(--ink1)", fontSize: 12.5, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };

  const first = agent ? firstName(agent.name) : "The clone";
  const holdPill = <span style={{ ...pill, marginLeft: "auto", background: "var(--warning-soft)", color: "var(--warning-ink)" }}>Not wired yet</span>;

  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)" }}>
      {/* header */}
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--nav-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--border)", padding: "12px 24px", display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => nav("agentshome")} style={{ width: 36, height: 36, borderRadius: 10, border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }} aria-label="Back">
          <span className="material-symbols-rounded" style={{ fontSize: 22 }}>arrow_back</span>
        </button>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: sourceGrad, color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>{agent ? initials(agent.name) : "—"}</div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{agent ? agent.name : loading ? "Finding the clone…" : "No clone yet"}</div>
            {loading ? (
              <span style={{ ...pill, background: "var(--ghost)", color: "var(--ink3)" }}>Checking…</span>
            ) : goldenPinned ? (
              <span style={{ ...pill, background: "var(--success-soft)", color: "var(--success-ink)" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}>verified</span>
                Cleared for live · live version {goldenNumber != null ? `v${goldenNumber}` : "pinned"}
              </span>
            ) : (
              <button onClick={() => nav("certification")} style={{ ...pill, background: "var(--warning-soft)", color: "var(--warning-ink)", border: "none", ...btnFont }} title="Open the quality checks">
                <span className="material-symbols-rounded" style={{ fontSize: 13 }}>pending</span>Not cleared yet
              </button>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>{agent ? `${agent.role ? `${agent.role} · ` : ""}dedicated inbox not wired yet` : "create a clone to open its workspace"}</div>
        </div>
        <button onClick={() => nav("modelsettings")} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 15px", borderRadius: 9999, border: "none", background: "var(--ghost)", color: "var(--ink1)", fontSize: 13, fontWeight: 700, ...btnFont }}>
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>neurology</span>AI core
        </button>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }} aria-label="Toggle theme">
          <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{themeIcon}</span>
        </button>
      </header>

      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "26px 24px 60px" }}>
        {!loading && !agent && (
          <div style={{ ...card, textAlign: "center", padding: 40, marginBottom: 32 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No clone to show yet</div>
            <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 16 }}>The workspace fills in once a rep has been cloned.</div>
            <button onClick={() => nav("clonerep")} style={{ height: 40, padding: "0 18px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 700, ...btnFont }}>Clone a rep</button>
          </div>
        )}

        {/* GOALS — real, GET/PUT /api/clones/:id/goals */}
        {agent && (
          <div style={{ ...card, marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--accent)" }}>flag</span>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Goals</div>
              {savingGoals && <span style={{ ...pill, background: "var(--ghost)", color: "var(--ink3)" }}>Saving…</span>}
              <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--ink3)" }}>what great looks like for {first}</span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink3)", marginBottom: 16 }}>Manual goals are checked off by hand. Quality-check goals track the real checks and complete on their own.</div>
            {goalsError && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--error-ink)", background: "var(--error-soft)", borderRadius: 12, padding: "9px 13px", marginBottom: 12 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>error</span>{goalsError}
              </div>
            )}
            {goalsLoading ? (
              <div style={{ fontSize: 12.5, color: "var(--ink3)", padding: "10px 0 16px" }}>Loading goals…</div>
            ) : goals.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ink3)", background: "var(--sunk)", borderRadius: 14, padding: "18px 16px", textAlign: "center", marginBottom: 16 }}>
                No goals yet. Set what great looks like for {first}.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {goals.map((g) => {
                  const gatesDone = gatesPassed === GATES_TOTAL;
                  const done = g.kind === "gates" ? gatesDone : !!g.done;
                  return (
                    <div key={g.id} onMouseEnter={() => setHoverGoal(g.id)} onMouseLeave={() => setHoverGoal((h) => (h === g.id ? null : h))}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, background: "var(--sunk)" }}>
                      {g.kind === "manual" ? (
                        <button onClick={() => void persistGoals(goals.map((x) => (x.id === g.id ? { ...x, done: !x.done } : x)))} disabled={savingGoals}
                          style={{ width: 30, height: 30, flexShrink: 0, borderRadius: "50%", border: "none", background: "transparent", color: done ? "var(--success-ink)" : "var(--ink3)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }}
                          aria-label={done ? "Mark open" : "Mark done"} title={done ? "Mark open" : "Mark done"}>
                          <span className="material-symbols-rounded" style={{ fontSize: 24, fontVariationSettings: done ? "'FILL' 1" : "'FILL' 0" }}>check_circle</span>
                        </button>
                      ) : (
                        <span className="material-symbols-rounded" style={{ width: 30, flexShrink: 0, textAlign: "center", fontSize: 22, color: done ? "var(--success-ink)" : "var(--warning-ink)", fontVariationSettings: done ? "'FILL' 1" : "'FILL' 0" }}>
                          {done ? "verified" : "shield"}
                        </span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, textDecoration: done ? "line-through" : "none", color: done ? "var(--ink3)" : "var(--ink1)" }}>{g.objective}</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 2 }}>
                          {g.kind === "gates" ? "Quality checks" : "Manual"}{g.target ? ` · target ${g.target}` : ""}{g.createdAt ? ` · added ${relDate(g.createdAt)}` : ""}
                        </div>
                      </div>
                      {g.kind === "gates" ? (
                        <span style={{ ...pill, flexShrink: 0, padding: "4px 10px", background: done ? "var(--success-soft)" : "var(--warning-soft)", color: done ? "var(--success-ink)" : "var(--warning-ink)" }} title="Live count from the quality checks · verify and red team count when they pass">
                          <span className="material-symbols-rounded" style={{ fontSize: 13 }}>{done ? "verified" : "progress_activity"}</span>
                          {done ? "Done · all gates green" : `${gatesPassed} of ${GATES_TOTAL} gates`}
                        </span>
                      ) : (
                        <span style={{ ...pill, flexShrink: 0, padding: "4px 10px", background: done ? "var(--success-soft)" : "var(--ghost)", color: done ? "var(--success-ink)" : "var(--ink2)" }}>{done ? "Done" : "Open"}</span>
                      )}
                      <button onClick={() => void persistGoals(goals.filter((x) => x.id !== g.id))} disabled={savingGoals}
                        style={{ width: 26, height: 26, flexShrink: 0, borderRadius: "50%", border: "none", background: "transparent", color: "var(--ink3)", display: "flex", alignItems: "center", justifyContent: "center", opacity: hoverGoal === g.id ? 1 : 0, transition: "opacity .12s", ...btnFont }}
                        aria-label="Delete goal" title="Delete goal">
                        <span className="material-symbols-rounded" style={{ fontSize: 17 }}>close</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* add row */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input value={newObjective} onChange={(e) => setNewObjective(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addGoal(); }}
                placeholder={`e.g. ${first} closes a renewal without a human stepping in`} style={{ ...field, flex: 1, width: "auto" }} />
              <div style={{ display: "flex", flexShrink: 0, gap: 4, padding: 3, borderRadius: 9999, background: "var(--sunk)" }}>
                {(["manual", "gates"] as const).map((k) => (
                  <button key={k} onClick={() => setNewKind(k)}
                    style={{ height: 32, padding: "0 13px", borderRadius: 9999, border: "none", background: newKind === k ? "var(--card)" : "transparent", color: newKind === k ? "var(--ink1)" : "var(--ink3)", boxShadow: newKind === k ? "var(--shadow)" : "none", fontSize: 12, fontWeight: 700, ...btnFont }}>
                    {k === "manual" ? "Manual" : "Quality checks"}
                  </button>
                ))}
              </div>
              <button onClick={addGoal} disabled={!newObjective.trim() || savingGoals}
                style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 18px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 700, opacity: !newObjective.trim() || savingGoals ? 0.5 : 1, ...btnFont }}>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>add</span>Add
              </button>
            </div>
          </div>
        )}

        {/* CONNECTIONS */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Connected accounts</div>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink3)" }}>the clone's own logins · it acts as itself, never as a person</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
          {/* dedicated inbox */}
          <div style={{ ...card, borderRadius: 18, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--accent)" }}>mail</span>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>Dedicated inbox</div>
              {holdPill}
            </div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginBottom: 5 }}>Username</label>
            <input disabled placeholder="assigned when the inbox ships" style={{ ...field, marginBottom: 10, opacity: 0.6 }} />
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginBottom: 5 }}>Password</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="password" disabled placeholder="assigned when the inbox ships" style={{ ...field, flex: 1, width: "auto", opacity: 0.6 }} />
              <button disabled style={{ width: 40, height: 40, borderRadius: 11, border: "2px solid var(--border)", background: "transparent", color: "var(--ink2)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5, fontFamily: "inherit" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>visibility_off</span>
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 10, display: "flex", alignItems: "center", gap: 5 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 14 }}>lock</span>Credentials will be stored encrypted once the email backend ships
            </div>
          </div>
          {/* slack */}
          <div style={{ ...card, borderRadius: 18, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--purple)" }}>forum</span>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>Slack</div>
              {holdPill}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 14 }}>Will post as <b style={{ fontWeight: 700, color: "var(--ink1)" }}>@{first.toLowerCase()}-clone</b> once a workspace is connected.</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginBottom: 8 }}>Channels it can post to</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 9999, background: "var(--ghost)", color: "var(--ink3)" }}>added after connecting</span>
            </div>
          </div>
          {/* calendar */}
          <div style={{ ...card, borderRadius: 18, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--decor)" }}>calendar_month</span>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>Calendar</div>
              {holdPill}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 14 }}>Google Calendar · will read invites where the clone is a guest.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink2)" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 17, color: "var(--ink3)" }}>event_available</span>Auto-joins calls it is invited to
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink2)", marginTop: 7 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 17, color: "var(--ink3)" }}>notifications_active</span>Alerts a director 5 minutes before
            </div>
            <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 10 }}>Planned behavior · not active yet</div>
          </div>
        </div>

        {/* CALENDAR + SLACK */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 18, alignItems: "start", marginBottom: 18 }}>
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--decor)" }}>today</span>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{first}'s day</div>
              <span style={{ marginLeft: "auto" }}><ExamplePill /></span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {EXAMPLE_AGENDA.map((a, i) => {
                const next = a.kind === "next";
                const tagStyle = a.kind === "done"
                  ? { background: "var(--success-soft)", color: "var(--success-ink)" }
                  : next
                    ? { background: "var(--accent)", color: "#fff" }
                    : { background: "var(--sunk)", color: "var(--ink2)" };
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 16, background: next ? "var(--card)" : "var(--sunk)", border: next ? "2px solid var(--accent)" : "none" }}>
                    <div style={{ width: 54, flexShrink: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{a.time}</div>
                      <div style={{ fontSize: 10.5, color: "var(--ink3)" }}>{a.ampm}</div>
                    </div>
                    <div style={{ width: 1, alignSelf: "stretch", background: "var(--divider)" }}></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{a.title}</div>
                      <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>{a.who}</div>
                    </div>
                    <span style={{ ...pill, flexShrink: 0, padding: "4px 10px", ...tagStyle }}>{a.tag}</span>
                    {next && (<>
                      <button onClick={() => nav("rehearsal")} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 14px", borderRadius: 9999, border: "1.5px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 13, fontWeight: 700, ...btnFont }} title="Practice a call in the rehearsal room">
                        <span className="material-symbols-rounded" style={{ fontSize: 18 }}>theater_comedy</span>Rehearse
                      </button>
                      <button onClick={() => nav("precall")} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 16px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 700, ...btnFont }} title="Runs the real pre-call gate">
                        <span className="material-symbols-rounded" style={{ fontSize: 18 }}>videocam</span>Join
                      </button>
                    </>)}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 12 }}>Example day · real calls appear here once the clone's calendar is connected. Join opens the real pre-call gate.</div>
          </div>

          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--purple)" }}>forum</span>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Team updates</div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                <ExamplePill />
                <span style={{ ...pill, fontSize: 11, padding: "4px 10px", color: "var(--purple-ink)", background: "var(--purple-soft)" }}>Slack</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {EXAMPLE_SLACK.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 11 }}>
                  <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 9, background: sourceGrad, color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11 }}>{agent ? initials(agent.name) : "—"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{first} (clone)</span>
                      <span style={{ fontSize: 11, color: "var(--ink3)" }}>{s.channel} · {s.time}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ink1)", lineHeight: 1.5, marginTop: 4 }}>{s.text}</div>
                    {s.mention && (
                      <span style={{ ...pill, background: decorSoft, color: "var(--decor)", marginTop: 7 }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 13 }}>alternate_email</span>{s.mention}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 14 }}>Example posts · the clone starts posting once Slack is connected.</div>
          </div>
        </div>

        {/* EMAIL + FOLLOW-UPS */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--accent)" }}>outgoing_mail</span>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Email and follow-ups</div>
            <span style={{ marginLeft: "auto" }}><ExamplePill /></span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginBottom: 18 }}>Sent after calls and scheduled as follow-ups, with a director able to review before anything leaves the outbox. No email backend is wired yet, so these are examples.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {EXAMPLE_EMAILS.map((e, i) => {
              const t = EMAIL_TAG[e.kind];
              return (
                <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 16, padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ ...pill, padding: "4px 10px", background: t.bg, color: t.color }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 13 }}>{e.icon}</span>{e.tag}
                    </span>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{e.subject}</div>
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--ink3)" }}>{e.meta}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 6 }}>To {e.to}</div>
                  <div style={{ fontSize: 13, color: "var(--ink1)", lineHeight: 1.5 }}>{e.preview}</div>
                  {e.kind === "draft" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                      <button disabled title="Example only · no email backend yet" style={{ height: 38, padding: "0 16px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, opacity: 0.5, cursor: "not-allowed" }}>Approve and send</button>
                      <button disabled title="Example only · no email backend yet" style={{ height: 38, padding: "0 16px", borderRadius: 9999, border: "2px solid var(--border)", background: "transparent", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, opacity: 0.5, cursor: "not-allowed" }}>Edit</button>
                      <span style={{ fontSize: 11, color: "var(--ink3)" }}>example only</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
