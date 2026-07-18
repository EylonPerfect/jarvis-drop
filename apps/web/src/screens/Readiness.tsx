import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { api, getAccessKey } from "../api/client";
import PdsNav from "../components/PdsNav";
import { KpiStrip, TodayCard, EmailCard, SlackCard, GoalsCard, ConnectedCard } from "../components/OperationalHub";
import PaywallModal, { type PaywallVariant } from "../components/PaywallModal";

// ============================================================
// Readiness — the self-serve front door. THREE concepts only:
// the clone (with a lifecycle stage), ONE fused 0-100 score
// with a plain sentence, and an approvals queue of one-click
// human decisions with evidence. Re-skinned to the PDS mockup
// (AGENT HOME): dialcard + spine-mini + approvals + workspaces.
// Only the render output changed — every API call, the act
// dispatch, polling, loading/running states and nav are intact.
//
// LIVE / READY MERGE: when the clone is live (or promotion is
// unlocked) the same hero stays, a KPI strip appears full-width,
// and the split becomes an operational hub — Needs your judgment
// + Today + Email on the left; Scorecard + workspaces + Goals +
// Connected accounts + Slack + activity on the right. Every
// pre-existing readiness section is preserved in BOTH branches;
// the pre-ready view is byte-for-byte the original layout.
// ============================================================

type Agent = { id: string; name: string; role?: string; buildTrack?: string };
type Approval = { id: string; kind: string; title: string; detail: string; evidence: string; action: string; ready: boolean; blocked?: string; mode?: "judgment" | "auto" };
type ReadinessData = {
  agentId: string; name: string; score: number; stage: string; sentence: string;
  approvals: Approval[]; activity: string[]; promoteUnlocked: boolean;
  components: { checks: { done: number; of: number }; match: number | null; resilience: number | null; fidelity: number | null };
};
type PipelineEvent = { t: string; text: string; kind: "info" | "done" | "error" };
type Pipeline = { state: string; stage: string; startedAt?: string; updatedAt?: string; events: PipelineEvent[] };

// stage → pmx `.stage` class, short label, and dial arc colour
const STAGE_META: Record<string, { label: string; cls: string; dial: string }> = {
  "learning": { label: "Learning", cls: "build", dial: "var(--decor)" },
  "rehearsing": { label: "Calibrating", cls: "cal", dial: "var(--purple)" },
  "ready-to-review": { label: "Ready to review", cls: "review", dial: "var(--warning)" },
  "live": { label: "Live", cls: "live", dial: "var(--success)" },
};
// approval kind → pmx `.kind` badge class + label + primary button flavour
const KIND_META: Record<string, { cls: string; label: string; btn: string }> = {
  corrections: { cls: "correct", label: "Correction", btn: "pink" },
  promote: { cls: "promote", label: "Promote", btn: "pink" },
  coach: { cls: "coach", label: "Coaching", btn: "" },
  measure: { cls: "promote", label: "Measure", btn: "green" },
};
// lifecycle spine — mark done/here from the real stage
const SPINE = ["Ingest", "Build", "Calibrate", "Certify", "Run", "Learn"];
const HERE: Record<string, number> = { "learning": 1, "rehearsing": 2, "ready-to-review": 3, "live": 4 };

const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

const initials = (n: string): string =>
  n.split(" ").map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "AI";

function Check(): ReactElement {
  return <svg className="i sm" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>;
}

