import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api, getAccessKey } from "../api/client";
import type { PersonaDelta, PersonaFewShot, PersonaSpec } from "@jarvis/shared";
import "../pds.css";

// ============================================================
// Drill mode — rapid-fire flashcard drills against the live clone.
// From Drill Mode.dc.html (Perfect Design System 2026).
// The deck is the clone's real few-shots. Each card streams the
// customer line through a calibration session (SSE), shows the
// clone's answer next to the human baseline, and lets you grade
// it. Weak grades with a correction become persona deltas; the
// exit report compiles them into a new persona version.
// ============================================================

type Agent = {
  id: string; name: string; role?: string; icon?: string; status?: string;
  buildTrack?: string; persona?: PersonaSpec; golden_persona_id?: string; voice_id?: string;
};
type Grade = "s" | "w" | "m";
type CardRun = { text: string; turnId: string | null; done: boolean };

const GRADE_DEF: { k: Grade; label: string; color: string }[] = [
  { k: "s", label: "Strong", color: "var(--success)" },
  { k: "w", label: "Weak", color: "var(--warning)" },
  { k: "m", label: "Miss", color: "var(--error)" },
];

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

const card: CSSProperties = { background: "var(--card)", borderRadius: 20, boxShadow: "var(--shadow)", padding: 20 };
const upLabel: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 5 };
const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

const SRC_UNLABELED = "unlabeled";
const srcOf = (f: PersonaFewShot) => (f.source && f.source.trim() ? f.source.trim() : SRC_UNLABELED);

function buildDeck(shots: PersonaFewShot[], picked: string[], weakFirst: boolean, grades: Record<string, Grade>): PersonaFewShot[] {
  const filtered = shots.filter((f) => picked.includes(srcOf(f)));
  if (!weakFirst) return filtered;
  const rank = (f: PersonaFewShot) => { const g = grades[f.id]; return g === "m" ? 0 : g === "w" ? 1 : g === "s" ? 3 : 2; };
  return [...filtered].sort((a, b) => rank(a) - rank(b));
}

