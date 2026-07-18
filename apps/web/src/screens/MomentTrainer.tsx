import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api, getAccessKey } from "../api/client";
import type { CallPlaybook, PersonaDelta, PersonaSpec } from "@jarvis/shared";
import "../pds.css";

// ============================================================
// Moment trainer — inspect and correct specific call moments.
// From Moment Trainer.dc.html (Perfect Design System 2026).
// Moments are real: the clone's few-shots (voice moments learned
// from calls) plus the call playbook stages (screen moments).
// Drill a voice moment against the live clone via a calibration
// session (SSE), compare the clone's answer with the human line,
// rate it, and compile corrections (persona deltas) into a new
// persona version.
// ============================================================

type Agent = {
  id: string; name: string; role?: string; icon?: string; status?: string;
  buildTrack?: string; persona?: PersonaSpec; golden_persona_id?: string; voice_id?: string;
};
type Grade = "s" | "w" | "m";
type Moment =
  | { kind: "voice"; id: string; situation: string; human: string; source?: string }
  | { kind: "stage"; id: string; name: string; goal: string; objective: string; exampleLines: string[]; screenTitle: string; regions: string[]; actions: string[] };

const GRADE_META: Record<Grade | "n", { label: string; tick: string; bg: string; ink: string }> = {
  s: { label: "Strong", tick: "var(--success)", bg: "var(--success-soft)", ink: "var(--success-ink)" },
  w: { label: "Weak", tick: "var(--warning)", bg: "var(--warning-soft)", ink: "var(--warning-ink)" },
  m: { label: "Miss", tick: "var(--error)", bg: "var(--error-soft)", ink: "var(--error-ink)" },
  n: { label: "Untrained", tick: "var(--track)", bg: "var(--ghost)", ink: "var(--ink2)" },
};

const gradeKey = (agentId: string) => `pds_moment_grades:${agentId}`;
function loadGrades(agentId: string): Record<string, Grade> {
  try { return JSON.parse(localStorage.getItem(gradeKey(agentId)) || "{}") as Record<string, Grade>; } catch { return {}; }
}
function saveGrades(agentId: string, g: Record<string, Grade>): void {
  try { localStorage.setItem(gradeKey(agentId), JSON.stringify(g)); } catch { /* ignore */ }
}

function nav(view: string): void {
  window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
}

// SSE reader for a calibration session message (from StudioOld.tsx)
async function streamSession(sessionId: string, text: string, onDelta: (t: string) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`${api.base}/api/sessions/${sessionId}/messages`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(getAccessKey() ? { "X-API-Key": getAccessKey() } : {}) },
    body: JSON.stringify({ text }),
  });
  if (!res.body) return;
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split(/\n\n/); buf = frames.pop() ?? "";
    for (const f of frames) {
      const line = f.split(/\n/).find((l) => l.startsWith("data:")); if (!line) continue;
      const p = line.slice(5).trim(); if (p === "[DONE]") return;
      try { const d = JSON.parse(p)?.choices?.[0]?.delta?.content; if (d) onDelta(d); } catch { /* ignore */ }
    }
  }
}

const card: CSSProperties = { background: "var(--card)", borderRadius: 20, boxShadow: "var(--shadow)", padding: 22 };
const upLabel: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 5 };
const pill: CSSProperties = { fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 9999 };
const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

// Decorative waveform bars (visual only, mirrors the design's fixed pattern).
const WAVE = Array.from({ length: 24 }, (_, i) => 25 + Math.round(Math.abs(Math.sin(i * 1.1)) * 75));

