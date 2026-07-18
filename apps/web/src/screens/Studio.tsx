import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Badge, Button, Icon, Panel, Tag, Switch, IconButton, ConfirmDialog, VoiceOrb } from "../ds";
import { api, getAccessKey } from "../api/client";
import { roleCategoryOf } from "@jarvis/shared";
import type { PersonaSpec, PersonaStyle, PersonaDelta, VerifyResult, CallPlaybook, CallStage } from "@jarvis/shared";

// Screen capabilities Maya actually has on the live product — assignable to a moment.
const CAPABILITIES: { tool: string; label: string }[] = [
  { tool: "new_position", label: "Create a new position" },
  { tool: "ask_perfect", label: "Send brief / message to Perfect AI" },
  { tool: "answer_question", label: "Answer a multiple-choice card" },
  { tool: "show_screen", label: "Navigate to a screen" },
  { tool: "read_screen", label: "Read the screen" },
  { tool: "start_matching", label: "Start matching" },
  { tool: "skip_candidate", label: "Skip a candidate" },
  { tool: "start_autopilot", label: "Start autopilot" },
];

// ============================================================
// Live Calibration Studio — talk to a cloned agent and tune it in real time.
// Config, not prompts: sliders/rules/phrases/few-shots -> versioned PersonaSpec
// -> compiled server-side. "Fix this" turns feedback into a spec delta. Pin
// Golden -> the live Zoom bridge reads it.
// ============================================================

type Agent = { id: string; name: string; role?: string; icon?: string; buildTrack?: string; persona?: PersonaSpec; golden_persona_id?: string };
type Turn = { id: string; role: "user" | "clone"; text: string; versionId?: string | null };
type VersionRow = { id: string; number: number; change_note: string; created_by: string; created_at: string };