export default function Readiness() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actBusy, setActBusy] = useState<string | null>(null);
  const [actNote, setActNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Go-live paywall: opened when the promote/go-live action is blocked by the
  // billing gate with code "payment_required" (clone passed 70, org unpaid).
  const [paywall, setPaywall] = useState<{ variant: PaywallVariant; cloneName?: string; reason?: string } | null>(null);

  const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));

  useEffect(() => {
    void (async () => {
      const list = await api.get<Agent[]>("/api/agents").catch(() => [] as Agent[]);
      setAgents(list);
      const stored = (() => { try { return localStorage.getItem("pds_agent"); } catch { return null; } })();
      setAgentId(list.find((a) => a.id === stored)?.id ?? list[0]?.id ?? "");
    })();
  }, []);

  async function load(id: string) {
    if (!id) { setLoading(false); return; }
    const r = await api.get<ReadinessData>(`/api/readiness/${id}`).catch(() => null);
    if (r) setData(r);
    setLoading(false);
  }
  useEffect(() => {
    if (!agentId) return;
    try { localStorage.setItem("pds_agent", agentId); } catch { /* ignore */ }
    setLoading(true); setData(null); setActNote(null);
    void load(agentId);
  }, [agentId]);

  // pipeline narrative — polls while the orchestrator runs; 404 = not built yet
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!agentId) return;
    const tick = async () => {
      try {
        const k = getAccessKey();
        const res = await fetch(`${api.base}/api/pipeline/${agentId}`, { headers: k ? { "X-API-Key": k } : {} });
        if (!res.ok) { setPipeline(null); return; }
        const j = (await res.json()) as Pipeline & { pipeline?: Pipeline };
        const p = (j.pipeline ?? j) as Pipeline;
        setPipeline(p && p.state ? p : null);
        if (p?.state === "done") void load(agentId); // score refresh when it lands
      } catch { setPipeline(null); }
    };
    void tick();
    pollRef.current = setInterval(() => { void tick(); }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [agentId]);

  async function act(a: Approval) {
    if (actBusy) return;
    if (a.kind === "corrections") { nav("screenmap"); return; }
    setActBusy(a.id); setActNote(null);
    try {
      const res = await fetch(`${api.base}/api/readiness/${agentId}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getAccessKey() ? { "X-API-Key": getAccessKey() } : {}) },
        body: JSON.stringify({ id: a.id }),
      });
      const j = (await res.json().catch(() => ({}))) as { receipt?: string; error?: string; code?: string };
      // Go-live paywall: the clone cleared the 70 gate but the org has no paid
      // plan — open the checkout modal instead of surfacing a raw error.
      if (!res.ok && j.code === "payment_required") {
        setPaywall({ variant: "golive", cloneName: data?.name, reason: j.error });
        setActBusy(null);
        return;
      }
      if (!res.ok) throw new Error(j.error || `action → ${res.status}`);
      setActNote({ ok: true, text: j.receipt || "Done." });
      void load(agentId);
    } catch (e) {
      setActNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    setActBusy(null);
  }

  const agent = agents.find((a) => a.id === agentId) ?? null;
  const stageKey = data?.stage ?? "rehearsing";
  const stageMeta = STAGE_META[stageKey] ?? STAGE_META.rehearsing;
  const dial = useMemo(() => {
    const s = Math.max(0, Math.min(100, data?.score ?? 0));
    const R = 52, C = 2 * Math.PI * R;
    return { R, C, off: C - (C * s) / 100 };
  }, [data?.score]);
  const running = pipeline?.state === "running";
  const startedMin = pipeline?.startedAt ? Math.max(0, Math.round((Date.now() - new Date(pipeline.startedAt).getTime()) / 60000)) : null;
  const hereIndex = HERE[stageKey] ?? 2;

  const first: string = (data ? data.name.split(/\s+/)[0] : agent?.name?.split(/\s+/)[0]) ?? "the clone";
  const readyCount = data ? data.approvals.filter((a) => a.ready && a.mode !== "auto").length : 0; // mode-aware: auto-handled items are not "your judgment"

  // the live/ready gate — the clone is running for real, OR promotion has been
  // unlocked; both signals come straight off the fetched readiness object.
  const liveOrReady = data?.stage === "live" || data?.promoteUnlocked === true;

  // Building ⇄ Live: the agent screen splits into a "get it ready" view
  // (approvals · scorecard · workspaces · history) and an operational "on the
  // job" view (KPIs · today · email · goals · accounts · Slack). Default follows
  // state — live/ready opens in Live — and the toggle lets the operator switch
  // either way. `mode === null` means "follow the default".
  const [mode, setMode] = useState<"building" | "live" | null>(null);
  const effMode: "building" | "live" = mode ?? (liveOrReady ? "live" : "building");
  // agent switcher now lives in the agent header (not the global nav)
  const [switchOpen, setSwitchOpen] = useState(false);

  // workspace deep-links — real app nav targets the shell already dispatches
  const workspaces: { view: string; nm: string; d: string; icon: ReactElement }[] = [
    { view: "rehearsal", nm: "Calibration Room", d: "Spar, rehearse, correct", icon: <svg className="i" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" /></svg> },
    { view: "screenmap", nm: "Storyboard", d: "Edit the call flow", icon: <svg className="i" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg> },
    { view: "precall", nm: "Run a call", d: "Pre-call check, then join", icon: <svg className="i" viewBox="0 0 24 24"><path d="m23 7-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg> },
    { view: "debrief", nm: "Debrief", d: "Review call outcomes", icon: <svg className="i" viewBox="0 0 24 24"><path d="M4 4h16v12H5.2L4 17.5V4z" /><path d="M8 9h8M8 12h5" /></svg> },
  ];

  // ---- reusable readiness sections (shared by pre-ready + merged views) ----
  // Each returns the SECTION CONTENT only; callers wrap them in `.split` columns
  // so the same markup/handlers serve both layouts with zero duplication.

  // "Needs your judgment" — approvals queue (mapping, sort, locked logic, handlers intact)
  const approvalsSection = (d: ReadinessData): ReactElement => (
    <>
      <div className="sec-h">Needs your judgment{readyCount > 0 ? ` · ${readyCount}` : ""}</div>
      {actNote && <div style={{ fontSize: 12.5, fontWeight: 700, color: actNote.ok ? "var(--success-ink)" : "var(--error-ink)", margin: "0 4px 12px" }}>{actNote.text}</div>}

      {d.approvals.length === 0 && (
        <div className="card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--ink2)" }}>
          Nothing right now — {first} keeps improving on his own and this queue fills up when something needs a human.
        </div>
      )}

      {[...d.approvals].sort((a, b) => Number(b.ready) - Number(a.ready)).map((a) => {
        const km = KIND_META[a.kind] ?? KIND_META.coach;
        const busy = actBusy === a.id;
        const eviOpen = openEvidence === a.id;
        const btnClass = `btn sm${km.btn ? ` ${km.btn}` : ""}`;
        const coachStyle: CSSProperties | undefined = a.kind === "coach" ? { borderColor: "var(--decor)", color: "var(--decor)" } : undefined;
        return (
          <div key={a.id} className="card approval" style={a.ready ? undefined : { opacity: 0.62 }}>
            <div className="top">
              <span className={`kind ${km.cls}`}>{km.label}</span>
              {a.ready && a.kind === "corrections" && (
                <span className="stage" style={{ background: "var(--sunk)", color: "var(--ink2)" }}>needs a fix</span>
              )}
            </div>
            <h4>{a.title}</h4>
            <p>{a.detail}</p>

            {a.ready ? (
              <>
                <div className="row">
                  {a.kind === "promote" ? (
                    <span className="locknote">
                      <svg className="i sm" viewBox="0 0 24 24"><path d="M7 11V7a5 5 0 0 1 10 0v4" /><rect x="3" y="11" width="18" height="11" rx="2" /></svg>
                      Always your call, never automatic
                    </span>
                  ) : (
                    <span className="evi" onClick={() => setOpenEvidence(eviOpen ? null : a.id)}>{eviOpen ? "Hide evidence" : "See the evidence"}</span>
                  )}
                  <span className="spacer" />
                  <button className={btnClass} style={{ ...btnFont, ...coachStyle, opacity: actBusy && !busy ? 0.5 : 1 }} onClick={() => void act(a)} disabled={!!actBusy}>
                    {busy ? (a.kind === "promote" ? "Running the checks…" : "Working…") : a.action}
                  </button>
                </div>
                {a.kind !== "promote" && eviOpen && (
                  <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 10, padding: "8px 11px", background: "var(--sunk)", borderRadius: 10 }}>{a.evidence}</div>
                )}
              </>
            ) : (
              <div className="row">
                <span className="locknote">
                  <svg className="i sm" viewBox="0 0 24 24"><path d="M7 11V7a5 5 0 0 1 10 0v4" /><rect x="3" y="11" width="18" height="11" rx="2" /></svg>
                  {a.blocked || "Not available yet"}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  // "Open a workspace" — deep-link tiles (unchanged nav targets)
  const workspacesSection = (): ReactElement => (
    <>
      <div className="sec-h">Open a workspace</div>
      <div className="workspaces">
        {workspaces.map((w) => (
          <div key={w.view} className="card ws" onClick={() => nav(w.view)}>
            <div className="ic">{w.icon}</div>
            <div><div className="nm">{w.nm}</div><div className="d">{w.d}</div></div>
          </div>
        ))}
      </div>
    </>
  );

  // Scorecard — the real fused components behind the dial
  const scorecardSection = (d: ReadinessData): ReactElement => (
    <div className="card" style={{ padding: "16px 18px", marginTop: 12 }}>
      <div className="th" style={{ marginBottom: 10 }}>Scorecard</div>
      <div className="spot" style={{ padding: 0 }}>
        <div className="stat"><span className="mut">Quality checks</span><b>{d.components.checks.done}/{d.components.checks.of}</b></div>
        {d.components.match !== null && <div className="stat"><span className="mut">Sounds like the real rep</span><b>{d.components.match}%</b></div>}
        {d.components.resilience !== null && <div className="stat"><span className="mut">Holds up under pressure</span><b>{d.components.resilience}%</b></div>}
        {d.components.fidelity !== null && <div className="stat" style={{ borderBottom: 0 }}><span className="mut">Rehearsal match</span><b>{d.components.fidelity}%</b></div>}
      </div>
    </div>
  );

  // "What happened lately" — recent activity (null when there's nothing)
  const activitySection = (d: ReadinessData): ReactElement | null => {
    if (d.activity.length === 0) return null;
    return (
      <>
        <div className="sec-h">What happened lately</div>
        <div className="card" style={{ padding: "12px 20px" }}>
          {d.activity.map((l, i) => <div key={i} style={{ fontSize: 13, color: "var(--ink2)", padding: "5px 0" }}>{l}</div>)}
        </div>
      </>
    );
  };

  return (
    <div className="pmx" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)", color: "var(--ink1)" }}>
      {paywall && (
        <PaywallModal
          variant={paywall.variant}
          cloneName={paywall.cloneName}
          reason={paywall.reason}
          onClose={() => setPaywall(null)}
        />
      )}
      <PdsNav
        active="readiness"
        theme={theme}
        onTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      />

      <div className="app">
        {loading && <div style={{ padding: 40, textAlign: "center", color: "var(--ink3)", fontSize: 13 }}>Checking where {first} stands…</div>}

        {!loading && data && (
          <>
            {/* header: who this clone is — shared by both views */}
            <div className="page-h" style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 15, background: "linear-gradient(140deg,#A342FF,#FF0660)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 19 }}>{initials(data.name)}</div>
              <div>
                <h1>{data.name}</h1>
                <p style={{ marginTop: 2 }}>{agent?.role ? `${agent.role} clone` : "Sales clone"}, mirrored from a top performer.</p>
              </div>
              {agents.length > 1 && (
                <div style={{ marginLeft: "auto", position: "relative" }}>
                  <button onClick={() => setSwitchOpen((o) => !o)} title="Switch to another agent" style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 38, padding: "0 15px", borderRadius: 9999, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink1)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 17 }}>swap_horiz</span>Switch agent
                    <span className="material-symbols-rounded" style={{ fontSize: 16 }}>expand_more</span>
                  </button>
                  {switchOpen && (
                    <>
                      <div onClick={() => setSwitchOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                      <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, minWidth: 230, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg)", padding: 5, maxHeight: 340, overflowY: "auto" }}>
                        {agents.map((a) => (
                          <button key={a.id} onClick={() => { setAgentId(a.id); setSwitchOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 11px", borderRadius: 9, border: "none", background: a.id === agentId ? "var(--ghost)" : "transparent", color: "var(--ink1)", fontSize: 13, fontWeight: a.id === agentId ? 800 : 600, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                            {a.id === agentId ? <span className="material-symbols-rounded" style={{ fontSize: 15, color: "var(--success-ink)" }}>check</span> : <span style={{ width: 15 }} />}
                            <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}{a.role ? ` — ${a.role}` : ""}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* score dial + plain sentence — shared hero */}
            <div className="card dialcard">
              <div className="dial">
                <svg viewBox="0 0 120 120" style={{ width: 132, height: 132, transform: "rotate(-90deg)" }}>
                  <circle cx="60" cy="60" r={dial.R} fill="none" stroke="var(--track)" strokeWidth="10" />
                  <circle cx="60" cy="60" r={dial.R} fill="none" stroke={stageMeta.dial} strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={dial.C} strokeDashoffset={dial.off} style={{ transition: "stroke-dashoffset .6s ease" }} />
                </svg>
                <div className="val"><b style={{ gridArea: "1 / 1", alignSelf: "center" }}>{data.score}</b><span style={{ gridArea: "1 / 1", alignSelf: "end", marginTop: 0, marginBottom: 26 }}>{stageMeta.label}</span></div>
              </div>
              <div className="say">
                <span className={`stage ${stageMeta.cls}`} style={{ marginBottom: 10 }}><span className="dot" />{stageMeta.label}</span>
                <h3>{data.sentence}</h3>
                <p>
                  {readyCount > 0
                    ? stageKey === "live"
                      ? `${readyCount} ${readyCount === 1 ? "thing is" : "things are"} waiting on your judgment below.`
                      : `${readyCount} ${readyCount === 1 ? "thing needs" : "things need"} your judgment before ${first} can go live.`
                    : stageKey === "live"
                      ? `Nothing needs your judgment right now, ${first} keeps improving on its own.`
                      : `Your next step: open the Calibration Room and start calibrating ${first}, or wait for the automatic setup to finish.`}
                </p>
                {stageKey !== "live" && (
                  <button onClick={() => nav("rehearsal")} style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 18px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 18 }}>tune</span>Open the Calibration Room
                  </button>
                )}
                {/* lifecycle spine lives inside the hero so the card reads as one unit */}
                <div className="spine-mini" style={{ marginTop: 20 }}>
                  {SPINE.map((label, i) => {
                    const done = i < hereIndex;
                    const here = i === hereIndex;
                    const nodeCls = `sm-node${done ? " done" : here ? " here" : ""}`;
                    return (
                      <div key={label} style={{ display: "contents" }}>
                        <div className={nodeCls}>
                          <div className="c">{done ? <Check /> : here ? "●" : i + 1}</div>
                          <div className="t">{label}</div>
                        </div>
                        {i < SPINE.length - 1 && <div className={`sm-bar${i < hereIndex - 1 ? " done" : ""}`} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Building ⇄ Live — split the "get it ready" blocks from the "on the job" blocks */}
            <div className="modeseg" style={{ marginTop: 14 }}>
              <button className={effMode === "building" ? "on" : undefined} onClick={() => setMode("building")}>
                <span className="material-symbols-rounded" style={{ fontSize: 17 }}>construction</span>Building
              </button>
              <button className={effMode === "live" ? "on livemode" : undefined} onClick={() => setMode("live")}>
                <span className="material-symbols-rounded" style={{ fontSize: 17 }}>rocket_launch</span>Live
              </button>
            </div>

            {/* pipeline narrative while the machine works — shared */}
            {pipeline && (running || pipeline.state === "error") && (
              <div className="card" style={{ padding: "16px 22px", marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>
                  {running
                    ? <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--decor)", borderTopColor: "transparent", animation: "rdSpin .9s linear infinite", display: "inline-block" }} />
                    : <span style={{ color: "var(--error-ink)" }}>⚠</span>}
                  {running ? "Working on it — you can leave this page" : "The automatic run hit a snag — the story below says where"}
                </div>
                {running && (
                  <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 8, lineHeight: 1.5 }}>
                    Setting up {first} usually takes about 30 to 45 minutes.{startedMin !== null ? ` Started ${startedMin} minute${startedMin === 1 ? "" : "s"} ago.` : ""} You can close this and come back.
                  </div>
                )}
                {(pipeline.events ?? []).slice(-6).map((e, i) => (
                  <div key={i} style={{ fontSize: 12, color: e.kind === "error" ? "var(--error-ink)" : e.kind === "done" ? "var(--success-ink)" : "var(--ink2)", padding: "2px 0" }}>
                    {e.text}
                  </div>
                ))}
                <style>{`@keyframes rdSpin { to { transform: rotate(360deg) } }`}</style>
              </div>
            )}

            {effMode === "live" ? (
              // ---- LIVE mode — the operational hub (the clone on the job) ----
              <>
                {/* KPI strip — full width, above the split */}
                <KpiStrip />

                <div className="split" style={{ marginTop: 8 }}>
                  {/* LEFT: what it's doing today */}
                  <div>
                    <TodayCard />
                    <EmailCard />
                  </div>

                  {/* RIGHT: goals + connected accounts + Slack */}
                  <div>
                    <GoalsCard agentId={agentId} />
                    <ConnectedCard firstName={first} />
                    <SlackCard />
                  </div>
                </div>
              </>
            ) : (
              // ---- BUILDING mode — get the clone ready ----
              <>
                {/* split: what needs you + status/controls */}
                <div className="split" style={{ marginTop: 8 }}>
                  <div>{approvalsSection(data)}</div>
                  <div>
                    {scorecardSection(data)}
                    {workspacesSection()}
                  </div>
                </div>

                {/* recent activity */}
                {activitySection(data)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