export default function DrillMode() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<"drill" | "report">("drill");
  const [deckOpen, setDeckOpen] = useState(false);
  // deck
  const [deck, setDeck] = useState<PersonaFewShot[]>([]);
  const [idx, setIdx] = useState(0);
  const [grades, setGrades] = useState<Record<string, Grade>>({});
  const [runs, setRuns] = useState<Record<string, CardRun>>({});
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [deltas, setDeltas] = useState<{ turnId: string; delta: PersonaDelta }[]>([]);
  const [sendingFix, setSendingFix] = useState(false);
  // deck builder
  const [pickedSrcs, setPickedSrcs] = useState<string[]>([]);
  const [weakFirst, setWeakFirst] = useState(true);
  // compile
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState<{ version: number | null } | null>(null);
  // session
  const sessionRef = useRef<string | null>(null);
  const [activeVerN, setActiveVerN] = useState<number | null>(null);
  const startedRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const shots = useMemo<PersonaFewShot[]>(() => agent?.persona?.few_shots ?? [], [agent]);
  const allSrcs = useMemo(() => [...new Set(shots.map(srcOf))], [shots]);

  useEffect(() => {
    void (async () => {
      const list = await api.get<Agent[]>("/api/agents").catch(() => [] as Agent[]);
      let pick: string | null = null;
      try { pick = localStorage.getItem("pds_agent"); } catch { /* ignore */ }
      const a = list.find((x) => x.id === pick) || list.find((x) => x.buildTrack === "clone" && x.persona?.identity) || list[0] || null;
      if (a) {
        setAgent(a);
        try { localStorage.setItem("pds_agent", a.id); } catch { /* ignore */ }
        const g = loadGrades(a.id);
        setGrades(g);
        const fs: PersonaFewShot[] = a.persona?.few_shots ?? [];
        const srcs = [...new Set(fs.map(srcOf))];
        setPickedSrcs(srcs);
        setDeck(buildDeck(fs, srcs, true, g));
      }
      setLoaded(true);
    })();
  }, []);

  const current = deck[idx] ?? null;
  const run = current ? runs[current.id] : undefined;

  async function ensureSession(agentId: string): Promise<string | null> {
    if (sessionRef.current) return sessionRef.current;
    const s = await api.post<{ sessionId: string; activeVersionId: string | null }>("/api/sessions", { agentId, mode: "calibration" }).catch(() => null);
    if (!s) return null;
    sessionRef.current = s.sessionId;
    if (s.activeVersionId) {
      const v = await api.get<{ versions: { id: string; number: number }[] }>(`/api/clones/${agentId}/versions`).catch(() => null);
      const n = v?.versions.find((x) => x.id === s.activeVersionId)?.number;
      if (typeof n === "number") setActiveVerN(n);
    }
    return s.sessionId;
  }

  async function runCard(fs: PersonaFewShot): Promise<void> {
    if (!agent) return;
    setRuns((r) => ({ ...r, [fs.id]: { text: "", turnId: null, done: false } }));
    const sid = await ensureSession(agent.id);
    if (!sid) { setRuns((r) => ({ ...r, [fs.id]: { text: "", turnId: null, done: true } })); return; }
    const ctrl = new AbortController(); abortRef.current = ctrl;
    let acc = "";
    try {
      await streamSession(sid, fs.situation, (d) => { acc += d; setRuns((r) => ({ ...r, [fs.id]: { ...(r[fs.id] ?? { turnId: null, done: false }), text: acc, done: false } })); }, ctrl.signal);
    } catch { /* aborted or network error */ }
    let turnId: string | null = null;
    try {
      const { turns } = await api.get<{ turns: { id: string; role: string }[] }>(`/api/sessions/${sid}/turns`);
      turnId = [...turns].reverse().find((t) => t.role === "clone")?.id ?? null;
    } catch { /* ignore */ }
    setRuns((r) => ({ ...r, [fs.id]: { text: acc, turnId, done: true } }));
  }

  // auto-stream the current card once
  useEffect(() => {
    if (!agent || view !== "drill" || !current) return;
    if (startedRef.current.has(current.id)) return;
    startedRef.current.add(current.id);
    void runCard(current);
  }, [agent, view, idx, deck]); // eslint-disable-line react-hooks/exhaustive-deps

  function setGrade(id: string, g: Grade): void {
    if (!agent) return;
    const next = { ...grades, [id]: g };
    setGrades(next); saveGrades(agent.id, next);
  }

  async function nextCard(): Promise<void> {
    if (!current || sendingFix) return;
    abortRef.current?.abort();
    // a weak or miss grade with a written correction becomes a real persona delta
    const g = grades[current.id];
    const note = (corrections[current.id] ?? "").trim();
    const turnId = runs[current.id]?.turnId ?? null;
    if ((g === "w" || g === "m") && note && turnId) {
      setSendingFix(true);
      const r = await api.post<{ delta: PersonaDelta }>(`/api/turns/${turnId}/feedback`, { rating: "down", note }).catch(() => null);
      if (r) setDeltas((d) => [...d, { turnId, delta: r.delta }]);
      setSendingFix(false);
    }
    if (idx + 1 < deck.length) setIdx(idx + 1);
    else setView("report");
  }

  function startDeck(): void {
    abortRef.current?.abort();
    const d = buildDeck(shots, pickedSrcs, weakFirst, grades);
    setDeck(d); setIdx(0); setRuns({}); setCorrections({}); setDeltas([]);
    setCompiled(null); startedRef.current = new Set();
    setView("drill"); setDeckOpen(false);
  }

  async function compile(): Promise<void> {
    if (!agent || !deltas.length || compiling) return;
    setCompiling(true);
    let last: { number?: number } | null = null;
    for (const p of deltas) {
      const r = await api.post<{ version: { number?: number } }>(`/api/clones/${agent.id}/apply-delta`, { delta: p.delta, turnId: p.turnId, ...(sessionRef.current ? { sessionId: sessionRef.current } : {}) }).catch(() => null);
      if (r) last = r.version;
    }
    if (last) { setCompiled({ version: last.number ?? null }); setDeltas([]); }
    setCompiling(false);
  }

  // report numbers, derived from this run only
  const gradedCards = deck.filter((f) => grades[f.id]);
  const strongN = deck.filter((f) => grades[f.id] === "s").length;
  const weakCards = deck.filter((f) => grades[f.id] === "w" || grades[f.id] === "m");

  const themeIcon = theme === "dark" ? "light_mode" : "dark_mode";
  const name = agent?.name ?? "";
  const deckDesc = pickedSrcs.length && pickedSrcs.length < allSrcs.length ? pickedSrcs.join(", ") : "all moments";
  const scrim = theme === "dark" ? "rgba(2,2,18,.66)" : "rgba(0,0,64,.4)";

  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)", position: "relative" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--nav-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--border)", padding: "12px 24px", display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => nav("momenttrainer")} style={{ width: 36, height: 36, borderRadius: 10, border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }}>
          <span className="material-symbols-rounded" style={{ fontSize: 22 }}>arrow_back</span>
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Drill mode</div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>{agent ? `${name} · deck: ${deckDesc}${weakFirst ? ", weakness-first" : ""}` : "no clone selected"}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {(["drill", "report"] as const).map((v) => {
            const on = view === v;
            return (
              <button key={v} onClick={() => setView(v)} style={{ height: 32, padding: "0 13px", borderRadius: 9999, border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent)" : "transparent", color: on ? "#fff" : "var(--ink2)", fontSize: 12, fontWeight: 700, ...btnFont }}>
                {v === "drill" ? "Drilling" : "Exit report"}
              </button>
            );
          })}
          <button onClick={() => setDeckOpen(true)} style={{ display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 15px", borderRadius: 9999, background: "var(--ghost)", color: "var(--ink1)", border: "none", fontSize: 13, fontWeight: 700, ...btnFont }}>
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>tune</span>Build deck
          </button>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }}>
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{themeIcon}</span>
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 940, margin: "0 auto", padding: "26px 24px 60px" }}>
        {loaded && !shots.length && (
          <div style={{ ...card, textAlign: "center", padding: 48 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 36, color: "var(--ink3)" }}>style</span>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 10 }}>No drill cards yet</div>
            <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 6, marginBottom: 18 }}>Cards are the moments learned from real calls. Add call sources and extract a persona, then a deck appears here.</div>
            <button onClick={() => nav("pdsstudio")} style={{ height: 42, padding: "0 20px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 13.5, fontWeight: 700, ...btnFont }}>Open the Calibration Room</button>
          </div>
        )}

        {/* drilling */}
        {view === "drill" && shots.length > 0 && current && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)" }}>Card {idx + 1} of {deck.length}</div>
              <div style={{ flex: 1, height: 6, borderRadius: 9999, background: "var(--track)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.round(((idx + 1) / Math.max(deck.length, 1)) * 100)}%`, background: "var(--purple)", borderRadius: 9999 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 9999, background: "var(--warning-soft)", color: "var(--warning-ink)" }}>{srcOf(current) === SRC_UNLABELED ? "call moment" : srcOf(current)}</span>
            </div>

            <div style={{ ...card, padding: 26, textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 10 }}>Customer says</div>
              <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1.4, maxWidth: 620, margin: "0 auto" }}>{current.situation}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              {/* clone */}
              <div style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 9999, background: "var(--purple-soft)", color: "var(--purple-ink)" }}>{name} clone{activeVerN != null ? ` · v${activeVerN}` : ""}</span>
                </div>
                <div style={upLabel}>Speech</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 14, whiteSpace: "pre-wrap", minHeight: 42 }}>
                  {run?.text || (run && !run.done ? "…" : run?.done ? "no answer, check the session backend" : "…")}
                </div>
                <div style={upLabel}>Screen</div>
                <div style={{ border: "1px dashed var(--border)", borderRadius: 12, background: "var(--sunk)", padding: 12, fontSize: 12, color: "var(--ink3)", lineHeight: 1.5 }}>
                  Voice drill only. Screen actions are not simulated in drills yet, they run on the live canvas.
                </div>
              </div>
              {/* human baseline */}
              <div style={{ ...card, border: "1.5px dashed var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 9999, background: "var(--ghost)", color: "var(--ink2)" }}>Real {name} · source call</span>
                </div>
                <div style={upLabel}>Transcript</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 14, color: "var(--ink2)" }}>{current.human_response}</div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 9999, background: "var(--ghost)", color: "var(--ink2)" }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 15 }}>description</span>
                  {srcOf(current) === SRC_UNLABELED ? "from an ingested call" : `from ${srcOf(current)}`}
                </div>
              </div>
            </div>

            {/* grading */}
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 9 }}>Speech grade</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {GRADE_DEF.map(({ k, label, color }) => {
                      const on = grades[current.id] === k;
                      return (
                        <button key={k} onClick={() => setGrade(current.id, k)} style={{ height: 40, padding: "0 16px", borderRadius: 9999, border: `1px solid ${on ? color : "var(--border)"}`, background: on ? color : "transparent", color: on ? "#fff" : "var(--ink2)", fontSize: 13, fontWeight: 700, ...btnFont }}>{label}</button>
                      );
                    })}
                  </div>
                </div>
                <div style={{ opacity: 0.45 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 9 }}>Screen grade</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {GRADE_DEF.map(({ k, label }) => (
                      <button key={k} disabled style={{ height: 40, padding: "0 16px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink2)", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "not-allowed" }}>{label}</button>
                    ))}
                    <span style={{ fontSize: 11, color: "var(--ink3)" }}>needs live canvas drills</span>
                  </div>
                </div>
              </div>
              <input
                value={corrections[current.id] ?? ""}
                onChange={(e) => setCorrections((c) => ({ ...c, [current.id]: e.target.value }))}
                placeholder="Optional correction, what should the clone have said"
                style={{ width: "100%", marginTop: 16, height: 44, padding: "0 16px", borderRadius: 12, border: "2px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontSize: 13.5, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
              />
              {(grades[current.id] === "w" || grades[current.id] === "m") && (corrections[current.id] ?? "").trim() && !run?.turnId && (
                <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 8 }}>Waiting for the clone turn to save, the correction attaches to it on next card.</div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => void nextCard()} disabled={sendingFix} style={{ display: "flex", alignItems: "center", gap: 8, height: 50, padding: "0 28px", borderRadius: 9999, background: "var(--accent)", color: "#fff", border: "none", fontSize: 15, fontWeight: 800, opacity: sendingFix ? 0.6 : 1, boxShadow: "0 8px 24px rgba(255,6,96,.3)", ...btnFont }}>
                {sendingFix ? "Saving correction" : idx + 1 < deck.length ? "Next card" : "Finish deck"}
                <span className="material-symbols-rounded" style={{ fontSize: 21 }}>arrow_forward</span>
              </button>
            </div>
          </div>
        )}

        {view === "drill" && shots.length > 0 && !current && (
          <div style={{ ...card, textAlign: "center", padding: 40, color: "var(--ink3)", fontSize: 13.5 }}>
            The current deck is empty. Open Build deck and pick at least one source.
          </div>
        )}

        {/* exit report */}
        {view === "report" && shots.length > 0 && (
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ width: 64, height: 64, margin: "0 auto 14px", borderRadius: 18, background: "var(--success-soft)", color: "var(--success-ink)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 34 }}>task_alt</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.02em" }}>Deck of {deck.length} card{deck.length === 1 ? "" : "s"}</div>
              <div style={{ fontSize: 14, color: "var(--ink2)", marginTop: 6 }}>
                {gradedCards.length ? `You graded ${gradedCards.length} of ${deck.length} cards this run.` : "Nothing graded yet, run through the deck first."}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
              <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: 20 }}>
                <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-.03em", color: "var(--success-ink)" }}>{strongN} / {deck.length}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4 }}>graded strong</div>
              </div>
              <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: 20 }}>
                <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-.03em", color: "var(--warning-ink)" }}>{weakCards.length}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4 }}>still weak</div>
              </div>
            </div>
            <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 12 }}>Weak items to revisit</div>
              {weakCards.map((f) => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--divider)" }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 18, color: grades[f.id] === "m" ? "var(--error-ink)" : "var(--warning-ink)" }}>error</span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{f.situation}</span>
                </div>
              ))}
              {!weakCards.length && <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>No weak grades in this deck.</div>}
            </div>
            {compiled ? (
              <button onClick={() => nav("pdsstudio")} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 9999, border: "none", background: "var(--success)", color: "#fff", fontSize: 15, fontWeight: 700, ...btnFont }}>
                <span className="material-symbols-rounded" style={{ fontSize: 20 }}>check</span>
                {compiled.version != null ? `Persona v${compiled.version} created · review in Calibration Room` : "New persona version created · review in Calibration Room"}
              </button>
            ) : (
              <>
                <button onClick={() => void compile()} disabled={!deltas.length || compiling} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 15, fontWeight: 700, opacity: deltas.length && !compiling ? 1 : 0.5, ...btnFont }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 20 }}>bolt</span>
                  {compiling ? "Compiling" : `Compile ${deltas.length} correction${deltas.length === 1 ? "" : "s"} into a new persona`}
                </button>
                {!deltas.length && <div style={{ fontSize: 12, color: "var(--ink3)", textAlign: "center", marginTop: 10 }}>Corrections come from weak or miss grades with a written correction.</div>}
              </>
            )}
          </div>
        )}
      </div>

      {/* deck builder side sheet */}
      {deckOpen && (
        <div onClick={() => setDeckOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40, background: scrim, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 380, maxWidth: "90%", height: "100%", background: "var(--card)", boxShadow: "var(--shadow)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--divider)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Build a drill deck</div>
              <button onClick={() => setDeckOpen(false)} style={{ marginLeft: "auto", width: 32, height: 32, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }}>
                <span className="material-symbols-rounded" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>
            <div className="pds-scroll" style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 10 }}>Source calls</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
                {allSrcs.map((s) => {
                  const on = pickedSrcs.includes(s);
                  return (
                    <button key={s} onClick={() => setPickedSrcs((p) => (on ? p.filter((x) => x !== s) : [...p, s]))} style={{ height: 36, padding: "0 13px", borderRadius: 9999, border: `1px solid ${on ? "var(--purple)" : "var(--border)"}`, background: on ? "var(--purple-soft)" : "transparent", color: on ? "var(--purple-ink)" : "var(--ink1)", fontSize: 12.5, fontWeight: 700, ...btnFont }}>{s}</button>
                  );
                })}
                {!allSrcs.length && <div style={{ fontSize: 12, color: "var(--ink3)" }}>no sources yet</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--divider)" }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>Weakness-first</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>Prioritize moments you graded weak or miss</div>
                </div>
                <button onClick={() => setWeakFirst(!weakFirst)} style={{ width: 46, height: 26, borderRadius: 9999, border: "none", cursor: "pointer", background: weakFirst ? "var(--purple)" : "var(--track)", position: "relative" }}>
                  <span style={{ position: "absolute", top: 2, left: weakFirst ? 22 : 2, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--divider)", opacity: 0.5 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>Red-team preset</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>Adversarial prompts, no generator wired yet</div>
                </div>
                <button disabled style={{ width: 46, height: 26, borderRadius: 9999, border: "none", cursor: "not-allowed", background: "var(--track)", position: "relative" }}>
                  <span style={{ position: "absolute", top: 2, left: 2, width: 22, height: 22, borderRadius: "50%", background: "#fff" }} />
                </button>
              </div>
            </div>
            <div style={{ padding: "16px 20px", borderTop: "1px solid var(--divider)" }}>
              <button onClick={startDeck} disabled={!buildDeck(shots, pickedSrcs, weakFirst, grades).length} style={{ width: "100%", height: 48, borderRadius: 9999, background: "var(--accent)", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, opacity: buildDeck(shots, pickedSrcs, weakFirst, grades).length ? 1 : 0.5, ...btnFont }}>
                Start deck · {buildDeck(shots, pickedSrcs, weakFirst, grades).length} card{buildDeck(shots, pickedSrcs, weakFirst, grades).length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