export default function MomentTrainer() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [playbook, setPlaybook] = useState<CallPlaybook | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState(0);
  const [grades, setGrades] = useState<Record<string, Grade>>({});
  // drill state for the selected moment
  const [drill, setDrill] = useState<{ id: string; text: string; turnId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // correction editor
  const [rewrite, setRewrite] = useState("");
  const [capSearch, setCapSearch] = useState("");
  const [capPicked, setCapPicked] = useState<string[]>([]);
  const [pending, setPending] = useState<{ turnId: string; delta: PersonaDelta }[]>([]);
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState<{ version: number | null } | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    void (async () => {
      const list = await api.get<Agent[]>("/api/agents").catch(() => [] as Agent[]);
      let pick: string | null = null;
      try { pick = localStorage.getItem("pds_agent"); } catch { /* ignore */ }
      const a = list.find((x) => x.id === pick) || list.find((x) => x.buildTrack === "clone" && x.persona?.identity) || list[0] || null;
      if (a) {
        setAgent(a);
        try { localStorage.setItem("pds_agent", a.id); } catch { /* ignore */ }
        setGrades(loadGrades(a.id));
        const pb = await api.get<{ playbook: CallPlaybook }>(`/api/clones/${a.id}/playbook`).catch(() => null);
        if (pb) setPlaybook(pb.playbook);
      }
      setLoaded(true);
    })();
  }, []);

  const moments = useMemo<Moment[]>(() => {
    const out: Moment[] = [];
    for (const f of agent?.persona?.few_shots ?? []) {
      out.push({ kind: "voice", id: f.id, situation: f.situation, human: f.human_response, source: f.source });
    }
    for (const st of playbook?.stages ?? []) {
      out.push({ kind: "stage", id: st.id, name: st.name, goal: st.goal, objective: st.voice.objective, exampleLines: st.voice.exampleLines, screenTitle: st.wireframe.screenTitle, regions: st.wireframe.regions, actions: st.screen.actions });
    }
    return out;
  }, [agent, playbook]);

  const voiceN = useMemo(() => moments.filter((m) => m.kind === "voice").length, [moments]);
  const stageN = moments.length - voiceN;
  const moment = moments[sel] ?? null;

  // prefill the rewrite with the human baseline when the selection changes
  useEffect(() => {
    if (moment?.kind === "voice") setRewrite(moment.human);
    else setRewrite("");
    setCapPicked([]);
  }, [sel, moment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function setGrade(id: string, g: Grade): void {
    if (!agent) return;
    const next = { ...grades, [id]: g };
    setGrades(next); saveGrades(agent.id, next);
  }

  function gradeOf(id: string): Grade | "n" {
    return grades[id] ?? "n";
  }

  async function runDrill(m: Extract<Moment, { kind: "voice" }>): Promise<void> {
    if (!agent || busy) return;
    setBusy(true);
    setDrill({ id: m.id, text: "", turnId: null });
    let sid = sessionId;
    if (!sid) {
      const s = await api.post<{ sessionId: string; activeVersionId: string | null }>("/api/sessions", { agentId: agent.id, mode: "calibration" }).catch(() => null);
      if (!s) { setBusy(false); setDrill(null); return; }
      sid = s.sessionId; setSessionId(sid);
    }
    const ctrl = new AbortController(); abortRef.current = ctrl;
    let acc = "";
    try {
      await streamSession(sid, m.situation, (d) => { acc += d; setDrill((prev) => (prev && prev.id === m.id ? { ...prev, text: acc } : prev)); }, ctrl.signal);
    } catch { /* aborted or network error */ }
    // reconcile the real turn id so feedback works
    try {
      const { turns } = await api.get<{ turns: { id: string; role: string }[] }>(`/api/sessions/${sid}/turns`);
      const last = [...turns].reverse().find((t) => t.role === "clone");
      if (last) setDrill((prev) => (prev && prev.id === m.id ? { ...prev, turnId: last.id } : prev));
    } catch { /* ignore */ }
    setBusy(false);
  }

  // capability chips come from the real playbook screen actions
  const caps = useMemo(() => {
    const set = new Set<string>();
    for (const st of playbook?.stages ?? []) for (const a of st.screen.actions) if (a.trim()) set.add(a.trim());
    return [...set];
  }, [playbook]);
  const capsShown = useMemo(() => {
    const q = capSearch.trim().toLowerCase();
    const list = q ? caps.filter((c) => c.toLowerCase().includes(q)) : caps;
    return list.slice(0, 8);
  }, [caps, capSearch]);

  const drilledHere = drill && moment && drill.id === moment.id && !busy && drill.text ? drill : null;
  const canCorrect = !!(drilledHere && drilledHere.turnId);

  async function addCorrection(): Promise<void> {
    if (!agent || !drilledHere?.turnId || !rewrite.trim()) return;
    const note = rewrite.trim() + (capPicked.length ? `\nScreen: ${capPicked.join(", ")}` : "");
    const r = await api.post<{ delta: PersonaDelta }>(`/api/turns/${drilledHere.turnId}/feedback`, { rating: "down", note }).catch(() => null);
    if (r) {
      setPending((p) => [...p, { turnId: drilledHere.turnId as string, delta: r.delta }]);
      setCompiled(null);
      if (moment) setGrade(moment.id, grades[moment.id] === "m" ? "m" : "w");
    }
  }

  async function compile(): Promise<void> {
    if (!agent || !pending.length || compiling) return;
    setCompiling(true);
    let last: { number?: number } | null = null;
    for (const p of pending) {
      const r = await api.post<{ version: { number?: number } }>(`/api/clones/${agent.id}/apply-delta`, { delta: p.delta, turnId: p.turnId, ...(sessionId ? { sessionId } : {}) }).catch(() => null);
      if (r) last = r.version;
    }
    if (last) { setCompiled({ version: last.number ?? null }); setPending([]); }
    setCompiling(false);
  }

  async function playAudio(text: string): Promise<void> {
    if (playing || !text.trim()) return;
    setPlaying(true);
    try {
      const res = await fetch(`${api.base}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getAccessKey() ? { "X-API-Key": getAccessKey() } : {}) },
        body: JSON.stringify({ text, voiceId: agent?.persona?.voice?.elevenlabs_voice_id || agent?.voice_id || undefined }),
      });
      if (!res.ok) throw new Error("tts");
      const url = URL.createObjectURL(await res.blob());
      const a = new Audio(url);
      a.onended = () => { URL.revokeObjectURL(url); setPlaying(false); };
      await a.play();
    } catch { setPlaying(false); }
  }

  // coverage, derived honestly from this browser's drill grades
  const trainedN = moments.filter((m) => grades[m.id]).length;
  const neverN = moments.length - trainedN;
  const missN = moments.filter((m) => grades[m.id] === "m").length;

  const themeIcon = theme === "dark" ? "light_mode" : "dark_mode";
  const g = moment ? GRADE_META[grades[moment.id] ?? "n"] : GRADE_META.n;
  const name = agent?.name ?? "";

  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--nav-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--border)", padding: "12px 24px", display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => nav("echo")} style={{ width: 36, height: 36, borderRadius: 10, border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }}>
          <span className="material-symbols-rounded" style={{ fontSize: 22 }}>arrow_back</span>
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Moment trainer</div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>
            {agent ? `${name} · ${voiceN} voice moment${voiceN === 1 ? "" : "s"} · ${stageN} call stage${stageN === 1 ? "" : "s"}` : "no clone selected"}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => nav("drillmode")} style={{ display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 16px", borderRadius: 9999, border: "none", background: "var(--ghost)", color: "var(--ink1)", fontSize: 13, fontWeight: 700, ...btnFont }}>
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>style</span>Drill mode
          </button>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }}>
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{themeIcon}</span>
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 24px 60px" }}>
        {loaded && !moments.length && (
          <div style={{ ...card, textAlign: "center", padding: 48 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 36, color: "var(--ink3)" }}>model_training</span>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 10 }}>No moments to train yet</div>
            <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 6, marginBottom: 18 }}>Moments come from real calls. Add call sources and extract a persona, then this timeline fills in.</div>
            <button onClick={() => nav("pdsstudio")} style={{ height: 42, padding: "0 20px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 13.5, fontWeight: 700, ...btnFont }}>Open the Calibration Room</button>
          </div>
        )}

        {moments.length > 0 && (
          <>
            {/* timeline scrubber */}
            <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: "18px 20px", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, fontSize: 11, fontWeight: 700, flexWrap: "wrap" }}>
                {(["s", "w", "m", "n"] as const).map((k) => (
                  <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--ink2)" }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: GRADE_META[k].tick }} />{GRADE_META[k].label}
                  </span>
                ))}
                <span style={{ marginLeft: "auto", color: "var(--ink3)" }}>click a moment to inspect · grades come from your drills</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 46 }}>
                {moments.map((m, i) => {
                  const gr = gradeOf(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => { setSel(i); setDrill(null); }}
                      title={`Moment ${i + 1} · ${GRADE_META[gr].label}${m.kind === "stage" ? ` · ${m.name}` : ""}`}
                      style={{ flex: 1, height: `${gr === "n" ? 55 : 100}%`, minHeight: "40%", background: GRADE_META[gr].tick, border: i === sel ? "2px solid var(--ink1)" : "none", borderRadius: 3, cursor: "pointer", padding: 0 }}
                    />
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 3, marginTop: 8 }}>
                {voiceN > 0 && (
                  <div style={{ flex: voiceN, textAlign: "center" }}>
                    <div style={{ height: 2, background: "var(--border)", marginBottom: 5 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ink3)" }}>Voice moments</span>
                  </div>
                )}
                {stageN > 0 && (
                  <div style={{ flex: stageN, textAlign: "center" }}>
                    <div style={{ height: 2, background: "var(--border)", marginBottom: 5 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ink3)" }}>Call stages</span>
                  </div>
                )}
              </div>
            </div>

            {/* moment: speech + screen */}
            {moment && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}>
                {/* speech */}
                <div style={card}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--purple)" }}>record_voice_over</span>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>Speech</div>
                    <span style={{ ...pill, marginLeft: "auto", background: g.bg, color: g.ink }}>{grades[moment.id] ? `${g.label} turn` : "Untrained"}</span>
                  </div>
                  {moment.kind === "voice" ? (
                    <>
                      <div style={upLabel}>Customer said</div>
                      <div style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.5, paddingBottom: 14, borderBottom: "1px solid var(--divider)" }}>{moment.situation}</div>
                      <div style={{ ...upLabel, color: "var(--purple-ink)", margin: "14px 0 5px" }}>{name} said</div>
                      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>{moment.human}</div>
                      {moment.source && <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 8 }}>from {moment.source}</div>}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
                        <button onClick={() => void playAudio(moment.human)} disabled={playing} style={{ display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 15px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 12.5, fontWeight: 700, opacity: playing ? 0.6 : 1, ...btnFont }}>
                          <span className="material-symbols-rounded" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>play_arrow</span>{playing ? "Playing" : "Play audio"}
                        </button>
                        <div style={{ flex: 1, height: 20, display: "flex", alignItems: "center", gap: 2 }}>
                          {WAVE.map((h, i) => <div key={i} style={{ flex: 1, height: `${h}%`, background: "var(--track)", borderRadius: 2 }} />)}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={upLabel}>Stage</div>
                      <div style={{ fontSize: 14, fontWeight: 700, paddingBottom: 12, borderBottom: "1px solid var(--divider)" }}>{moment.name}</div>
                      <div style={{ ...upLabel, margin: "12px 0 5px" }}>Objective</div>
                      <div style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.5 }}>{moment.objective || moment.goal || "no objective written yet"}</div>
                      {moment.exampleLines.length > 0 && (
                        <>
                          <div style={{ ...upLabel, color: "var(--purple-ink)", margin: "14px 0 5px" }}>{name} says</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {moment.exampleLines.slice(0, 3).map((l, i) => <div key={i} style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.5 }}>"{l}"</div>)}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* screen */}
                <div style={card}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--decor)" }}>tv</span>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>Screen</div>
                  </div>
                  {moment.kind === "stage" ? (
                    <>
                      <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", background: "var(--sunk)", padding: 14, marginBottom: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink3)", marginBottom: 10, textTransform: "uppercase" }}>Canvas · {moment.screenTitle || "untitled screen"}</div>
                        {moment.regions.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {moment.regions.map((r, i) => (
                              <span key={i} style={{ fontSize: 11.5, fontWeight: 700, padding: "8px 12px", borderRadius: 8, background: "var(--purple-soft)", color: "var(--purple-ink)" }}>{r}</span>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "var(--ink3)" }}>no regions defined for this stage</div>
                        )}
                      </div>
                      <div style={{ ...upLabel, marginBottom: 8 }}>Screen actions</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {moment.actions.map((a, i) => (
                          <div key={i} style={{ fontSize: 12.5, color: "var(--ink2)", display: "flex", alignItems: "center", gap: 7 }}>
                            <span className="material-symbols-rounded" style={{ fontSize: 15, color: "var(--success-ink)" }}>check</span>{a}
                          </div>
                        ))}
                        {!moment.actions.length && <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>no screen actions on this stage</div>}
                      </div>
                    </>
                  ) : (
                    <div style={{ borderRadius: 14, border: "1px dashed var(--border)", background: "var(--sunk)", padding: "26px 18px", textAlign: "center" }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 26, color: "var(--ink3)" }}>tv_off</span>
                      <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 8, lineHeight: 1.5 }}>No screen data on this voice moment. Screen actions live on the call playbook stages, further right on the timeline.</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* drill this moment */}
            {moment && moment.kind === "voice" && (
              <div style={{ ...card, marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Drill this moment</div>
                  <button onClick={() => void runDrill(moment)} disabled={busy} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 16px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 700, opacity: busy ? 0.6 : 1, boxShadow: "0 8px 24px rgba(255,6,96,.3)", ...btnFont }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 18 }}>bolt</span>{busy ? "Streaming" : drilledHere ? "Drill again" : "Run the clone"}
                  </button>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink3)", marginBottom: drill && drill.id === moment.id ? 16 : 0 }}>Sends the customer line to the live clone and compares its answer with what {name} actually said.</div>
                {drill && drill.id === moment.id && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14 }}>
                        <span style={{ ...pill, background: "var(--purple-soft)", color: "var(--purple-ink)" }}>Clone</span>
                        <div style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 10, whiteSpace: "pre-wrap" }}>{drill.text || (busy ? "…" : "no answer")}</div>
                      </div>
                      <div style={{ border: "1.5px dashed var(--border)", borderRadius: 14, padding: 14 }}>
                        <span style={{ ...pill, background: "var(--ghost)", color: "var(--ink2)" }}>Real {name}</span>
                        <div style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 10, color: "var(--ink2)" }}>{moment.human}</div>
                      </div>
                    </div>
                    {drilledHere && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)" }}>Rate it</span>
                        {(["s", "w", "m"] as const).map((k) => {
                          const on = grades[moment.id] === k;
                          return (
                            <button key={k} onClick={() => setGrade(moment.id, k)} style={{ height: 36, padding: "0 15px", borderRadius: 9999, border: `1px solid ${on ? GRADE_META[k].tick : "var(--border)"}`, background: on ? GRADE_META[k].tick : "transparent", color: on ? "#fff" : "var(--ink2)", fontSize: 12.5, fontWeight: 700, ...btnFont }}>{GRADE_META[k].label}</button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* correction editor */}
            {moment && moment.kind === "voice" && (
              <div style={{ ...card, marginBottom: 18 }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Correct this moment</div>
                <div style={{ fontSize: 12.5, color: "var(--ink3)", marginBottom: 16 }}>
                  {canCorrect ? `Rewrite what ${name} should have said, and pick the screen capability she should have driven.` : "Run the clone on this moment first, then corrections attach to that turn."}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 8 }}>Speech rewrite</div>
                    <textarea
                      value={rewrite}
                      onChange={(e) => setRewrite(e.target.value)}
                      placeholder="What should the clone have said"
                      style={{ width: "100%", height: 96, padding: "12px 14px", borderRadius: 14, border: "2px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontSize: 13.5, lineHeight: 1.5, resize: "none", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 8 }}>Screen capability</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 13px", borderRadius: 12, border: "2px solid var(--border)", background: "var(--sunk)", marginBottom: 10 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 18, color: "var(--ink3)" }}>search</span>
                      <input value={capSearch} onChange={(e) => setCapSearch(e.target.value)} placeholder="Search capabilities" style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink1)", fontSize: 13, fontFamily: "inherit" }} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {capsShown.map((c) => {
                        const on = capPicked.includes(c);
                        return (
                          <button key={c} onClick={() => setCapPicked((p) => (on ? p.filter((x) => x !== c) : [...p, c]))} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 38, padding: "0 12px", borderRadius: 10, border: `1px solid ${on ? "var(--purple)" : "var(--border)"}`, background: on ? "var(--purple-soft)" : "transparent", color: on ? "var(--purple-ink)" : "var(--ink1)", fontSize: 12, fontWeight: 700, ...btnFont }}>
                            <span style={{ width: 22, height: 16, borderRadius: 4, background: on ? "var(--purple)" : "var(--track)" }} />{c}
                          </button>
                        );
                      })}
                      {!caps.length && <div style={{ fontSize: 12, color: "var(--ink3)" }}>no capabilities yet, they come from the call playbook screen actions</div>}
                    </div>
                  </div>
                </div>
                <button onClick={() => void addCorrection()} disabled={!canCorrect || !rewrite.trim()} style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 7, height: 42, padding: "0 18px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 13.5, fontWeight: 700, opacity: canCorrect && rewrite.trim() ? 1 : 0.5, ...btnFont }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>add</span>Add correction
                </button>
              </div>
            )}

            {/* compile bar */}
            <div style={{ background: compiled ? "linear-gradient(120deg, #12915F, #0E8A4F)" : "var(--card)", borderRadius: 20, boxShadow: "var(--shadow)", padding: "20px 22px", marginBottom: 18, display: "flex", alignItems: "center", gap: 18 }}>
              {compiled ? (
                <>
                  <span className="material-symbols-rounded" style={{ fontSize: 30, color: "#fff", fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{compiled.version != null ? `Persona v${compiled.version} created` : "New persona version created"}</div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,.8)" }}>Corrections compiled into new rules and few-shots.</div>
                  </div>
                  <button onClick={() => nav("pdsstudio")} style={{ height: 44, padding: "0 20px", borderRadius: 9999, border: "none", background: "#fff", color: "#0E8A4F", fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 7, ...btnFont }}>
                    Review in Calibration Room<span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_forward</span>
                  </button>
                </>
              ) : (
                <>
                  <span className="material-symbols-rounded" style={{ fontSize: 28, color: "var(--purple)" }}>model_training</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{pending.length} correction{pending.length === 1 ? "" : "s"} pending</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>{pending.length ? "Compile them into a new persona version." : "Drill a moment, add a correction, then compile."}</div>
                  </div>
                  <button onClick={() => void compile()} disabled={!pending.length || compiling} style={{ height: 46, padding: "0 24px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 800, opacity: pending.length && !compiling ? 1 : 0.5, boxShadow: "0 8px 24px rgba(255,6,96,.3)", display: "flex", alignItems: "center", gap: 8, ...btnFont }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20 }}>bolt</span>{compiling ? "Compiling" : "Compile"}
                  </button>
                </>
              )}
            </div>

            {/* coverage footer */}
            <div style={{ ...card, display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{trainedN} / {moments.length}</div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)", marginTop: 2 }}>Moments drilled</div>
              </div>
              <div style={{ width: 1, height: 40, background: "var(--divider)" }} />
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, color: "var(--warning-ink)" }}>{neverN}</div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)", marginTop: 2 }}>Never drilled</div>
              </div>
              <div style={{ width: 1, height: 40, background: "var(--divider)" }} />
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, color: "var(--error-ink)" }}>{missN}</div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)", marginTop: 2 }}>Marked miss</div>
              </div>
              <button onClick={() => nav("drillmode")} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, height: 46, padding: "0 22px", borderRadius: 9999, border: "none", background: "var(--ghost)", color: "var(--ink1)", fontSize: 14, fontWeight: 700, ...btnFont }}>
                <span className="material-symbols-rounded" style={{ fontSize: 20 }}>bolt</span>Drill the gaps
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