const label: CSSProperties = { font: "var(--fw-semibold) 10px/1 var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 6, display: "block" };
const inputStyle: CSSProperties = { width: "100%", background: "rgba(4,12,22,0.6)", border: "1px solid var(--jv-border)", borderRadius: "var(--r-sm)", color: "var(--text-primary)", font: "var(--fw-regular) 13px/1.5 var(--font-body)", padding: "8px 12px", outline: "none", boxSizing: "border-box" };
const linkBtn: CSSProperties = { background: "none", border: "1px solid var(--jv-border-soft)", borderRadius: "var(--r-sm)", color: "var(--jv-cyan-300)", font: "10px var(--font-hud)", padding: "2px 8px", cursor: "pointer" };
const chipBtn: CSSProperties = { background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", borderRadius: "var(--r-pill)", color: "var(--text-secondary)", font: "10px var(--font-body)", padding: "2px 8px", cursor: "pointer" };
const lines = (arr: string[]) => arr.join("\n");
const toLines = (v: string) => v.split("\n");

const SLIDERS: { key: keyof PersonaStyle; anchors: [string, string, string] }[] = [
  { key: "formality", anchors: ["casual", "professional", "formal"] },
  { key: "verbosity", anchors: ["terse (1-2 sentences)", "balanced", "thorough"] },
  { key: "assertiveness", anchors: ["defers", "states views", "leads & recommends"] },
  { key: "warmth", anchors: ["neutral", "friendly", "empathetic"] },
  { key: "humor", anchors: ["none", "occasional", "personality-forward"] },
  { key: "proactivity", anchors: ["reactive", "one next step", "drives the agenda"] },
];
const anchorText = (v: number, a: [string, string, string]) => (v <= 0.33 ? a[0] : v <= 0.66 ? a[1] : a[2]);

const SCENARIOS = ["Hi, I saw your ads and I'm curious about AI for recruiting.", "Our acceptance rates dropped this month and renewal is coming up.", "How are you different from LinkedIn Recruiter?", "The outreach messages feel generic.", "Can you send me pricing?"];

// SSE reader for a calibration session message
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

export default function Studio() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [clone, setClone] = useState<Agent | null>(null);
  const [spec, setSpec] = useState<PersonaSpec | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [goldenId, setGoldenId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeVer, setActiveVer] = useState<string | null>(null);
  const [pendingVer, setPendingVer] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"sources" | "flow" | "persona" | "lexicon" | "rules" | "verify" | "versions">("sources");
  // Sources (note-takers)
  const [sources, setSources] = useState<{ id: string; title?: string; chars: number; created_at: string }[]>([]);
  const [openSrc, setOpenSrc] = useState<{ id: string; title?: string; transcript: string } | null>(null);
  const [srcBusy, setSrcBusy] = useState(false);
  // Call Flow (minute-by-minute moments)
  const [playbook, setPlaybook] = useState<CallPlaybook | null>(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowDirty, setFlowDirty] = useState(false);
  const [importSrcId, setImportSrcId] = useState<string>("");
  const [delta, setDelta] = useState<{ turnId: string; delta: PersonaDelta } | null>(null);
  const [verify, setVerify] = useState<{ average: number; results: VerifyResult[] } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [demo, setDemo] = useState(false);
  const [confirmGolden, setConfirmGolden] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sliderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { void loadAgents(); }, []);
  async function loadAgents() {
    try {
      const list = await api.get<Agent[]>("/api/agents");
      setAgents(list.filter((a) => a.buildTrack === "clone" || roleCategoryOf(a.role) !== "other"));
    } catch { /* ignore */ }
  }

  async function openClone(a: Agent) {
    setClone(a); setTurns([]); setVerify(null); setDelta(null);
    const full = await api.get<Agent>(`/api/agents`).then((l: any) => (l as Agent[]).find((x) => x.id === a.id) || a).catch(() => a);
    setSpec(full.persona && (full.persona as any).identity ? full.persona : null);
    await refreshVersions(a.id);
    void loadSources(a.id);
    void loadPlaybook(a.id);
    const s = await api.post<{ sessionId: string; activeVersionId: string | null }>("/api/sessions", { agentId: a.id }).catch(() => null);
    if (s) { setSessionId(s.sessionId); setActiveVer(s.activeVersionId); }
  }
  async function refreshVersions(agentId: string) {
    const v = await api.get<{ versions: VersionRow[]; goldenVersionId: string | null }>(`/api/clones/${agentId}/versions`).catch(() => null);
    if (v) { setVersions(v.versions); setGoldenId(v.goldenVersionId); }
  }

  // ---- Sources (note-takers) ----
  async function loadSources(agentId: string) {
    const r = await api.get<{ sources: typeof sources }>(`/api/clones/${agentId}/sources`).catch(() => null);
    if (r) setSources(r.sources);
  }
  async function openSource(id: string) {
    if (!clone) return;
    const r = await api.get<{ id: string; title?: string; transcript: string }>(`/api/clones/${clone.id}/sources/${id}`).catch(() => null);
    if (r) setOpenSrc({ id: r.id, title: r.title, transcript: r.transcript });
  }
  async function saveSource() {
    if (!clone || !openSrc) return;
    setSrcBusy(true);
    await api.put(`/api/clones/${clone.id}/sources/${openSrc.id}`, { title: openSrc.title, transcript: openSrc.transcript }).catch(() => {});
    await loadSources(clone.id); setSrcBusy(false); setOpenSrc(null);
  }
  async function deleteSource(id: string) {
    if (!clone) return;
    await api.del(`/api/clones/${clone.id}/sources/${id}`).catch(() => {});
    await loadSources(clone.id); if (openSrc?.id === id) setOpenSrc(null);
  }
  async function addSource() {
    if (!clone) return;
    const title = prompt("Title for this note-taker (e.g. 'Harbor Freight — Eli call'):") || "pasted";
    const transcript = prompt("Paste the transcript (or open it after to paste more):") || "";
    if (transcript.trim().length < 20) return;
    await api.post(`/api/clones/${clone.id}/sources`, { sources: [{ title, transcript }] }).catch(() => {});
    await loadSources(clone.id);
  }
  async function reExtract() {
    if (!clone) return; setExtracting(true);
    try {
      const r = await api.post<{ version: { spec: PersonaSpec } }>(`/api/clones/${clone.id}/persona/extract`, {});
      setSpec(r.version.spec); await refreshVersions(clone.id);
    } catch (e) { alert("Re-extract failed: " + (e instanceof Error ? e.message : e)); }
    setExtracting(false);
  }

  // ---- Call Flow (moments) ----
  async function loadPlaybook(agentId: string) {
    const r = await api.get<{ playbook: CallPlaybook }>(`/api/clones/${agentId}/playbook`).catch(() => null);
    if (r) { setPlaybook(r.playbook); setFlowDirty(false); }
  }
  async function importFlow() {
    if (!clone || !importSrcId) return;
    setFlowBusy(true);
    try {
      const r = await api.post<{ playbook: CallPlaybook }>(`/api/clones/${clone.id}/playbook/from-transcript`, { sourceId: importSrcId });
      setPlaybook(r.playbook); setFlowDirty(true);
    } catch (e) { alert("Import failed: " + (e instanceof Error ? e.message : e)); }
    setFlowBusy(false);
  }
  async function savePlaybook() {
    if (!clone || !playbook) return;
    setFlowBusy(true);
    const clean = (a: string[]) => a.map((x) => x.trim()).filter(Boolean);
    const norm: CallPlaybook = { ...playbook, stages: playbook.stages.map((s) => ({ ...s, voice: { ...s.voice, moves: clean(s.voice.moves), exampleLines: clean(s.voice.exampleLines), listenFor: clean(s.voice.listenFor) }, screen: { ...s.screen, actions: clean(s.screen.actions) } })) };
    await api.put(`/api/clones/${clone.id}/playbook`, { playbook: norm }).catch(() => {});
    setFlowBusy(false); setFlowDirty(false);
  }
  function mutateStage(i: number, patch: Partial<CallStage>) {
    if (!playbook) return;
    setPlaybook({ ...playbook, stages: playbook.stages.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
    setFlowDirty(true);
  }
  function moveStage(i: number, dir: -1 | 1) {
    if (!playbook) return;
    const j = i + dir; if (j < 0 || j >= playbook.stages.length) return;
    const st = [...playbook.stages]; [st[i], st[j]] = [st[j], st[i]];
    setPlaybook({ ...playbook, stages: st }); setFlowDirty(true);
  }
  function deleteStage(i: number) {
    if (!playbook) return;
    setPlaybook({ ...playbook, stages: playbook.stages.filter((_, k) => k !== i) }); setFlowDirty(true);
  }
  function addStage() {
    if (!playbook) return;
    const s: CallStage = { id: `st${Date.now().toString(36)}`, name: "New moment", goal: "", wireframe: { archetype: "none" as any, screenTitle: "", regions: [] }, voice: { objective: "", moves: [], exampleLines: [], listenFor: [] }, screen: { actions: [], waitBehavior: "" } };
    setPlaybook({ ...playbook, stages: [...playbook.stages, s] }); setFlowDirty(true);
  }

  const stage = useMemo(() => {
    if (!clone) return 0;
    if (!spec) return 0;                 // Ingest/Compile pending
    if (goldenId) return 3;              // Golden pinned
    return 2;                            // Calibrating
  }, [clone, spec, goldenId]);

  async function extract() {
    if (!clone) return;
    setExtracting(true);
    try {
      if (sourceText.trim().length > 200) {
        await api.post(`/api/clones/${clone.id}/sources`, { sources: [{ title: "pasted", transcript: sourceText }] });
      }
      const r = await api.post<{ version: { spec: PersonaSpec } }>(`/api/clones/${clone.id}/persona/extract`, {});
      setSpec(r.version.spec); setSourceText("");
      await refreshVersions(clone.id);
      const s = await api.post<{ sessionId: string; activeVersionId: string | null }>("/api/sessions", { agentId: clone.id });
      setSessionId(s.sessionId); setActiveVer(s.activeVersionId);
    } catch (e) { alert("Extraction failed: " + (e instanceof Error ? e.message : e)); }
    setExtracting(false);
  }

  // save a new version from the current spec (called after edits)
  async function commitSpec(next: PersonaSpec, note: string) {
    setSpec(next); setPendingVer(true);
    if (!clone || !sessionId) return;
    const r = await api.post<{ version: { id: string } }>(`/api/clones/${clone.id}/versions`, { spec: next, changeNote: note, sessionId }).catch(() => null);
    if (r) { setActiveVer(r.version.id); setPendingVer(false); await refreshVersions(clone.id); }
  }
  function setStyle(k: keyof PersonaStyle, v: number) {
    if (!spec) return;
    const next = { ...spec, style: { ...spec.style, [k]: v } };
    setSpec(next);
    if (sliderTimer.current) clearTimeout(sliderTimer.current);
    sliderTimer.current = setTimeout(() => commitSpec(next, `Set ${k} to ${v.toFixed(2)}`), 800);
  }

  async function send(text: string) {
    if (!sessionId || !text.trim() || busy) return;
    const clean = text.trim(); setInput("");
    setTurns((t) => [...t, { id: "u" + Date.now(), role: "user", text: clean }]);
    const cloneId = "c" + Date.now();
    setTurns((t) => [...t, { id: cloneId, role: "clone", text: "", versionId: activeVer }]);
    setBusy(true);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    let acc = "";
    try {
      await streamSession(sessionId, clean, (d) => { acc += d; setTurns((t) => t.map((x) => (x.id === cloneId ? { ...x, text: acc } : x))); if (demo) speak(d); }, ctrl.signal);
    } catch { /* aborted or error */ }
    setBusy(false);
    // Reconcile the temp clone-turn id with the real DB id so "Fix this" works.
    try {
      const { turns: server } = await api.get<{ turns: { id: string; role: string }[] }>(`/api/sessions/${sessionId}/turns`);
      const lastClone = [...server].reverse().find((t) => t.role === "clone");
      if (lastClone) setTurns((t) => t.map((x) => (x.id === cloneId ? { ...x, id: lastClone.id } : x)));
    } catch { /* ignore */ }
  }

  // ---- voice (Demo Mode): sentence-chunked TTS via ElevenLabs (/api/voice/speak), browser fallback ----
  const sentBuf = useRef("");
  const audioQ = useRef<HTMLAudioElement[]>([]);
  function speak(delta: string) {
    sentBuf.current += delta;
    const m = sentBuf.current.match(/^(.*?[.!?])\s(.*)$/s);
    if (m) { sentBuf.current = m[2]; void playSentence(m[1]); }
  }
  async function playSentence(text: string) {
    if (!text.trim()) return;
    try {
      const res = await fetch(`${api.base}/api/voice/speak`, { method: "POST", headers: { "Content-Type": "application/json", ...(getAccessKey() ? { "X-API-Key": getAccessKey() } : {}) }, body: JSON.stringify({ text, voiceId: spec?.voice?.elevenlabs_voice_id || undefined }) });
      if (!res.ok) throw new Error("tts");
      const url = URL.createObjectURL(await res.blob());
      const a = new Audio(url); audioQ.current.push(a);
      a.onended = () => { audioQ.current = audioQ.current.filter((x) => x !== a); URL.revokeObjectURL(url); };
      if (audioQ.current.length === 1) a.play().catch(() => {});
      else audioQ.current[audioQ.current.length - 2].addEventListener("ended", () => a.play().catch(() => {}));
    } catch {
      try { const u = new SpeechSynthesisUtterance(text); window.speechSynthesis.speak(u); } catch { /* ignore */ }
    }
  }
  function stopVoice() { audioQ.current.forEach((a) => { a.pause(); }); audioQ.current = []; try { window.speechSynthesis.cancel(); } catch {} sentBuf.current = ""; }

  // ---- mic (Web Speech API) ----
  const [listening, setListening] = useState(false);
  const recogRef = useRef<any>(null);
  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported in this browser."); return; }
    if (listening) { recogRef.current?.stop(); setListening(false); return; }
    const r = new SR(); recogRef.current = r; r.lang = "en-US"; r.interimResults = false;
    r.onresult = (e: any) => { const t = e.results[0][0].transcript; if (busy) { abortRef.current?.abort(); stopVoice(); } void send(t); };
    r.onend = () => setListening(false);
    r.start(); setListening(true);
  }

  async function askFix(turn: Turn, note: string) {
    if (!clone || !note.trim()) return;
    const r = await api.post<{ delta: PersonaDelta }>(`/api/turns/${turn.id}/feedback`, { rating: "down", note }).catch(() => null);
    if (r) setDelta({ turnId: turn.id, delta: r.delta });
  }
  async function applyDelta() {
    if (!clone || !delta) return;
    await api.post(`/api/clones/${clone.id}/apply-delta`, { delta: delta.delta, turnId: delta.turnId, sessionId });
    const full = await api.get<Agent[]>("/api/agents").then((l) => l.find((x) => x.id === clone.id)).catch(() => null);
    if (full?.persona) setSpec(full.persona);
    await refreshVersions(clone.id);
    setDelta(null);
  }

  async function runVerify() {
    if (!clone) return; setVerifying(true); setVerify(null);
    const r = await api.post<{ average: number; results: VerifyResult[] }>(`/api/verify/${clone.id}`, {}).catch(() => null);
    if (r) setVerify(r);
    setVerifying(false);
  }

  async function pinGolden() {
    if (!clone) return;
    await api.post(`/api/clones/${clone.id}/golden`, {});
    await refreshVersions(clone.id);
    setConfirmGolden(false);
  }

  // ---------- RENDER ----------
  if (demo && clone) return <DemoMode clone={clone} turns={turns} busy={busy} listening={listening} onMic={toggleMic} onExit={() => { setDemo(false); stopVoice(); }} />;

  if (!clone) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 4px", color: "var(--text-primary)", font: "var(--fw-semibold) 20px/1.2 var(--font-body)" }}>Calibration Studio</h2>
        <p style={{ color: "var(--text-muted)", font: "13px/1.6 var(--font-body)", margin: "0 0 18px" }}>Pick a clone to calibrate. Talk to it, tune it live, verify it against the real calls, then Pin Golden — the live Zoom demo uses the golden persona.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {agents.map((a) => (
            <Panel key={a.id} style={{ cursor: "pointer" }} onClick={() => openClone(a)}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Icon name={a.icon || "bot"} size={20} color="var(--jv-cyan)" />
                <div>
                  <div style={{ color: "var(--text-primary)", font: "var(--fw-semibold) 14px/1.2 var(--font-body)" }}>{a.name}</div>
                  <div style={{ color: "var(--text-muted)", font: "12px/1.4 var(--font-body)" }}>{a.role || "—"}</div>
                </div>
                {a.golden_persona_id ? <Badge status="optimal" style={{ marginLeft: "auto" }}>Golden</Badge> : null}
              </div>
            </Panel>
          ))}
          {!agents.length && <div style={{ color: "var(--text-muted)" }}>No AE/CS clones yet — create one in Agents → New Agent (clone track).</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Cloning timeline */}
      <Timeline stage={stage} />
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--jv-border-soft)" }}>
        <IconButton icon="arrow-left" title="Back" onClick={() => setClone(null)} />
        <Icon name={clone.icon || "bot"} size={18} color="var(--jv-cyan)" />
        <b style={{ color: "var(--text-primary)" }}>{clone.name}</b>
        <span style={{ color: "var(--text-muted)", font: "12px var(--font-body)" }}>{clone.role}</span>
        {activeVer && <Tag>v{versions.find((v) => v.id === activeVer)?.number ?? "?"}</Tag>}
        {pendingVer && <Badge status="warn">saving…</Badge>}
        <div style={{ flex: 1 }} />
        <Button variant="ghost" icon={<Icon name="play" size={14} />} onClick={() => setDemo(true)}>Demo Mode</Button>
        <Button variant="primary" icon={<Icon name="star" size={14} />} onClick={() => setConfirmGolden(true)} disabled={!spec}>Pin Golden</Button>
      </div>

      {!spec ? (
        <div style={{ padding: 24, maxWidth: 720 }}>
          <Panel title="Ingest → Compile: learn the persona from calls">
            <p style={{ color: "var(--text-muted)", font: "13px/1.6 var(--font-body)" }}>Paste a call transcript (or several — one at a time) from this person's real calls, then extract. The clone learns their style, phrases, and how they handled real moments.</p>
            <textarea value={sourceText} onChange={(e) => setSourceText(e.target.value)} rows={10} placeholder="Paste a Fathom transcript…" style={{ ...inputStyle, resize: "vertical", minHeight: 160 }} />
            <div style={{ marginTop: 10 }}>
              <Button variant="primary" disabled={extracting} icon={<Icon name="sparkles" size={14} />} onClick={extract}>{extracting ? "Extracting…" : "Extract persona"}</Button>
            </div>
          </Panel>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "60% 40%", flex: 1, minHeight: 0 }}>
          {/* Conversation */}
          <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--jv-border-soft)", minHeight: 0 }}>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {turns.map((t) => (
                <div key={t.id} style={{ alignSelf: t.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%" }}>
                  <div style={{ background: t.role === "user" ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)", border: `1px solid ${t.role === "user" ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`, borderRadius: 12, padding: "8px 12px", color: "var(--text-primary)", font: "14px/1.5 var(--font-body)", whiteSpace: "pre-wrap" }}>{t.text || (busy ? "…" : "")}</div>
                  {t.role === "clone" && t.text && (
                    <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                      {t.versionId && <span style={{ color: "var(--text-faint)", font: "10px var(--font-hud)" }}>v{versions.find((v) => v.id === t.versionId)?.number ?? "?"}</span>}
                      <button onClick={() => { const note = prompt("What should the clone have done differently? (or paste the ideal line)"); if (note) void askFix(t, note); }} style={{ background: "none", border: "1px solid var(--jv-border-soft)", borderRadius: "var(--r-sm)", color: "var(--jv-cyan-300)", font: "10px var(--font-hud)", padding: "2px 8px", cursor: "pointer" }}>Fix this</button>
                    </div>
                  )}
                </div>
              ))}
              {!turns.length && <div style={{ color: "var(--text-muted)", font: "13px var(--font-body)" }}>Say hello, or use a scenario below to jump to a hard moment.</div>}
            </div>
            <div style={{ borderTop: "1px solid var(--jv-border-soft)", padding: 10 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {SCENARIOS.map((s, i) => <button key={i} onClick={() => send(s)} style={{ background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", borderRadius: "var(--r-pill)", color: "var(--text-secondary)", font: "11px var(--font-body)", padding: "3px 10px", cursor: "pointer" }}>{s.slice(0, 28)}…</button>)}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(input); }} placeholder="Message the clone…" style={{ ...inputStyle, height: 40 }} />
                <IconButton icon={listening ? "mic" : "mic-off"} title="Mic" tone={listening ? "cyan" : "muted"} size={40} onClick={toggleMic} />
                <Button variant="primary" onClick={() => send(input)} disabled={busy}>Send</Button>
              </div>
            </div>
          </div>

          {/* Tuning */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", gap: 4, padding: "8px 10px", borderBottom: "1px solid var(--jv-border-soft)", flexWrap: "wrap" }}>
              {(["sources", "flow", "persona", "lexicon", "rules", "verify", "versions"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "var(--grad-cyan-soft)" : "transparent", border: `1px solid ${tab === t ? "var(--jv-border-cyan)" : "transparent"}`, borderRadius: "var(--r-sm)", color: tab === t ? "var(--jv-cyan-100)" : "var(--text-muted)", font: "var(--fw-semibold) 11px var(--font-hud)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "5px 10px", cursor: "pointer" }}>{t}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
              {tab === "sources" && (openSrc ? (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <IconButton icon="arrow-left" title="Back to list" onClick={() => setOpenSrc(null)} />
                    <input value={openSrc.title || ""} onChange={(e) => setOpenSrc({ ...openSrc, title: e.target.value })} placeholder="Title" style={{ ...inputStyle, height: 34 }} />
                  </div>
                  <textarea value={openSrc.transcript} onChange={(e) => setOpenSrc({ ...openSrc, transcript: e.target.value })} rows={22} style={{ ...inputStyle, resize: "vertical", minHeight: 360, fontFamily: "var(--font-mono)", fontSize: 12 }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Button variant="primary" disabled={srcBusy} onClick={saveSource}>{srcBusy ? "Saving…" : "Save changes"}</Button>
                    <Button variant="ghost" onClick={() => setOpenSrc(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={label}>Note-takers ({sources.length})</span>
                    <div style={{ flex: 1 }} />
                    <Button variant="ghost" icon={<Icon name="plus" size={12} />} onClick={addSource}>Add</Button>
                    <Button variant="secondary" disabled={extracting} icon={<Icon name="sparkles" size={12} />} onClick={reExtract}>{extracting ? "Re-extracting…" : "Re-extract persona"}</Button>
                  </div>
                  <p style={{ color: "var(--text-muted)", font: "12px/1.5 var(--font-body)", marginBottom: 10 }}>The real calls Maya learns from. Open one to read or edit it; Re-extract folds edits into her persona.</p>
                  {sources.map((s) => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--jv-border-soft)" }}>
                      <Icon name="file-text" size={14} color="var(--jv-cyan)" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "var(--text-secondary)", font: "12px var(--font-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title || s.id}</div>
                        <span style={{ color: "var(--text-faint)", font: "10px var(--font-hud)" }}>{(s.chars / 1000).toFixed(1)}k chars</span>
                      </div>
                      <button onClick={() => openSource(s.id)} style={linkBtn}>Open</button>
                      <button onClick={() => { if (confirm("Delete this note-taker?")) void deleteSource(s.id); }} style={{ ...linkBtn, color: "#ff8080" }}>Delete</button>
                    </div>
                  ))}
                  {!sources.length && <div style={{ color: "var(--text-faint)", font: "12px var(--font-body)" }}>No note-takers yet — Add one.</div>}
                </div>
              ))}
              {tab === "flow" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                    <span style={label}>Call flow — moment by moment</span>
                    <div style={{ flex: 1 }} />
                    {flowDirty && <Badge status="warn">unsaved</Badge>}
                    <Button variant="primary" disabled={flowBusy || !flowDirty} icon={<Icon name="save" size={12} />} onClick={savePlaybook}>{flowBusy ? "Saving…" : "Save flow"}</Button>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <select value={importSrcId} onChange={(e) => setImportSrcId(e.target.value)} style={{ ...inputStyle, height: 32, width: "auto", flex: 1, minWidth: 120 }}>
                      <option value="">Build flow from a call…</option>
                      {sources.map((s) => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
                    </select>
                    <Button variant="secondary" disabled={flowBusy || !importSrcId} icon={<Icon name="sparkles" size={12} />} onClick={importFlow}>{flowBusy ? "Reading…" : "Import"}</Button>
                  </div>
                  <p style={{ color: "var(--text-muted)", font: "11px/1.5 var(--font-body)", marginBottom: 10 }}>Each moment is what Maya <b>says</b> (VOICE) and what she <b>does on screen</b> (SCREEN). Import a real call to draft it, then edit. Save folds it into the persona; Pin Golden pushes it live.</p>
                  {(playbook?.stages || []).map((s, i) => (
                    <Panel key={s.id} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <span style={{ color: "var(--jv-cyan)", font: "var(--fw-bold) 11px var(--font-hud)" }}>{i + 1}</span>
                        <input value={s.name} onChange={(e) => mutateStage(i, { name: e.target.value })} style={{ ...inputStyle, height: 30, font: "var(--fw-semibold) 13px var(--font-body)" }} />
                        <IconButton icon="chevron-up" title="Up" size={26} onClick={() => moveStage(i, -1)} />
                        <IconButton icon="chevron-down" title="Down" size={26} onClick={() => moveStage(i, 1)} />
                        <IconButton icon="trash" title="Delete" size={26} onClick={() => deleteStage(i)} />
                      </div>
                      <input value={s.goal} onChange={(e) => mutateStage(i, { goal: e.target.value })} placeholder="Goal of this moment" style={{ ...inputStyle, height: 30, marginBottom: 8 }} />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <span style={label}>🗣 Voice — what she says</span>
                          <input value={s.voice.objective} onChange={(e) => mutateStage(i, { voice: { ...s.voice, objective: e.target.value } })} placeholder="Objective" style={{ ...inputStyle, height: 28, marginBottom: 4 }} />
                          <textarea value={lines(s.voice.exampleLines)} onChange={(e) => mutateStage(i, { voice: { ...s.voice, exampleLines: toLines(e.target.value) } })} placeholder="Example lines (one per line)" rows={4} style={{ ...inputStyle, resize: "vertical", fontSize: 12 }} />
                          <textarea value={lines(s.voice.listenFor)} onChange={(e) => mutateStage(i, { voice: { ...s.voice, listenFor: toLines(e.target.value) } })} placeholder="Listen for… (one per line)" rows={2} style={{ ...inputStyle, resize: "vertical", fontSize: 12, marginTop: 4 }} />
                        </div>
                        <div>
                          <span style={label}>🖥 Screen — what she does</span>
                          <textarea value={lines(s.screen.actions)} onChange={(e) => mutateStage(i, { screen: { ...s.screen, actions: toLines(e.target.value) } })} placeholder="Screen actions (one per line)" rows={4} style={{ ...inputStyle, resize: "vertical", fontSize: 12 }} />
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, margin: "4px 0" }}>
                            {CAPABILITIES.map((c) => <button key={c.tool} title={c.tool} onClick={() => mutateStage(i, { screen: { ...s.screen, actions: [...s.screen.actions, c.label] } })} style={chipBtn}>+ {c.label}</button>)}
                          </div>
                          <input value={s.screen.waitBehavior} onChange={(e) => mutateStage(i, { screen: { ...s.screen, waitBehavior: e.target.value } })} placeholder="While the screen works…" style={{ ...inputStyle, height: 28 }} />
                        </div>
                      </div>
                    </Panel>
                  ))}
                  <button onClick={addStage} style={{ background: "transparent", border: "1px dashed var(--jv-border)", borderRadius: "var(--r-sm)", color: "var(--text-muted)", font: "11px var(--font-hud)", padding: "6px 10px", cursor: "pointer" }}>+ add moment</button>
                  {!(playbook?.stages || []).length && <div style={{ color: "var(--text-faint)", font: "12px var(--font-body)", marginTop: 8 }}>No flow yet — Import one from a call above.</div>}
                </div>
              )}
              {tab === "persona" && (
                <div>
                  {SLIDERS.map(({ key, anchors }) => (
                    <div key={key} style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={label}>{key}</span>
                        <span style={{ color: "var(--text-muted)", font: "11px var(--font-mono)" }}>{spec.style[key].toFixed(2)}</span>
                      </div>
                      <input type="range" min={0} max={1} step={0.01} value={spec.style[key]} onChange={(e) => setStyle(key, parseFloat(e.target.value))} style={{ width: "100%", accentColor: "var(--jv-cyan)" }} />
                      <div style={{ color: "var(--text-faint)", font: "11px var(--font-body)" }}>{anchorText(spec.style[key], anchors)}</div>
                    </div>
                  ))}
                </div>
              )}
              {tab === "lexicon" && (
                <div>
                  <span style={label}>Signature phrases ({spec.lexicon.signature_phrases.length})</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                    {spec.lexicon.signature_phrases.map((p, i) => <div key={i} title={p.source} style={{ background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", borderRadius: "var(--r-sm)", padding: "5px 8px", color: "var(--text-secondary)", font: "12px var(--font-body)" }}>"{p.text}"</div>)}
                  </div>
                  <span style={label}>Never say</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>{spec.lexicon.banned_phrases.map((b, i) => <Tag key={i} priority="critical">{b}</Tag>)}</div>
                  <span style={label}>Vocabulary notes</span>
                  <div style={{ color: "var(--text-secondary)", font: "12px/1.5 var(--font-body)" }}>{spec.lexicon.vocabulary_notes || "—"}</div>
                </div>
              )}
              {tab === "rules" && (
                <div>
                  {spec.behaviors.rules.map((r, i) => (
                    <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "start", marginBottom: 8 }}>
                      <Switch checked={r.active} onChange={(v) => { const next = { ...spec, behaviors: { ...spec.behaviors, rules: spec.behaviors.rules.map((x, k) => k === i ? { ...x, active: v } : x) } }; commitSpec(next, `${v ? "Enable" : "Disable"} rule ${r.id}`); }} />
                      <div style={{ flex: 1 }}><div style={{ color: "var(--text-secondary)", font: "12px/1.5 var(--font-body)" }}>{r.text}</div>{r.source && <span style={{ color: "var(--text-faint)", font: "10px var(--font-hud)" }}>{r.source}</span>}</div>
                    </div>
                  ))}
                  <button onClick={() => { const t = prompt("New rule (plain language):"); if (t) { const next = { ...spec, behaviors: { ...spec.behaviors, rules: [...spec.behaviors.rules, { id: `r${spec.behaviors.rules.length + 1}`, text: t, source: "manual", active: true }] } }; commitSpec(next, "Added a rule"); } }} style={{ background: "transparent", border: "1px dashed var(--jv-border)", borderRadius: "var(--r-sm)", color: "var(--text-muted)", font: "11px var(--font-hud)", padding: "6px 10px", cursor: "pointer" }}>+ add rule</button>
                  {!spec.behaviors.rules.length && <div style={{ color: "var(--text-faint)", font: "12px var(--font-body)", marginTop: 8 }}>No rules yet. Use "Fix this" on a bad turn to generate one.</div>}
                </div>
              )}
              {tab === "verify" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <Button variant="secondary" disabled={verifying} icon={<Icon name="badge-check" size={14} />} onClick={runVerify}>{verifying ? "Replaying…" : "Verify vs. the calls"}</Button>
                    {verify && <Badge status={verify.average >= 0.7 ? "optimal" : verify.average >= 0.5 ? "warn" : "critical"}>match {(verify.average * 100).toFixed(0)}%</Badge>}
                  </div>
                  <p style={{ color: "var(--text-muted)", font: "12px/1.5 var(--font-body)", marginBottom: 10 }}>Replays real moments from the note‑takers and compares the clone's answer to how the human actually handled it.</p>
                  {verify?.results.map((r, i) => (
                    <Panel key={i} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b style={{ color: "var(--text-primary)", font: "12px var(--font-body)" }}>{r.situation}</b><Badge status={r.score >= 0.7 ? "optimal" : r.score >= 0.5 ? "warn" : "critical"}>{(r.score * 100).toFixed(0)}%</Badge></div>
                      <div style={{ marginTop: 6 }}><span style={label}>Human</span><div style={{ color: "var(--text-secondary)", font: "12px/1.5 var(--font-body)" }}>{r.humanResponse}</div></div>
                      <div style={{ marginTop: 6 }}><span style={label}>Clone</span><div style={{ color: "var(--text-secondary)", font: "12px/1.5 var(--font-body)" }}>{r.cloneResponse}</div></div>
                      {r.note && <div style={{ color: "var(--text-faint)", font: "11px/1.4 var(--font-body)", marginTop: 4 }}>{r.note}{r.source ? ` · ${r.source}` : ""}</div>}
                    </Panel>
                  ))}
                </div>
              )}
              {tab === "versions" && (
                <div>
                  {[...versions].reverse().map((v) => (
                    <div key={v.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--jv-border-soft)" }}>
                      <span style={{ color: activeVer === v.id ? "var(--jv-cyan)" : "var(--text-muted)", font: "var(--fw-bold) 12px var(--font-hud)", width: 34 }}>v{v.number}</span>
                      <div style={{ flex: 1 }}><div style={{ color: "var(--text-secondary)", font: "12px var(--font-body)" }}>{v.change_note}</div><span style={{ color: "var(--text-faint)", font: "10px var(--font-hud)" }}>{v.created_by}</span></div>
                      {goldenId === v.id ? <Badge status="optimal">Golden</Badge> : <button onClick={() => api.post(`/api/clones/${clone.id}/golden`, { versionId: v.id }).then(() => refreshVersions(clone.id))} style={{ background: "none", border: "1px solid var(--jv-border-soft)", borderRadius: "var(--r-sm)", color: "var(--jv-cyan-300)", font: "10px var(--font-hud)", padding: "2px 8px", cursor: "pointer" }}>Pin</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Feedback delta drawer */}
      {delta && (
        <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: 420, background: "var(--jv-bg)", borderLeft: "1px solid var(--jv-border-cyan)", boxShadow: "-8px 0 32px rgba(0,0,0,.5)", zIndex: 1000, padding: 18, overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><b style={{ color: "var(--text-primary)" }}>Proposed change</b><IconButton icon="x" title="Discard" onClick={() => setDelta(null)} /></div>
          <div style={{ color: "var(--text-secondary)", font: "13px/1.6 var(--font-body)", marginBottom: 12 }}>{delta.delta.summary}</div>
          <pre style={{ background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", borderRadius: "var(--r-sm)", padding: 10, color: "var(--jv-green)", font: "11px/1.5 var(--font-mono)", whiteSpace: "pre-wrap" }}>{JSON.stringify(delta.delta, null, 2)}</pre>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button variant="primary" onClick={applyDelta}>Apply</Button>
            <Button variant="ghost" onClick={() => setDelta(null)}>Discard</Button>
          </div>
        </div>
      )}

      <ConfirmDialog open={confirmGolden} title="Pin this as Golden?" message="The compiled golden persona becomes what the live Zoom demo runs. You can re-pin any version later." confirmLabel="Pin Golden" onConfirm={pinGolden} onCancel={() => setConfirmGolden(false)} />
    </div>
  );
}

function Timeline({ stage }: { stage: number }) {
  const steps = ["Ingest", "Compile", "Calibrate", "Golden", "Demo"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderBottom: "1px solid var(--jv-border-soft)", background: "var(--jv-void)" }}>
      {steps.map((s, i) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: i <= stage ? 1 : 0.4 }}>
            <span style={{ width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", background: i < stage ? "var(--jv-cyan)" : i === stage ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)", border: `1px solid ${i <= stage ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`, color: i < stage ? "var(--accent-contrast)" : "var(--jv-cyan)", font: "var(--fw-bold) 10px var(--font-hud)" }}>{i < stage ? "✓" : i + 1}</span>
            <span style={{ color: i === stage ? "var(--jv-cyan-100)" : "var(--text-muted)", font: `${i === stage ? "var(--fw-semibold)" : "var(--fw-regular)"} 11px var(--font-hud)`, letterSpacing: "0.06em", textTransform: "uppercase" }}>{s}</span>
          </div>
          {i < steps.length - 1 && <span style={{ width: 24, height: 1, background: "var(--jv-border-soft)" }} />}
        </div>
      ))}
    </div>
  );
}

function DemoMode({ clone, turns, busy, listening, onMic, onExit }: { clone: Agent; turns: Turn[]; busy: boolean; listening: boolean; onMic: () => void; onExit: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.metaKey && e.shiftKey && (e.key === "e" || e.key === "E")) onExit(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);
  const last = [...turns].reverse().find((t) => t.role === "clone");
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--jv-void)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, zIndex: 2000 }}>
      <VoiceOrb listening={busy || listening} size={140} onClick={onMic} />
      <div style={{ color: "var(--text-primary)", font: "var(--fw-semibold) 22px var(--font-body)" }}>{clone.name}</div>
      <div style={{ maxWidth: 640, textAlign: "center", color: "var(--text-secondary)", font: "16px/1.6 var(--font-body)", minHeight: 60 }}>{last?.text || (listening ? "Listening…" : "Tap the mic and start talking.")}</div>
      <div style={{ display: "flex", gap: 12 }}>
        <IconButton icon={listening ? "mic" : "mic-off"} title="Talk" tone={listening ? "cyan" : "muted"} size={56} onClick={onMic} />
      </div>
      <div style={{ position: "fixed", bottom: 12, color: "var(--text-faint)", font: "10px var(--font-hud)" }}>⌘⇧E to exit</div>
    </div>
  );
}
