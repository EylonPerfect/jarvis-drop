import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../api/client";
import "../pds.css";
import "../pds-mockup.css";
import PdsNav from "../components/PdsNav";
import OnboardingChecklist from "../components/OnboardingChecklist";

// ============================================================
// Agents home (Roster) — re-skinned to the Perfect Design System
// 2026 stage-roster board. Screen root is `.pmx` (the mockup's
// scoped design system) with the shared floating PdsNav on top.
// The .rostergrid renders one .clone card per rep, identical in
// structure for every stage: a .head (avatar + name/role + lifecycle
// .stage pill), a .next box (label "Next action" + the one name-free,
// percent-free next-action line), and a .foot with the fused readiness
// .scoremini ring + one stage-appropriate primary button. Only the
// pill colour, next-action text and primary button change per stage.
// The roster is still wired to GET /api/agents plus cheap per-clone
// lookups (sources + playbook + readiness, which returns the fused
// score, lifecycle stage and the plain nextAction line in one call).
// Verify is never called from here. The ⋯ delete menu is preserved,
// and the Zoom "Test on Zoom" join is kept on the Live stage only.
// ============================================================

type Persona = { identity?: unknown; voice?: { elevenlabs_voice_id?: string } } | null;
type Agent = {
  id: string;
  name: string;
  role?: string;
  icon?: string;
  status?: string;
  buildTrack?: string;
  persona?: Persona;
  golden_persona_id?: string | null;
  voice_id?: string | null;
};
type SourceRow = { id: string; title?: string; kind?: string; chars?: number; created_at?: string };
type PlaybookStage = { id: string; name: string };
// the 7 quality-check gates, read from the server (GET /api/clones/:id/gates)
// instead of recomputed here — one source with the readiness screen
type ServerGate = { key: string; label: string; pass: boolean; score: number | null };
// lifecycle stage from GET /api/readiness/:agentId — the concept's single spine
type ReadinessStage = "learning" | "rehearsing" | "ready-to-review" | "live";
type Readiness = { score: number; stage: ReadinessStage; sentence: string; nextAction?: string; gates: ServerGate[]; components?: { checks?: { done?: number; of?: number } } };
type Progress = { loaded: boolean; sources: number; lastSourceAt: string | null; stages: number; gates: ServerGate[]; passed: number; score: number | null; stage: ReadinessStage | null; sentence: string | null; nextAction: string | null };

const VIEW = {
  echo: "echo",
  clonerep: "clonerep",
  studio: "pdsstudio",
  debrief: "debrief",
  workspace: "workspace",
} as const;

function nav(view: string, agentId?: string): void {
  if (agentId) {
    try { localStorage.setItem("pds_agent", agentId); } catch { /* ignore */ }
  }
  window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
}

// open the Readiness view for a clone — the card's default click target
function openReadiness(agentId: string): void {
  try { localStorage.setItem("pds_agent", agentId); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view: "readiness" } }));
}

// re-enter the clone-a-rep wizard for an EXISTING agent at a given step. The
// wizard consumes clonerep_open one-shot and works for finished clones too, so
// this is how you edit a rep or set its voice after creation (step 4 = Voice).
function openWizard(agentId: string, step: number): void {
  try {
    localStorage.setItem("clonerep_open", JSON.stringify({ agentId, step }));
    localStorage.setItem("pds_agent", agentId);
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view: VIEW.clonerep } }));
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

function relTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

// mockup avatar gradients, cycled so the board reads varied like the design
const GRADS = [
  "linear-gradient(140deg,#A342FF,#FF0660)",
  "linear-gradient(140deg,#00BBFF,#A342FF)",
  "linear-gradient(140deg,#00BBFF,#2ED37D)",
  "linear-gradient(140deg,#2ED37D,#00BBFF)",
];

export default function AgentsHome() {
  // Quick clone now lives inside the one wizard as a "use defaults" toggle,
  // so the roster has a single create entry instead of competing buttons.

  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [clones, setClones] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<Record<string, Progress>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await api.get<Agent[]>("/api/agents").catch(() => [] as Agent[]);
      const reps = list.filter((a) => a.buildTrack === "clone");
      if (!alive) return;
      setClones(reps);
      setLoading(false);
      // Cheap per-clone lookups: sources + playbook feed the activity line;
      // readiness gives the fused score + lifecycle stage + plain next-action
      // sentence AND the 7 gates in one call, so the card never recomputes them
      // and can't drift from the Readiness screen.
      await Promise.all(reps.map(async (a) => {
        const [src, pb, rd] = await Promise.all([
          api.get<{ sources: SourceRow[] }>(`/api/clones/${a.id}/sources`).catch(() => ({ sources: [] as SourceRow[] })),
          api.get<{ playbook: { stages?: PlaybookStage[] } }>(`/api/clones/${a.id}/playbook`).catch(() => ({ playbook: { stages: [] as PlaybookStage[] } })),
          api.get<Readiness>(`/api/readiness/${a.id}`).catch(() => null),
        ]);
        if (!alive) return;
        // ground truth only: the clone's own session recordings don't count as sources
        const sources = (src.sources ?? []).filter((s) => s.kind !== "live_call");
        const newest = sources.reduce<string | null>((acc, s) => {
          if (!s.created_at) return acc;
          return !acc || s.created_at > acc ? s.created_at : acc;
        }, null);
        setProgress((p) => ({
          ...p,
          [a.id]: {
            loaded: true, sources: sources.length, lastSourceAt: newest, stages: pb.playbook?.stages?.length ?? 0,
            gates: rd?.gates ?? [], passed: rd?.components?.checks?.done ?? 0,
            score: rd?.score ?? null, stage: rd?.stage ?? null, sentence: rd?.sentence ?? null,
            nextAction: rd?.nextAction ?? null,
          },
        }));
      }));
    })();
    return () => { alive = false; };
  }, []);

  const isEmpty = !loading && clones.length === 0;
  const liveCount = clones.filter((a) => progress[a.id]?.stage === "live").length;

  const steps = [
    { n: "1", title: "Pick a person", desc: "Choose a top performer and add their recorded calls." },
    { n: "2", title: "Calibrate", desc: "Tune the clone turn by turn until it sounds like them." },
    { n: "3", title: "Certify", desc: "Pass all 7 gates, then take real calls with a director." },
  ];

  return (
    <div className="pmx" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)" }}>
      <PdsNav active="agentshome" theme={theme} onTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />

      <div className="app" style={{ paddingTop: 8, paddingBottom: 60 }}>
        <div className="page-h" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <h1>Your digital workforce</h1>
            <p>Clones of your best people, from draft to certified.</p>
          </div>
          {!loading && !isEmpty && (
            <div className="card" style={{ display: "inline-flex", alignItems: "center", gap: 10, borderRadius: 9999, padding: "10px 16px", fontSize: 13, color: "var(--ink2)" }}>
              <span><b style={{ color: "var(--ink1)" }}>{clones.length}</b> {clones.length === 1 ? "clone" : "clones"}</span>
              <span style={{ width: 1, height: 14, background: "var(--border)" }} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: liveCount > 0 ? "var(--success)" : "var(--track)" }} />
                <b style={{ color: "var(--ink1)" }}>{liveCount}</b> live
              </span>
            </div>
          )}
        </div>

        <OnboardingChecklist />

        {loading && (
          <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--ink3)", fontSize: 13.5 }}>
            Loading your clones…
          </div>
        )}

        {!loading && !isEmpty && (
          <div className="rostergrid">
            {clones.map((a, i) => (
              <CloneCard
                key={a.id}
                agent={a}
                progress={progress[a.id]}
                grad={GRADS[i % GRADS.length]}
                onDeleted={(id) => setClones((list) => list.filter((x) => x.id !== id))}
              />
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="card" style={{ borderRadius: 24, padding: "56px 40px", textAlign: "center", maxWidth: 760, margin: "20px auto 0" }}>
            <div style={{ width: 72, height: 72, margin: "0 auto 20px", borderRadius: 20, background: "var(--purple-soft)", color: "var(--purple-ink)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg className="i" viewBox="0 0 24 24" style={{ width: 34, height: 34 }}>
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" />
              </svg>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.02em" }}>Clone your first employee</div>
            <p style={{ fontSize: 14.5, color: "var(--ink2)", maxWidth: 480, margin: "10px auto 30px", lineHeight: 1.5 }}>
              Pick a top performer, feed the clone their real calls, and calibrate until it certifies. Then it takes real calls with you on console.
            </p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 32, flexWrap: "wrap" }}>
              {steps.map((s) => (
                <div key={s.n} style={{ flex: 1, minWidth: 180, maxWidth: 220, textAlign: "left", padding: 18, borderRadius: 16, background: "var(--sunk)" }}>
                  <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--card)", color: "var(--purple-ink)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{s.n}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{s.title}</div>
                  <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.45 }}>{s.desc}</div>
                </div>
              ))}
            </div>
            <button className="btn pink" onClick={() => nav(VIEW.clonerep)} style={{ margin: "0 auto" }}>
              <svg className="i sm" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>Clone your first employee
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- clone card ----------

type StageCls = "build" | "cal" | "review" | "live";

// Lifecycle stage pill (the mockup's colored-dot stages) — keyed off the
// fused readiness stage so the roster reads as a single lifecycle spine.
// `ring` also colours the .scoremini progress ring.
const STAGE_MAP: Record<ReadinessStage, { cls: StageCls; label: string; ring: string }> = {
  learning: { cls: "build", label: "Learning", ring: "var(--decor)" },
  rehearsing: { cls: "cal", label: "Calibrating", ring: "var(--purple)" },
  "ready-to-review": { cls: "review", label: "Ready to review", ring: "var(--warning)" },
  live: { cls: "live", label: "Live", ring: "var(--success)" },
};

// fallback before readiness lands — derived from the agent record, same
// as the original screen (Draft / Calibrating / Live version).
type Status = "Draft" | "Calibrating" | "Live version";
const STATUS_MAP: Record<Status, { cls: StageCls; ring: string }> = {
  Draft: { cls: "build", ring: "var(--decor)" },
  Calibrating: { cls: "cal", ring: "var(--purple)" },
  "Live version": { cls: "live", ring: "var(--success)" },
};

// One primary button per lifecycle stage — same footer for every stage, only
// the label/target/tone change. Whole-card click still opens Readiness; these
// are the stage-appropriate destinations from the mockup.
const STAGE_CTA: Record<ReadinessStage, { label: string; view: string; cls: string }> = {
  learning: { label: "Watch build", view: "readiness", cls: "btn sm" },
  rehearsing: { label: "Open room", view: "rehearsal", cls: "btn purple sm" },
  "ready-to-review": { label: "Review", view: "readiness", cls: "btn pink sm" },
  live: { label: "Open", view: VIEW.workspace, cls: "btn pink sm" },
};

function CloneCard({ agent, progress, grad, onDeleted }: { agent: Agent; progress?: Progress; grad: string; onDeleted: (id: string) => void }) {
  // quick live test: paste a Zoom link, the clone joins the real call
  const [zoomOpen, setZoomOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState("");
  async function deleteAgent() {
    if (deleting) return;
    setDeleting(true); setDelErr("");
    try {
      await api.del(`/api/agents/${agent.id}`);
      try { if (localStorage.getItem("pds_agent") === agent.id) localStorage.removeItem("pds_agent"); } catch { /* ignore */ }
      onDeleted(agent.id);
    } catch (e) {
      setDelErr(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
      setDeleting(false);
    }
  }
  const [zoomLink, setZoomLink] = useState("");
  const [zoomBusy, setZoomBusy] = useState(false);
  const [zoomErr, setZoomErr] = useState("");
  async function joinZoom() {
    const link = zoomLink.trim();
    if (!link || zoomBusy) return;
    // parse the meeting id here — the domain (us06web.zoom.us) has digits, so
    // sending the raw link invites id corruption downstream
    const jm = link.match(/\/j\/(\d{9,11})/);
    const meetingId = jm ? jm[1] : link.replace(/\D/g, "");
    if (meetingId.length < 9) { setZoomErr("That doesn't look like a Zoom link or meeting id."); return; }
    setZoomBusy(true); setZoomErr("");
    try {
      await api.post("/api/live/join", { meetingId, agentId: agent.id });
      try { localStorage.setItem("pds_agent", agent.id); } catch { /* ignore */ }
      nav("precall", agent.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setZoomErr(msg.includes("409") || /active/i.test(msg) ? "A session is already running — end it first (calibration room or director console)." : `Join failed: ${msg}`);
    }
    setZoomBusy(false);
  }

  const loaded = progress?.loaded ?? false;
  const hasSources = (progress?.sources ?? 0) > 0;
  const hasPlaybook = (progress?.stages ?? 0) > 0;
  // status and CTA still key off the agent record; the gates are read server-side
  const hasPersona = Boolean(agent.persona && (agent.persona as { identity?: unknown }).identity);
  const goldenPinned = Boolean(agent.golden_persona_id);
  const status: Status = !hasPersona ? "Draft" : goldenPinned ? "Live version" : "Calibrating";
  const golden = status === "Live version";

  // 7 certification gates, read straight from the server so the card and the
  // readiness screen can never drift — used only to fill the build bar before
  // a readiness score has landed; the card body no longer shows a gate count.
  const gatesArr = progress?.gates ?? [];
  const done = gatesArr.filter((g) => g.pass).length;

  // fused readiness (score + lifecycle stage + the name-free next action line)
  const rStage = progress?.stage ?? null;
  const rScore = progress?.score ?? null;
  const rNext = progress?.nextAction ?? null;

  // stage pill + ring colour: readiness stage when known, else the record status
  const stageInfo = rStage ? STAGE_MAP[rStage] : STATUS_MAP[status];
  const stageCls = stageInfo.cls;
  const stageLabel = rStage ? STAGE_MAP[rStage].label : status;
  const ring = stageInfo.ring;

  // the videocam "Test on Zoom" join belongs to the Live stage only
  const isLive = rStage === "live" || (rStage == null && golden);

  const activity = !loaded
    ? "checking progress…"
    : (() => {
        const parts: string[] = [];
        if (!hasSources) parts.push("no call sources yet");
        else parts.push(`${progress?.sources} real call${(progress?.sources ?? 0) === 1 ? "" : "s"}`);
        if (hasPlaybook) parts.push(`playbook · ${progress?.stages} stage${(progress?.stages ?? 0) === 1 ? "" : "s"}`);
        const rel = relTime(progress?.lastSourceAt ?? null);
        if (rel) parts.push(`updated ${rel}`);
        return parts.join(" · ");
      })();
  // the card body is the next action only — name-free, percent-free — falling
  // back to the build/activity line before readiness lands
  const nextText = rNext || activity;

  // one primary action per lifecycle stage; before readiness lands fall back to
  // the record-based status (Open once certified, otherwise Calibrate)
  const cta = rStage
    ? STAGE_CTA[rStage]
    : golden
      ? { label: "Open", view: VIEW.workspace, cls: "btn pink sm" }
      : { label: "Calibrate", view: VIEW.studio, cls: "btn sm" };

  // .foot leading element: readiness ring, or a build bar before the score lands
  const dashoffset = rScore != null ? (94.2 * (1 - rScore / 100)).toFixed(1) : "94.2";
  const footLead = !loaded ? (
    <div className="mut" style={{ fontSize: 13 }}>checking progress…</div>
  ) : rScore == null ? (
    <div className="mut" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
      <span className="vbar"><span style={{ width: `${Math.round((done / 7) * 100)}%`, background: "var(--decor)" }} /></span>building
    </div>
  ) : (
    <div className="scoremini">
      <span style={{ position: "relative", width: 36, height: 36, flex: "none", display: "inline-grid", placeItems: "center" }}>
        <svg viewBox="0 0 36 36" style={{ position: "absolute", inset: 0, width: 36, height: 36 }}>
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--track)" strokeWidth="4" />
          <circle cx="18" cy="18" r="15" fill="none" stroke={ring} strokeWidth="4" strokeLinecap="round" strokeDasharray="94.2" strokeDashoffset={dashoffset} transform="rotate(-90 18 18)" />
        </svg>
        <span style={{ position: "relative", fontSize: 15, fontWeight: 800, lineHeight: 1 }}>{rScore}</span>
      </span>
    </div>
  );

  return (
    <div className="card clone" onClick={() => openReadiness(agent.id)}>
      <div className="head">
        <div className="pic" style={{ background: grad }}>{initials(agent.name)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="nm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.name}</div>
          <div className="role" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.role || "Clone"}</div>
        </div>
        <div style={{ flex: 1 }} />
        <span className={`stage ${stageCls}`}><span className="dot" />{stageLabel}</span>
        {/* rare housekeeping lives behind a quiet ⋯, not a permanent trash icon */}
        <span style={{ position: "relative", flexShrink: 0 }}>
          <button onClick={(e) => { e.stopPropagation(); setMoreOpen((o) => !o); }} title="More" className="iconbtn" style={{ width: 30, height: 30, border: "none", background: moreOpen ? "var(--ghost)" : "transparent", color: "var(--ink3)" }}>
            <svg className="i sm" viewBox="0 0 24 24" style={{ fill: "currentColor", stroke: "none" }}>
              <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
            </svg>
          </button>
          {moreOpen && (
            <>
              <div onClick={(e) => { e.stopPropagation(); setMoreOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
              <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 31, width: 190, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg)", padding: 5 }}>
                <button onClick={(e) => { e.stopPropagation(); setMoreOpen(false); openWizard(agent.id, 1); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "var(--ink1)", fontSize: 12, fontWeight: 700, textAlign: "left", ...btnFont }}>
                  <svg className="i sm" viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>Edit clone…
                </button>
                <button onClick={(e) => { e.stopPropagation(); setMoreOpen(false); openWizard(agent.id, 4); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "var(--ink1)", fontSize: 12, fontWeight: 700, textAlign: "left", ...btnFont }}>
                  <svg className="i sm" viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" /></svg>Choose voice…
                </button>
                <div style={{ height: 1, background: "var(--border)", margin: "5px 4px" }} />
                <button onClick={(e) => { e.stopPropagation(); setMoreOpen(false); setDelOpen(true); setDelErr(""); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "var(--error-ink)", fontSize: 12, fontWeight: 700, textAlign: "left", ...btnFont }}>
                  <svg className="i sm" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" /></svg>Delete clone…
                </button>
              </div>
            </>
          )}
        </span>
      </div>

      {/* the one next action — name-free, percent-free, no gate bars */}
      <div className="next">
        <div>
          <span className="lbl">Next action</span>
          {nextText}
        </div>
      </div>

      {/* score dial + one primary button; the videocam Test-on-Zoom join is
          shown on the Live stage only */}
      <div className="foot">
        {footLead}
        <div style={{ flex: 1 }} />
        {isLive && (
          <button
            onClick={(e) => { e.stopPropagation(); setZoomOpen((o) => !o); setZoomErr(""); }}
            title="Test on Zoom — paste a link and the clone joins the real call"
            className="iconbtn"
            style={zoomOpen ? { borderColor: "var(--purple)", background: "var(--purple)", color: "#fff" } : { borderColor: "var(--purple)", color: "var(--purple)" }}
          >
            <svg className="i sm" viewBox="0 0 24 24"><path d="m23 7-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
          </button>
        )}
        <button className={cta.cls} onClick={(e) => { e.stopPropagation(); nav(cta.view, agent.id); }}>{cta.label}</button>
      </div>

      {delOpen && (
        <div onClick={(e) => e.stopPropagation()} style={{ padding: "10px 12px", borderRadius: 12, background: "var(--error-soft)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200, fontSize: 11.5, color: "var(--error-ink)", fontWeight: 700, lineHeight: 1.45 }}>
            Delete {agent.name} for good? The persona, call sources, versions, quality checks and history all go with it. This cannot be undone.
          </div>
          <button onClick={() => void deleteAgent()} disabled={deleting} style={{ flexShrink: 0, height: 32, padding: "0 14px", borderRadius: 9999, border: "none", background: "var(--error-ink)", color: "#fff", fontSize: 11.5, fontWeight: 800, opacity: deleting ? 0.6 : 1, ...btnFont }}>
            {deleting ? "Deleting…" : "Delete for good"}
          </button>
          <button onClick={() => setDelOpen(false)} style={{ flexShrink: 0, background: "none", border: "none", color: "var(--ink2)", fontSize: 11.5, fontWeight: 700, ...btnFont }}>Cancel</button>
          {delErr && <div style={{ width: "100%", fontSize: 10.5, color: "var(--error-ink)" }}>{delErr}</div>}
        </div>
      )}

      {zoomOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={zoomLink} onChange={(e) => setZoomLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void joinZoom(); }} placeholder="Paste the Zoom link…" style={{ flex: 1, height: 34, borderRadius: 9, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12, padding: "0 10px", outline: "none" }} />
            <button onClick={() => void joinZoom()} disabled={zoomBusy || !zoomLink.trim()} style={{ flexShrink: 0, height: 34, padding: "0 14px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 11.5, fontWeight: 800, opacity: zoomBusy || !zoomLink.trim() ? 0.6 : 1, ...btnFont }}>
              {zoomBusy ? "Joining…" : "Join"}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: zoomErr ? "var(--error-ink)" : "var(--ink3)", marginTop: 5, lineHeight: 1.4 }}>
            {zoomErr || `${agent.name.split(" ")[0]} joins the real call — admit him from Zoom, then watch from the pre-call check.`}
          </div>
        </div>
      )}
    </div>
  );
}
