import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api, getAccessKey } from "../api/client";
import type { PersonaSpec, PersonaStyle, NewAgent, CallPlaybook } from "@jarvis/shared";
import "../pds.css";

// ============================================================
// Clone a rep — 5-step cloning flow from the Perfect Design
// System 2026 (Clone a Rep.dc.html). Identity -> Sources ->
// Extraction review -> Voice -> Confirm. Wired to the real
// clone API: POST /api/agents (clone track), POST sources,
// POST persona/extract (slow, awaited honestly), review the
// returned PersonaSpec, then hand off to the calibration
// studio via pds-nav with pds_agent set.
//
// Chrome re-skinned to the afterhuman-ui-mockup wizard: .pmx root,
// .app shell, .stepper / .wizcard / .field / .quicktoggle / .wizfoot.
// All step logic, state, refs, effects and API calls are preserved.
// ============================================================

type Agent = {
  id: string; name: string; role?: string; icon?: string; status?: string;
  buildTrack?: string; persona?: PersonaSpec; golden_persona_id?: string; voice_id?: string;
};
type SourceRow = { id: string; title?: string; kind?: string; url?: string; chars: number; created_at: string };
type Correction = { stageId: string; kind: string; before: string; after: string; why: string };
type Pending = { title: string; transcript: string; url?: string };
type VoiceOpt = { id: string; name: string; tagline: string; gender: string; accent: string; age: string; category: string; previewUrl: string };

const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const kChars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const STEP_DEFS = [
  { n: 1, label: "Identity" }, { n: 2, label: "Sources" }, { n: 3, label: "Extraction" },
  { n: 4, label: "Voice" }, { n: 5, label: "Confirm" },
] as const;

// Style vector captions — thresholds match the design (under .4 / under .7 / above)
const STYLE_META: { key: keyof PersonaStyle; label: string; caps: [string, string, string] }[] = [
  { key: "warmth", label: "Warmth", caps: ["Reserved and businesslike, warms up slowly.", "Friendly but focused, keeps the call moving.", "Warm and personable, opens with genuine rapport."] },
  { key: "assertiveness", label: "Assertiveness", caps: ["Defers to the customer's lead.", "Guides while staying collaborative.", "Confidently steers the call toward next steps."] },
  { key: "verbosity", label: "Verbosity", caps: ["Terse, one or two sentences at a time.", "Balanced, explains the why then the specifics.", "Thorough, walks through every number."] },
  { key: "formality", label: "Formality", caps: ["Casual and plain-spoken, first-name energy.", "Professional with a light, human touch.", "Polished and formal throughout."] },
  { key: "humor", label: "Humor", caps: ["Keeps it straight, no jokes.", "An occasional light touch when it fits.", "Personality-forward, quick with a quip."] },
  { key: "proactivity", label: "Proactivity", caps: ["Reactive, answers what is asked.", "Offers one clear next step.", "Drives the agenda across the call."] },
];
const caption = (v: number, caps: [string, string, string]) => (v < 0.4 ? caps[0] : v < 0.7 ? caps[1] : caps[2]);

const PASS_DEFS = [
  { icon: "graphic_eq", label: "Reading transcripts" },
  { icon: "groups", label: "Diarizing speakers" },
  { icon: "segment", label: "Segmenting turns" },
  { icon: "tune", label: "Extracting style vector" },
  { icon: "format_quote", label: "Mining signature phrases" },
  { icon: "database", label: "Setting knowledge boundaries" },
  { icon: "chat_paste_go", label: "Selecting few-shot examples" },
];

const kicker: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 10 };
const h1S: CSSProperties = { margin: "0 0 8px", fontSize: 30, fontWeight: 600, letterSpacing: "-.02em" };
const leadS: CSSProperties = { margin: "0 0 24px", fontSize: 15, color: "var(--ink2)", lineHeight: 1.5 };
const cardS: CSSProperties = { background: "var(--card)", borderRadius: 20, boxShadow: "var(--shadow)" };
const lblS: CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink2)", marginBottom: 6 };
const pillS: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 9999 };
const secHead: CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 };
const secTitle: CSSProperties = { fontSize: 16, fontWeight: 600 };
const secSub: CSSProperties = { fontSize: 12.5, color: "var(--ink3)", marginBottom: 16 };
const btnFont: CSSProperties = { fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const provS: CSSProperties = { fontSize: 11, color: "var(--ink3)", display: "flex", alignItems: "center", gap: 5 };

export default function CloneARep() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [step, setStep] = useState(1);
  // Quick clone: skip the review/voice/confirm steps, use smart defaults, and
  // hand straight to the orchestrator. The one create flow, in two depths.
  const [quick, setQuick] = useState(true);
  // step 1 — company branding (org-level: the logo shown on the shared screen)
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [logoNote, setLogoNote] = useState("");
  useEffect(() => {
    void api.get<{ logo?: string }>("/api/company").then((c) => setCompanyLogo(c.logo || null)).catch(() => { /* fine */ });
  }, []);
  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setLogoNote("That's not an image file."); return; }
    if (file.size > 280_000) { setLogoNote("Keep the logo under ~280KB (SVG or a small PNG works best)."); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const uri = String(rd.result || "");
      void api.put<{ logo?: string; logoError?: string }>("/api/company", { logo: uri }).then((r) => {
        if (r.logoError) { setLogoNote(r.logoError); return; }
        setCompanyLogo(r.logo || null);
        setLogoNote("Logo saved — it brands the shared screen on every call.");
        setTimeout(() => setLogoNote(""), 6000);
      }).catch(() => setLogoNote("Save failed — try again."));
    };
    rd.readAsDataURL(file);
  }

  // step 1 — identity (name + role are saved to the agent; the rest stays local)
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [team, setTeam] = useState("");
  const [tz, setTz] = useState("");
  // agent + sources
  const [agent, setAgent] = useState<Agent | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [filterQ, setFilterQ] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  // extraction
  const [spec, setSpec] = useState<PersonaSpec | null>(null);
  const [verNum, setVerNum] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [passIdx, setPassIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  // voice + confirm
  const [playing, setPlaying] = useState(false);
  const [playbook, setPlaybook] = useState<CallPlaybook | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // per-agent demo login — the GoPerfect account THIS clone signs into on every
  // rehearsal and live call. inherited=true means it's still falling back to the
  // shared/global default because this clone has no own login yet. Saved via
  // PUT /api/clones/:agentId/demo-login (password write-only; omit to keep it).
  const [demoEmail, setDemoEmail] = useState("");
  const [demoHasPw, setDemoHasPw] = useState(false);
  const [demoInherited, setDemoInherited] = useState(false);
  const [demoPw, setDemoPw] = useState("");
  const [demoLoaded, setDemoLoaded] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoNote, setDemoNote] = useState<{ ok: boolean; text: string } | null>(null);

  // theme-conditional values for tokens that exist in the design but not in pds.css
  const T = theme === "dark"
    ? { logo: "#2A2A8A", grad: "radial-gradient(circle at 30% 30%, rgba(255,6,96,.4), rgba(163,66,255,.35))", scrim: "rgba(2,2,18,.66)", decorSoft: "rgba(0,187,255,.18)", inputBg: "rgba(255,255,255,.05)" }
    : { logo: "#000072", grad: "radial-gradient(circle at 30% 30%, #FFE0EB, #F1E3FF)", scrim: "rgba(0,0,64,.4)", decorSoft: "#D6F3FF", inputBg: "#FFFFFF" };
  const inputS: CSSProperties = { width: "100%", height: 46, padding: "0 16px", borderRadius: 16, border: "2px solid var(--border)", background: T.inputBg, color: "var(--ink1)", fontSize: 15, fontWeight: 500, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };

  // Resume ONLY an unfinished wizard draft (clonerep_draft is set when this
  // wizard creates an agent and cleared when creation finishes). The shared
  // pds_agent selection must NOT leak in here — resuming the roster's current
  // agent silently made "new" clones re-extract an existing one (Maya incident).
  useEffect(() => {
    void (async () => {
      // explicit deep-link (e.g. roster "Sources") beats everything, works for
      // certified clones too, and is consumed one-shot
      let openReq: { agentId?: string; step?: number } | null = null;
      try { const raw = localStorage.getItem("clonerep_open"); if (raw) { openReq = JSON.parse(raw); localStorage.removeItem("clonerep_open"); } } catch { /* ignore */ }
      let stored: string | null = null;
      try { stored = localStorage.getItem("clonerep_draft"); } catch { /* ignore */ }
      const targetId = openReq?.agentId ?? stored;
      if (!targetId) return;
      const list = await api.get<Agent[]>("/api/agents").catch(() => [] as Agent[]);
      const found = list.find((a) => a.id === targetId);
      if (found && found.buildTrack === "clone" && (openReq ? true : !found.golden_persona_id)) {
        setAgent(found);
        setName(found.name);
        setRole(found.role ?? "");
        if (found.persona && found.persona.identity) {
          setSpec(found.persona);
          if (found.persona.identity.company) setCompany(found.persona.identity.company);
        }
        void loadSources(found.id);
        if (openReq?.step && openReq.step >= 1 && openReq.step <= 5) setStep(openReq.step);
      } else if (!openReq) {
        try { localStorage.removeItem("clonerep_draft"); } catch { /* ignore */ }
      }
    })();
  }, []);

  // Indicative pass progression while the one extraction job runs server-side
  useEffect(() => {
    if (!extracting) return;
    setPassIdx(0);
    const t = setInterval(() => setPassIdx((i) => Math.min(i + 1, PASS_DEFS.length - 1)), 9000);
    return () => clearInterval(t);
  }, [extracting]);

  // Playbook gate is only needed on the confirm step
  useEffect(() => {
    if (step !== 5 || !agent) return;
    void api.get<{ playbook: CallPlaybook }>(`/api/clones/${agent.id}/playbook`).then((r) => setPlaybook(r.playbook)).catch(() => setPlaybook(null));
  }, [step, agent]);

  // Pre-fill this clone's demo login on the confirm step (once the agent exists).
  useEffect(() => {
    if (step !== 5 || !agent) return;
    setDemoLoaded(false); setDemoNote(null);
    void api.get<{ email: string; hasPassword: boolean; inherited: boolean }>(`/api/clones/${agent.id}/demo-login`)
      .then((r) => { setDemoEmail(r.email || ""); setDemoHasPw(!!r.hasPassword); setDemoInherited(!!r.inherited); })
      .catch(() => { /* leave empty — nothing set yet */ })
      .finally(() => setDemoLoaded(true));
  }, [step, agent]);

  // Save THIS clone's demo login. Send `password` only when a new one was typed,
  // so an email-only edit never wipes the stored password. Saving turns the
  // inherited shared-default fallback into this clone's own login.
  async function saveDemoLogin() {
    if (!agent || demoBusy) return;
    const e = demoEmail.trim();
    if (!e || !e.includes("@")) { setDemoNote({ ok: false, text: "Enter a valid email." }); return; }
    // An inherited clone has no OWN password yet, so the first override must set one.
    if (!(demoHasPw && !demoInherited) && !demoPw) { setDemoNote({ ok: false, text: "Set a password — this clone has none yet." }); return; }
    setDemoBusy(true); setDemoNote(null);
    try {
      await api.put(`/api/clones/${agent.id}/demo-login`, { email: e, ...(demoPw ? { password: demoPw } : {}) });
      setDemoPw("");
      const r = await api.get<{ email: string; hasPassword: boolean; inherited: boolean }>(`/api/clones/${agent.id}/demo-login`).catch(() => null);
      if (r) { setDemoEmail(r.email || ""); setDemoHasPw(!!r.hasPassword); setDemoInherited(!!r.inherited); }
      setDemoNote({ ok: true, text: "Saved — this clone signs in with this account." });
    } catch (ex) { setDemoNote({ ok: false, text: ex instanceof Error ? ex.message : String(ex) }); }
    setDemoBusy(false);
  }

  async function loadSources(agentId: string) {
    const r = await api.get<{ sources: SourceRow[] }>(`/api/clones/${agentId}/sources`).catch(() => null);
    if (r) setSources(r.sources);
    const o = await api.get<{ observed: { sourceId: string }[] }>(`/api/fathom/observed?agentId=${agentId}`).catch(() => null);
    if (o) setObservedIds(new Set(o.observed.map((x) => x.sourceId)));
  }

  // ---- ground a source in its recording (vision over the screen share) ----
  const [observedIds, setObservedIds] = useState<Set<string>>(new Set());
  const [grounding, setGrounding] = useState<string | null>(null);
  const [groundNote, setGroundNote] = useState("");
  async function groundSource(s: { id: string; url?: string }) {
    if (!agent || grounding || !s.url) return;
    setGrounding(s.id);
    setGroundNote("Watching the recording — screen share, popups, timing. Takes ~20–30 min; safe to keep working, the badge appears when it's done.");
    try {
      await api.post(`/api/fathom/observe-screens`, { agentId: agent.id, sourceId: s.id, shareUrl: s.url });
      setObservedIds((prev) => new Set([...prev, s.id]));
      setGroundNote("Grounded ✓ — the recording's screen timeline is saved. Review the corrections it found.");
    } catch (e) {
      setGroundNote(`Grounding failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setGrounding(null);
    setTimeout(() => setGroundNote(""), 12000);
  }

  // ---- review + apply the recording's corrections to the storyboard ----
  const [corrOpen, setCorrOpen] = useState<string | null>(null); // sourceId
  const [corrLoading, setCorrLoading] = useState(false);
  const [corrDraft, setCorrDraft] = useState<Record<string, unknown> | null>(null);
  const [corrList, setCorrList] = useState<Correction[]>([]);
  const [corrErr, setCorrErr] = useState("");
  const [corrApplying, setCorrApplying] = useState(false);
  async function openCorrections(sourceId: string) {
    if (!agent) return;
    setCorrOpen(sourceId); setCorrLoading(true); setCorrErr(""); setCorrDraft(null); setCorrList([]);
    try {
      const r = await api.post<{ draft: Record<string, unknown>; corrections: Correction[] }>(`/api/fathom/enrich-playbook`, { agentId: agent.id, sourceId });
      setCorrDraft(r.draft); setCorrList(r.corrections ?? []);
    } catch (e) {
      setCorrErr(e instanceof Error ? e.message : String(e));
    }
    setCorrLoading(false);
  }
  async function applyCorrections() {
    if (!agent || !corrDraft || corrApplying) return;
    setCorrApplying(true);
    try {
      const gv = typeof (corrDraft as { graphVersion?: number }).graphVersion === "number" ? (corrDraft as { graphVersion?: number }).graphVersion as number : 1;
      await api.put(`/api/clones/${agent.id}/playbook`, { playbook: { ...corrDraft, graphVersion: gv + 1 } });
      setGroundNote("Storyboard re-grounded in the recording ✓ — golden recompiled, a running session picks it up too.");
      setCorrOpen(null);
      setTimeout(() => setGroundNote(""), 10000);
    } catch (e) {
      setCorrErr(`Apply failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setCorrApplying(false);
  }

  function resetWizard() {
    try { localStorage.removeItem("clonerep_draft"); } catch { /* ignore */ }
    setAgent(null); setSources([]); setPending([]); setSpec(null); setVerNum(null); setDirty(false);
    setName(""); setRole(""); setCompany(""); setTeam(""); setTz(""); setStep(1);
  }

  function addPaste() {
    if (pasteText.trim().length < 20) { alert("Paste a longer transcript first (at least a few lines)."); return; }
    const title = pasteTitle.trim() || `Pasted transcript ${sources.length + pending.length + 1}`;
    setPending((p) => [...p, { title, transcript: pasteText }]);
    setPasteTitle(""); setPasteText("");
  }
  async function addFiles(files: FileList | null) {
    if (!files) return;
    const adds: Pending[] = [];
    for (const f of Array.from(files)) {
      try {
        const text = await f.text();
        if (text.trim().length >= 20) adds.push({ title: f.name, transcript: text });
      } catch { /* unreadable file */ }
    }
    if (adds.length) setPending((p) => [...p, ...adds]);
  }
  async function removeSaved(id: string) {
    if (!agent) return;
    await api.del(`/api/clones/${agent.id}/sources/${id}`).catch(() => { /* ignore */ });
    await loadSources(agent.id);
  }

  // Step 2 -> 3: create the clone agent first, then upload sources, then extract (slow, awaited)
  async function extractFromSources(finishAfter = false) {
    if (extracting) return;
    if (!name.trim() || !role.trim()) { alert("Add a name and role in step 1 first."); setStep(1); return; }
    if (!sources.length && !pending.length) { alert("Add at least one transcript before extracting."); return; }
    setExtracting(true);
    try {
      let ag = agent;
      if (!ag) {
        const body: NewAgent = { icon: "user", name: name.trim(), role: role.trim(), buildTrack: "clone", cloneSource: { name: name.trim(), title: role.trim() } };
        ag = await api.post<Agent>("/api/agents", body);
        setAgent(ag);
        try { localStorage.setItem("pds_agent", ag.id); localStorage.setItem("clonerep_draft", ag.id); } catch { /* ignore */ }
      }
      if (pending.length) {
        await api.post(`/api/clones/${ag.id}/sources`, { sources: pending });
        setPending([]);
        await loadSources(ag.id);
      }
      const r = await api.post<{ version: { id: string; number: number; spec: PersonaSpec } }>(`/api/clones/${ag.id}/persona/extract`, {});
      setSpec(r.version.spec); setVerNum(r.version.number); setDirty(false);
      if (finishAfter) {
        // Quick clone: defaults are good enough — clear the draft marker, start
        // the orchestrator (grounding, voice, rehearsal) and watch it on Readiness.
        try { localStorage.removeItem("clonerep_draft"); localStorage.setItem("pds_agent", ag.id); } catch { /* ignore */ }
        void api.post("/api/pipeline/start", { agentId: ag.id }).catch(() => { /* Readiness shows the story either way */ });
        setExtracting(false);
        nav("readiness");
        return;
      }
      setStep(3);
    } catch (e) { alert("Extraction failed: " + (e instanceof Error ? e.message : String(e))); }
    setExtracting(false);
  }
  async function reExtract() {
    if (!agent || extracting) return;
    setExtracting(true);
    try {
      const r = await api.post<{ version: { id: string; number: number; spec: PersonaSpec } }>(`/api/clones/${agent.id}/persona/extract`, {});
      setSpec(r.version.spec); setVerNum(r.version.number); setDirty(false);
    } catch (e) { alert("Extraction failed: " + (e instanceof Error ? e.message : String(e))); }
    setExtracting(false);
  }

  // Review edits become a new persona version when leaving step 3
  function mutateSpec(next: PersonaSpec) { setSpec(next); setDirty(true); }
  async function commitIfDirty() {
    if (!agent || !spec || !dirty) return;
    setSaving(true);
    try {
      const r = await api.post<{ version: { id: string; number?: number } }>(`/api/clones/${agent.id}/versions`, { spec, changeNote: "Extraction review edits" });
      if (typeof r.version.number === "number") setVerNum(r.version.number);
      setDirty(false);
    } catch (e) { alert("Saving the review edits failed: " + (e instanceof Error ? e.message : String(e))); }
    setSaving(false);
  }

  // agents.voice_id is authoritative — the persona copy can lag a save
  const voiceId = agent?.voice_id || spec?.voice?.elevenlabs_voice_id || null;
  async function playSample() {
    if (playing) return;
    const text = spec?.lexicon?.signature_phrases?.[0]?.text || `Hi, this is ${name.trim() || "your clone"}. Thanks for making the time today.`;
    setPlaying(true);
    try {
      const key = getAccessKey();
      const res = await fetch(`${api.base}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) },
        body: JSON.stringify({ text, voiceId: voiceId || undefined }),
      });
      if (!res.ok) throw new Error(`speak → ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = new Audio(url);
      a.onended = () => { URL.revokeObjectURL(url); setPlaying(false); };
      a.onerror = () => { URL.revokeObjectURL(url); setPlaying(false); };
      await a.play();
    } catch (e) { setPlaying(false); alert("Voice playback failed: " + (e instanceof Error ? e.message : String(e))); }
  }

  // Voice picker (step 4): the account's ElevenLabs voices, filterable by gender/accent
  const [voices, setVoices] = useState<VoiceOpt[]>([]);
  const [voicesErr, setVoicesErr] = useState("");
  const [genderF, setGenderF] = useState("all");
  const [accentF, setAccentF] = useState("all");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [savingVoice, setSavingVoice] = useState(false);
  useEffect(() => {
    if (step !== 4 || voices.length) return;
    void api.get<{ voices: VoiceOpt[]; connected: boolean }>("/api/voice/options")
      .then((r) => { setVoices(r.voices); if (!r.connected) setVoicesErr("ElevenLabs is not connected in Integrations — no voices to choose from."); })
      .catch(() => setVoicesErr("Could not load the voice library."));
  }, [step, voices.length]);
  function previewVoice(v: VoiceOpt) {
    if (previewRef.current) { previewRef.current.pause(); previewRef.current = null; }
    if (previewing === v.id) { setPreviewing(null); return; }
    if (!v.previewUrl) return;
    const a = new Audio(v.previewUrl);
    previewRef.current = a;
    setPreviewing(v.id);
    a.onended = () => setPreviewing((p) => (p === v.id ? null : p));
    a.onerror = () => setPreviewing((p) => (p === v.id ? null : p));
    void a.play();
  }
  async function chooseVoice(v: VoiceOpt) {
    if (!agent || savingVoice) return;
    setSavingVoice(true);
    try {
      await api.patch(`/api/agents/${agent.id}`, { voiceId: v.id });
      setAgent({ ...agent, voice_id: v.id });
      if (spec) setSpec({ ...spec, voice: { ...spec.voice, elevenlabs_voice_id: v.id } });
    } catch (e) { alert("Saving the voice failed: " + (e instanceof Error ? e.message : String(e))); }
    setSavingVoice(false);
  }

  // "Clone their real voice" — server builds "<name> — real voice" in ElevenLabs
  // from the rep's actual speech on their Fathom calls, then it's auto-selected
  // through the same PATCH path as any picker choice.
  const realVoiceName = `${agent?.name ?? ""} — real voice`;
  const realVoice = voices.find((v) => v.name === realVoiceName) ?? null;
  const [cloningVoice, setCloningVoice] = useState(false);
  const [cloneVoiceMsg, setCloneVoiceMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function cloneRealVoice() {
    if (!agent || cloningVoice) return;
    setCloningVoice(true); setCloneVoiceMsg(null);
    try {
      // direct fetch so a failure surfaces the server's message VERBATIM
      const res = await fetch(`${api.base}/api/fathom/clone-voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getAccessKey() ? { "X-API-Key": getAccessKey() } : {}) },
        body: JSON.stringify({ agentId: agent.id }),
      });
      const j = (await res.json().catch(() => ({}))) as { voiceId?: string; sampleSeconds?: number; warning?: string; error?: string };
      if (!res.ok || !j.voiceId) throw new Error(j.error || `clone-voice → ${res.status}`);
      const vr = await api.get<{ voices: VoiceOpt[]; connected: boolean }>("/api/voice/options").catch(() => null);
      if (vr) setVoices(vr.voices);
      const picked = vr?.voices.find((v) => v.id === j.voiceId);
      await chooseVoice(picked ?? ({ id: j.voiceId, name: realVoiceName, tagline: "", gender: "", accent: "", age: "", category: "cloned", previewUrl: "" } as VoiceOpt));
      setCloneVoiceMsg({ ok: true, text: `Real voice ready ✓ — built from ${j.sampleSeconds ?? "~80"}s of ${firstName}'s actual calls and selected.${j.warning ? ` Note: ${j.warning}.` : ""}` });
    } catch (e) {
      setCloneVoiceMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    setCloningVoice(false);
  }

  // Fathom share links (step 2): paste one or more links, transcripts are read
  // from the public share pages server-side — no API connection needed.
  const [fLinks, setFLinks] = useState("");
  const [fBusy, setFBusy] = useState(false);
  const [fErr, setFErr] = useState("");
  const [fOk, setFOk] = useState("");
  async function addFathomLinks() {
    const urls = fLinks.split(/[\n,\s]+/).map((s) => s.trim()).filter((s) => s.startsWith("http"));
    if (!urls.length || fBusy) return;
    setFBusy(true); setFErr(""); setFOk("");
    try {
      const r = await api.post<{ transcripts: { url: string; title: string; transcript: string }[]; failed: { url: string; reason: string }[] }>("/api/fathom/links", { urls });
      const have = new Set([...sources.map((s) => s.title || ""), ...pending.map((p) => p.title)]);
      // keep the share url on the source — "Clone their real voice" re-derives the call audio from it later
      const adds = r.transcripts.filter((t) => !have.has(t.title)).map((t) => ({ title: t.title, transcript: t.transcript, url: t.url }));
      if (adds.length) setPending((p) => [...p, ...adds]);
      // Re-pasted links for calls we already have ATTACH the url to the saved
      // source (server upserts by title) instead of being dropped as dupes —
      // this is how older clones regain call audio for voice cloning.
      const relinks = agent ? r.transcripts.filter((t) => t.url && sources.some((s) => (s.title || "") === t.title)) : [];
      if (relinks.length && agent) {
        await api.post(`/api/clones/${agent.id}/sources`, { sources: relinks.map((t) => ({ title: t.title, transcript: t.transcript, url: t.url })) });
        await loadSources(agent.id);
      }
      if (adds.length || relinks.length) {
        const parts = [];
        if (adds.length) parts.push(`Added ${adds.length} ${adds.length === 1 ? "call" : "calls"}`);
        if (relinks.length) parts.push(`re-linked ${relinks.length} existing ${relinks.length === 1 ? "call" : "calls"} for voice cloning`);
        setFOk(parts.join(" · ") + ".");
      }
      setFLinks(r.failed.map((f) => f.url).join("\n"));
      if (r.failed.length) setFErr(r.failed.map((f) => `${f.url.slice(0, 60)}… — ${f.reason}`).join(" · "));
    } catch (e) { setFErr(e instanceof Error ? e.message : String(e)); }
    setFBusy(false);
  }

  async function next() {
    if (step === 1) {
      if (!name.trim() || !role.trim()) { alert("The clone needs at least a name and a role."); return; }
      // Resumed draft: persist identity edits instead of silently dropping them
      if (agent && (name.trim() !== agent.name || role.trim() !== (agent.role ?? ""))) {
        try {
          const up = await api.patch<Agent>(`/api/agents/${agent.id}`, { name: name.trim(), role: role.trim() });
          setAgent(up);
        } catch { /* keep going — extraction will still use the typed name */ }
      }
      setStep(2); return;
    }
    if (step === 2) { void extractFromSources(quick); return; }
    if (step === 3) { await commitIfDirty(); setStep(4); return; }
    if (step === 4) { setStep(5); return; }
    // Finish: the draft is now a real clone — clear the resume marker so the
    // next "Clone a rep" starts fresh instead of editing this one. Land in the
    // calibration room: text tuning up front, the live screen pre-warming.
    try { localStorage.removeItem("clonerep_draft"); } catch { /* ignore */ }
    if (agent) {
      try { localStorage.setItem("pds_agent", agent.id); } catch { /* ignore */ }
      // hand the rest to the orchestrator — grounding, rehearsal, the works
      void api.post("/api/pipeline/start", { agentId: agent.id }).catch(() => { /* Readiness shows the story either way */ });
    }
    nav("rehearsal");
  }
  const canGo = (n: number) => n <= 2 || !!spec;

  // Derived data
  const firstName = name.trim().split(/\s+/)[0] || "the rep";
  // ground truth (real human calls) vs session recordings (the clone's own runs) —
  // only ground truth trains the persona
  const groundSources = useMemo(() => sources.filter((s) => s.kind !== "live_call"), [sources]);
  const sessionSources = useMemo(() => sources.filter((s) => s.kind === "live_call"), [sources]);
  const totalChars = useMemo(() => groundSources.reduce((a, s) => a + (s.chars || 0), 0) + pending.reduce((a, p) => a + p.transcript.length, 0), [groundSources, pending]);
  const totalCount = groundSources.length + pending.length;
  const phrases = spec?.lexicon?.signature_phrases ?? [];
  const fewShots = spec?.few_shots ?? [];
  const knowledge = spec?.knowledge_boundaries ?? [];
  const bannedPhrases = spec?.lexicon?.banned_phrases ?? [];
  const gates: { label: string; done: boolean; note?: string }[] = [
    { label: "Sources ingested", done: sources.length > 0 },
    { label: "Persona extracted", done: !!spec },
    { label: "Call playbook drafted", done: !!playbook && playbook.stages.length > 0 },
    { label: "Voice model set", done: !!voiceId, note: voiceId ? undefined : "pick a voice in step 4" },
    { label: "Live version", done: !!agent?.golden_persona_id, note: agent?.golden_persona_id ? undefined : "pinned after calibration" },
  ];
  const gatesDone = gates.filter((g) => g.done).length;

  const rows: { id: string; title: string; meta: string; kind: "saved" | "new"; url?: string; onRemove: () => void }[] = [
    ...groundSources.map((s) => ({
      id: s.id,
      title: s.title || s.id,
      meta: `${kChars(s.chars)} characters · ${new Date(s.created_at).toLocaleDateString()}`,
      kind: "saved" as const,
      url: s.url,
      onRemove: () => void removeSaved(s.id),
    })),
    ...pending.map((p, i) => ({
      id: `pending-${i}`,
      title: p.title,
      meta: `${kChars(p.transcript.length)} characters · added this session`,
      kind: "new" as const,
      onRemove: () => setPending((arr) => arr.filter((_, j) => j !== i)),
    })),
  ].filter((r) => !filterQ.trim() || r.title.toLowerCase().includes(filterQ.trim().toLowerCase()));

  const nextLabel = step === 2 ? (quick ? "Clone with defaults" : "Extract persona") : step === 3 ? (saving ? "Saving…" : "Continue") : step === 5 ? "Enter the Calibration Room" : "Continue";
  const nextIcon = step === 2 ? "auto_awesome" : "arrow_forward";
  const stepHint = step === 3
    ? (dirty ? "Edits save as a new persona version when you continue" : "Every value points back to the source transcripts")
    : step === 5 ? "Draft clone · not yet live" : `Step ${step} of 5`;

  return (
    <div className="pmx" data-theme={theme} style={{ height: "100%", overflowY: "auto" }}>
      <div className="app" style={{ maxWidth: step === 3 ? 1460 : undefined, paddingBottom: 40 }}>
        <style>{"@keyframes pdsSpin{to{transform:rotate(360deg)}}@keyframes pdsPulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes spin{to{transform:rotate(360deg)}}"}</style>

        {/* ============ TOPBAR ============ */}
        <div className="topbar">
          <button onClick={() => nav("echo")} className="brand" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", color: "var(--ink1)" }}>
            <span className="mark" />New clone
          </button>
          <span className="st-pill" style={{ background: "var(--purple-soft)", color: "var(--purple-ink)", letterSpacing: ".04em" }}>{spec ? `persona v${verNum ?? 1} · draft` : "not extracted yet"}</span>
          <div className="spacer" />
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="iconbtn" title="Toggle theme">
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{theme === "dark" ? "light_mode" : "dark_mode"}</span>
          </button>
          <button onClick={() => nav("echo")} className="iconbtn" title="Close">
            <span className="material-symbols-rounded" style={{ fontSize: 22 }}>close</span>
          </button>
        </div>

        {/* ============ PAGE HEADING ============ */}
        <div className="page-h">
          <h1 style={{ fontSize: 26 }}>Clone a rep</h1>
          <p style={{ marginTop: 6 }}>Point it at their calls. It watches, learns their voice and flow, and drafts the demo. You review before anything goes live.</p>
        </div>

        {/* ============ STEPPER ============ */}
        <div className="stepper">
          {STEP_DEFS.map((d) => {
            const done = d.n < step, active = d.n === step;
            return (
              <button
                key={d.n}
                className={`s${active ? " on" : ""}`}
                onClick={() => { if (canGo(d.n)) setStep(d.n); }}
                style={{ background: "transparent", cursor: canGo(d.n) ? "pointer" : "default", fontFamily: "inherit" }}
              >
                <span className="n" style={done && !active ? { background: "var(--success-soft)", color: "var(--success-ink)" } : undefined}>{done ? "✓" : d.n}</span>
                {d.label}
              </button>
            );
          })}
        </div>

        {/* ============ STEP 1 · IDENTITY ============ */}
        {step === 1 && (
          <div style={{ maxWidth: 720 }}>
            <div className="card wizcard">
              {/* Quick clone toggle */}
              <div
                className="quicktoggle"
                role="button"
                tabIndex={0}
                aria-pressed={quick}
                onClick={() => setQuick((q) => !q)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setQuick((q) => !q); } }}
                style={{ cursor: "pointer" }}
              >
                {quick ? (
                  <div className="tg" />
                ) : (
                  <div style={{ width: 44, height: 26, borderRadius: 999, background: "var(--track)", position: "relative", flex: "none" }}>
                    <div style={{ position: "absolute", width: 20, height: 20, borderRadius: "50%", background: "#fff", top: 3, left: 3 }} />
                  </div>
                )}
                <div>
                  <div className="tt">Quick clone {quick ? "is on" : "is off"}</div>
                  <div className="dd">
                    {quick
                      ? "Add the calls and we use smart defaults, then hand it to the orchestrator. You can tune everything later in the room."
                      : "Walk through each step: review the extracted persona, pick the voice, then confirm before it goes to the room."}
                  </div>
                </div>
              </div>

              <h2>Who are you cloning?</h2>
              <p className="lead">The clone takes this person's name and voice on live calls. Everything the clone knows will be traced back to their recordings.</p>

              <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, textAlign: "center" }}>
                  <div style={{ width: 96, height: 96, borderRadius: "50%", background: T.grad, color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 700 }}>{initials(name)}</div>
                  <div style={{ marginTop: 12, fontSize: 11, fontWeight: 600, color: "var(--ink3)", maxWidth: 110 }}>Initials avatar for now, photo upload is not wired yet</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="field">
                    <label>Full name</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maya Cohen" />
                  </div>
                  <div style={{ display: "flex", gap: 14 }}>
                    <div className="field" style={{ flex: 1 }}>
                      <label>Role</label>
                      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Senior Customer Success Manager" />
                    </div>
                    <div className="field" style={{ width: 200 }}>
                      <label>Company</label>
                      <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. GoPerfect" />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 14 }}>
                    <div className="field" style={{ flex: 1 }}>
                      <label>Team</label>
                      <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="e.g. Enterprise Success" />
                    </div>
                    <div className="field" style={{ width: 200 }}>
                      <label>Time zone</label>
                      <input value={tz} onChange={(e) => setTz(e.target.value)} placeholder="e.g. America / Los Angeles" />
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.5 }}>
                    Name and role are saved to the clone when it is created. Company, team and time zone stay on this screen for now.
                    {agent && <> · Editing an existing draft: <b style={{ color: "var(--ink2)" }}>{agent.name}</b>. <button onClick={resetWizard} style={{ background: "none", border: "none", padding: 0, color: "var(--purple-ink)", textDecoration: "underline", ...btnFont, fontSize: 11.5 }}>Start a new clone instead</button></>}
                  </div>
                </div>
              </div>
            </div>

            {/* company branding — org-level, asked once */}
            <div className="card" style={{ padding: 22, marginTop: 18, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <div style={{ width: 150, height: 64, borderRadius: 12, background: "var(--sunk)", border: "1px dashed var(--border)", display: "grid", placeItems: "center", overflow: "hidden", flexShrink: 0 }}>
                {companyLogo
                  ? <img src={companyLogo} alt="Company logo" style={{ maxWidth: "88%", maxHeight: "82%", objectFit: "contain" }} />
                  : <span style={{ fontSize: 11, color: "var(--ink3)" }}>no logo yet</span>}
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800 }}>Company logo</div>
                <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.5, marginTop: 3 }}>
                  Shown on the shared screen whenever the clone isn't presenting the product — the opening minutes of every call carry your brand instead of a blank page. One logo for the whole workspace.
                </div>
                {logoNote && <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: logoNote.startsWith("Logo saved") ? "var(--success-ink)" : "var(--error-ink)" }}>{logoNote}</div>}
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 38, padding: "0 16px", borderRadius: 9999, border: "1px solid var(--border)", color: "var(--ink1)", ...btnFont, fontSize: 12.5, cursor: "pointer" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 17 }}>upload</span>
                {companyLogo ? "Replace logo" : "Upload logo"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            </div>
          </div>
        )}

        {/* ============ STEP 2 · SOURCES ============ */}
        {step === 2 && (
          <div>
            <div style={kicker}>Step 2 of 5 · Sources</div>
            <h1 style={h1S}>Feed the clone real calls</h1>
            <p style={{ ...leadS, maxWidth: 680 }}>Paste transcripts of {firstName} on real customer calls. The more range you give, the more faithful the clone. Everything extracted later points back to these sources.</p>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)", gap: 18, alignItems: "start" }}>
              <div style={{ ...cardS, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 22px", borderBottom: "1px solid var(--divider)" }}>
                  <span style={{ ...pillS, fontSize: 12, gap: 6, padding: "6px 12px", background: T.decorSoft, color: "var(--decor)" }}><span className="material-symbols-rounded" style={{ fontSize: 16 }}>description</span>Transcripts</span>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{firstName}'s call transcripts</div>
                  <input value={filterQ} onChange={(e) => setFilterQ(e.target.value)} placeholder="Filter by title…" style={{ ...inputS, marginLeft: "auto", width: 200, height: 36, padding: "0 14px", borderRadius: 9999, fontSize: 12.5 }} />
                </div>
                {rows.map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 22px", borderBottom: "1px solid var(--divider)" }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20, color: r.kind === "saved" ? "var(--success-ink)" : "var(--purple)" }}>{r.kind === "saved" ? "check_circle" : "note_add"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ink3)" }}>{r.meta}</div>
                    </div>
                    {r.kind === "saved" && r.url && (
                      observedIds.has(r.id) ? (
                        <button onClick={() => void openCorrections(r.id)} title="This recording was watched — review what it corrects in the storyboard" style={{ flexShrink: 0, height: 28, padding: "0 12px", borderRadius: 9999, border: "1px solid var(--success)", background: "var(--success-soft)", color: "var(--success-ink)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span className="material-symbols-rounded" style={{ fontSize: 14 }}>visibility</span>Grounded ✓ · Review
                        </button>
                      ) : (
                        <button onClick={() => void groundSource(r)} disabled={!!grounding} title="Watch the recording's screen share — real screens, popups and timing become ground truth for the storyboard (~20–30 min, runs server-side)" style={{ flexShrink: 0, height: 28, padding: "0 12px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: grounding === r.id ? "var(--purple-ink)" : "var(--ink2)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5, opacity: grounding && grounding !== r.id ? 0.5 : 1 }}>
                          <span className="material-symbols-rounded" style={{ fontSize: 14 }}>{grounding === r.id ? "hourglass_top" : "movie"}</span>{grounding === r.id ? "Watching…" : "Ground in recording"}
                        </button>
                      )
                    )}
                    <span style={{ ...pillS, background: r.kind === "saved" ? "var(--success-soft)" : "var(--purple-soft)", color: r.kind === "saved" ? "var(--success-ink)" : "var(--purple-ink)" }}>{r.kind === "saved" ? "saved" : "new"}</span>
                    <button onClick={r.onRemove} title="Remove" style={{ width: 28, height: 28, flexShrink: 0, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><span className="material-symbols-rounded" style={{ fontSize: 17 }}>close</span></button>
                  </div>
                ))}
                {!rows.length && (
                  <div style={{ padding: "22px", fontSize: 13, color: "var(--ink3)" }}>No transcripts yet. Add a Fathom link above, or drop transcript files on the right.</div>
                )}
                {groundNote && (
                  <div style={{ padding: "10px 22px", fontSize: 12, fontWeight: 600, color: groundNote.includes("failed") ? "var(--error-ink)" : "var(--success-ink)", borderBottom: "1px solid var(--divider)" }}>{groundNote}</div>
                )}

                {/* session recordings: evidence, not training material */}
                {sessionSources.length > 0 && (
                  <div style={{ padding: "12px 22px", borderBottom: "1px solid var(--divider)", background: "var(--sunk)" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)" }}>
                      Session recordings · {sessionSources.length}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 4, lineHeight: 1.5 }}>
                      Rehearsals and live calls by the clone itself — used for film review, debriefs and beat-building, <b>never to learn {firstName}'s style</b> (that would be learning from its own output).
                    </div>
                  </div>
                )}

                {/* Fathom — paste share links, transcripts fetched from the page */}
                <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--divider)" }}>
                  <label style={lblS}>Fathom share links</label>
                  <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.5, marginBottom: 10 }}>
                    In Fathom open the call, hit Share → Copy link, and paste the links here — one per line, as many as you want. The transcripts are pulled in automatically.
                  </div>
                  <textarea value={fLinks} onChange={(e) => setFLinks(e.target.value)} rows={3} placeholder={"https://fathom.video/share/…\nhttps://fathom.video/share/…"} style={{ ...inputS, height: "auto", minHeight: 74, padding: "12px 16px", fontSize: 13, lineHeight: 1.5, resize: "vertical" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                    {fOk && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--success-ink)" }}>{fOk}</span>}
                    <button onClick={() => void addFathomLinks()} disabled={fBusy || !fLinks.trim()} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 16px", borderRadius: 9999, background: "var(--purple)", color: "#fff", border: "none", ...btnFont, opacity: fBusy || !fLinks.trim() ? 0.6 : 1 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 18 }}>download</span>{fBusy ? "Fetching transcripts…" : "Fetch calls"}
                    </button>
                  </div>
                  {fErr && <div style={{ fontSize: 12, color: "var(--warning-ink)", marginTop: 8, lineHeight: 1.5 }}>{fErr}</div>}
                </div>

                {/* Paste a transcript — advanced, collapsed by default (Fathom links are the main path) */}
                <div style={{ padding: "14px 22px 18px" }}>
                  <button onClick={() => setPasteOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", padding: 0, color: "var(--ink2)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 18 }}>{pasteOpen ? "expand_less" : "expand_more"}</span>
                    Advanced · paste a transcript by hand
                  </button>
                  {pasteOpen && (
                    <div style={{ marginTop: 12 }}>
                      <input value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="Title, e.g. QBR — Northwind Talent" style={{ ...inputS, height: 40, borderRadius: 12, fontSize: 13, marginBottom: 10 }} />
                      <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={5} placeholder="Paste the full call transcript here…" style={{ ...inputS, height: "auto", minHeight: 110, padding: "12px 16px", fontSize: 13, lineHeight: 1.5, resize: "vertical" }} />
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                        <button onClick={addPaste} style={{ display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 16px", borderRadius: 9999, background: "var(--purple)", color: "#fff", border: "none", ...btnFont }}>
                          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>add</span>Add transcript
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ ...cardS, padding: 22 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 14 }}>Selected for training</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-.03em" }}>{totalCount}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink2)" }}>{totalCount === 1 ? "transcript" : "transcripts"}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink2)", marginTop: 2 }}>{kChars(totalChars)} characters of call text</div>
                  <div style={{ height: 1, background: "var(--divider)", margin: "16px 0" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}><span style={{ color: "var(--ink2)" }}>Saved to the clone</span><span style={{ fontWeight: 600 }}>{sources.length}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}><span style={{ color: "var(--ink2)" }}>New this session</span><span style={{ fontWeight: 600 }}>{pending.length}</span></div>
                  </div>
                </div>
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}
                  style={{ border: "2px dashed var(--border)", borderRadius: 20, padding: 24, textAlign: "center", cursor: "pointer" }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 30, color: "var(--ink3)" }}>upload_file</span>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 8 }}>Drag transcripts here</div>
                  <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>or click to upload .txt, .vtt, .srt</div>
                  <input ref={fileRef} type="file" accept=".txt,.vtt,.srt,text/plain" multiple onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============ STEP 3 · EXTRACTION REVIEW ============ */}
        {step === 3 && spec && (
          <div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, marginBottom: 22 }}>
              <div>
                <div style={kicker}>Step 3 of 5 · Extraction review</div>
                <h1 style={h1S}>This is what the clone learned</h1>
                <p style={{ ...leadS, margin: 0, maxWidth: 700 }}>A draft persona pulled from {sources.length} {sources.length === 1 ? "transcript" : "transcripts"}. Review and correct anything. Every value below points back to the calls it came from.</p>
              </div>
              <button onClick={() => void reExtract()} disabled={extracting} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, height: 42, padding: "0 18px", borderRadius: 9999, background: "transparent", border: "2px solid var(--border)", color: "var(--ink1)", ...btnFont, opacity: extracting ? 0.6 : 1 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 19 }}>refresh</span>Re-run extraction
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 18, alignItems: "start" }}>
              {/* LEFT: style + knowledge */}
              <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
                <div style={{ ...cardS, padding: 24 }}>
                  <div style={secHead}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--purple)", fontVariationSettings: "'FILL' 1" }}>tune</span>
                    <div style={secTitle}>Style vector</div>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "var(--ink3)" }}>from {sources.length} {sources.length === 1 ? "transcript" : "transcripts"}</span>
                  </div>
                  <div style={{ ...secSub, marginBottom: 18 }}>Six dimensions of how {firstName} talks. Each caption is what the current value means on a call.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    {STYLE_META.map((m) => {
                      const v = spec.style[m.key];
                      return (
                        <div key={m.key}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
                            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{m.label}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--purple)" }}>{Math.round(v * 100)}</span>
                          </div>
                          <input type="range" min={0} max={100} value={Math.round(v * 100)} onChange={(e) => mutateSpec({ ...spec, style: { ...spec.style, [m.key]: Number(e.target.value) / 100 } })} style={{ width: "100%", height: 6, cursor: "pointer", accentColor: "var(--purple)" }} />
                          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 6, lineHeight: 1.4 }}>{caption(v, m.caps)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ ...cardS, padding: 24 }}>
                  <div style={secHead}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--purple)", fontVariationSettings: "'FILL' 1" }}>database</span>
                    <div style={secTitle}>Knowledge boundaries</div>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "var(--ink3)" }}>{knowledge.length} extracted</span>
                  </div>
                  <div style={secSub}>What the clone is allowed to speak about, grounded in the calls. Anything outside these boundaries is escalated, never invented.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "26vh", overflowY: "auto", paddingRight: 4 }}>
                    {knowledge.map((k, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", borderBottom: i < knowledge.length - 1 ? "1px solid var(--divider)" : "none" }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 18, color: "var(--success-ink)", marginTop: 1 }}>check_circle</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>{k}</div>
                          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4 }}>from extraction</div>
                        </div>
                      </div>
                    ))}
                    {!knowledge.length && <div style={{ fontSize: 12.5, color: "var(--ink3)", padding: "10px 0" }}>No knowledge boundaries were extracted yet. Re-run extraction after adding more calls.</div>}
                  </div>
                  {spec.lexicon?.vocabulary_notes ? (
                    <div style={{ marginTop: 14, fontSize: 12, color: "var(--ink2)", lineHeight: 1.5, background: "var(--sunk)", borderRadius: 12, padding: "10px 14px" }}>
                      <b style={{ fontSize: 11, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink3)" }}>Vocabulary notes</b>
                      <div style={{ marginTop: 4 }}>{spec.lexicon.vocabulary_notes}</div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* MIDDLE: signature phrases */}
              <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
                <div style={{ ...cardS, padding: 24 }}>
                  <div style={secHead}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--purple)", fontVariationSettings: "'FILL' 1" }}>format_quote</span>
                    <div style={secTitle}>Signature phrases</div>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "var(--ink3)" }}>{phrases.length} kept</span>
                  </div>
                  <div style={secSub}>Turns of phrase {firstName} reaches for. Tap the x to drop one from the clone.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "56vh", overflowY: "auto", paddingRight: 4 }}>
                    {phrases.map((p, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, background: "var(--sunk)" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>&ldquo;{p.text}&rdquo;</div>
                          <div style={{ ...provS, marginTop: 3 }}><span className="material-symbols-rounded" style={{ fontSize: 13 }}>arrow_outward</span>{p.source || "from extraction"}</div>
                        </div>
                        <button onClick={() => mutateSpec({ ...spec, lexicon: { ...spec.lexicon, signature_phrases: phrases.filter((_, j) => j !== i) } })} style={{ width: 28, height: 28, flexShrink: 0, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><span className="material-symbols-rounded" style={{ fontSize: 17 }}>close</span></button>
                      </div>
                    ))}
                    {!phrases.length && <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>No signature phrases were extracted from these calls.</div>}
                  </div>
                  {bannedPhrases.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 8 }}>Banned phrases</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {bannedPhrases.map((b, i) => <span key={i} style={{ ...pillS, background: "var(--error-soft)", color: "var(--error-ink)" }}>{b}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT: few-shots */}
              <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
                <div style={{ ...cardS, padding: 24 }}>
                  <div style={secHead}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--purple)", fontVariationSettings: "'FILL' 1" }}>chat_paste_go</span>
                    <div style={secTitle}>Few-shot examples</div>
                  </div>
                  <div style={secSub}>Real moments the clone will imitate. Uncheck any you would not want repeated.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "62vh", overflowY: "auto", paddingRight: 4 }}>
                    {fewShots.map((f, i) => (
                      <div key={f.id || i} style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 15, opacity: f.active ? 1 : 0.5 }}>
                        <label onClick={() => mutateSpec({ ...spec, few_shots: fewShots.map((x, j) => (j === i ? { ...x, active: !x.active } : x)) })} style={{ display: "flex", alignItems: "flex-start", gap: 11, cursor: "pointer" }}>
                          <span style={{ width: 20, height: 20, flexShrink: 0, marginTop: 1, borderRadius: 6, border: `2px solid ${f.active ? "var(--purple)" : "var(--border)"}`, background: f.active ? "var(--purple)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {f.active && <span className="material-symbols-rounded" style={{ fontSize: 14, color: "#fff" }}>check</span>}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink3)" }}>Customer</div>
                            <div style={{ fontSize: 13, color: "var(--ink2)", margin: "2px 0 10px", lineHeight: 1.4 }}>{f.situation}</div>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--purple-ink)" }}>{firstName}</div>
                            <div style={{ fontSize: 13, fontWeight: 500, margin: "2px 0 10px", lineHeight: 1.45 }}>{f.human_response}</div>
                            <div style={provS}><span className="material-symbols-rounded" style={{ fontSize: 13 }}>arrow_outward</span>{f.source || "from extraction"}</div>
                          </div>
                        </label>
                      </div>
                    ))}
                    {!fewShots.length && <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>No few-shot examples were extracted from these calls.</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {step === 3 && !spec && (
          <div style={{ ...cardS, borderRadius: 18, textAlign: "center", padding: 40, color: "var(--ink3)", fontSize: 13.5 }}>
            No persona extracted yet. Go back to sources and run the extraction.
          </div>
        )}

        {/* ============ STEP 4 · VOICE ============ */}
        {step === 4 && (() => {
          const accents = Array.from(new Set(voices.map((v) => v.accent).filter(Boolean)));
          const shown = voices.filter((v) => (genderF === "all" || v.gender === genderF) && (accentF === "all" || v.accent === accentF));
          const chip = (on: boolean): CSSProperties => ({ padding: "7px 14px", borderRadius: 9999, border: `2px solid ${on ? "var(--purple)" : "var(--border)"}`, background: on ? "var(--purple-soft)" : "transparent", color: on ? "var(--purple-ink)" : "var(--ink2)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" });
          return (
          <div style={{ maxWidth: 980 }}>
            <div style={kicker}>Step 4 of 5 · Voice</div>
            <h1 style={h1S}>Give the clone {firstName}'s voice</h1>
            <p style={leadS}>Clone {firstName}'s real voice straight from their call recordings — or pick the closest library voice below and preview it before choosing.</p>

            {/* the real thing: built server-side from the rep's actual speech on their Fathom calls */}
            <div style={{ ...cardS, border: "2px solid var(--purple)", background: "var(--purple-soft)", padding: "16px 20px", marginBottom: 18, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 28, color: "var(--purple-ink)" }}>graphic_eq</span>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800 }}>{realVoice ? "Real voice ready ✓" : `Clone ${firstName}'s real voice`}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 2 }}>
                  {realVoice
                    ? `“${realVoiceName}” was built from ${firstName}'s actual calls — rebuild any time to refresh the sample.`
                    : `Built from ${firstName}'s actual calls — the voice on the demo is the voice on the recordings.`}
                </div>
                {cloneVoiceMsg && (
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6, color: cloneVoiceMsg.ok ? "var(--success-ink)" : "var(--error-ink)" }}>{cloneVoiceMsg.text}</div>
                )}
              </div>
              <button onClick={() => void cloneRealVoice()} disabled={cloningVoice} style={{ display: "flex", alignItems: "center", gap: 8, height: 42, padding: "0 20px", borderRadius: 9999, border: "none", background: cloningVoice ? "var(--ghost)" : "var(--purple)", color: cloningVoice ? "var(--ink2)" : "#fff", fontSize: 13, fontWeight: 800, cursor: cloningVoice ? "wait" : "pointer", fontFamily: "inherit" }}>
                {cloningVoice && <span className="material-symbols-rounded" style={{ fontSize: 16, animation: "spin 1s linear infinite" }}>progress_activity</span>}
                {cloningVoice ? "Listening to their calls… ~1–2 min" : realVoice ? "Rebuild from calls" : "Create"}
              </button>
            </div>

            {/* selected voice — status first, then the picker */}
            <div style={{ ...cardS, padding: 20, display: "flex", alignItems: "center", gap: 20, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={secTitle}>Selected voice</div>
                  {voiceId ? (
                    <span style={{ ...pillS, background: "var(--success-soft)", color: "var(--success-ink)" }}><span className="material-symbols-rounded" style={{ fontSize: 14 }}>check_circle</span>{voices.find((v) => v.id === voiceId)?.name || voiceId.slice(0, 12)}</span>
                  ) : (
                    <span style={{ ...pillS, background: "var(--warning-soft)", color: "var(--warning-ink)" }}><span className="material-symbols-rounded" style={{ fontSize: 14 }}>flag</span>Not set</span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 6, lineHeight: 1.5 }}>
                  {voiceId ? `The sample line speaks ${firstName}'s first signature phrase with this voice.` : "Pick a voice below — until then playback uses the account default."}
                </div>
              </div>
              <button onClick={() => void playSample()} disabled={playing} style={{ display: "flex", alignItems: "center", gap: 8, height: 46, padding: "0 20px", borderRadius: 9999, background: "var(--purple)", color: "#fff", border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: playing ? 0.6 : 1, flexShrink: 0 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>graphic_eq</span>{playing ? "Playing…" : "Play sample line"}
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {["all", "female", "male"].map((g) => (
                <button key={g} onClick={() => setGenderF(g)} style={chip(genderF === g)}>{g === "all" ? "All voices" : g}</button>
              ))}
              <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 6px" }} />
              <button onClick={() => setAccentF("all")} style={chip(accentF === "all")}>Any accent</button>
              {accents.map((a) => (
                <button key={a} onClick={() => setAccentF(a)} style={chip(accentF === a)}>{a}</button>
              ))}
            </div>

            {voicesErr && <div style={{ ...cardS, padding: 18, fontSize: 13, color: "var(--warning-ink)", marginBottom: 16 }}>{voicesErr}</div>}
            {!voices.length && !voicesErr && <div style={{ ...cardS, padding: 18, fontSize: 13, color: "var(--ink3)", marginBottom: 16 }}>Loading the voice library…</div>}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12, marginBottom: 18 }}>
              {shown.map((v) => {
                const sel = voiceId === v.id;
                return (
                  <div key={v.id} onClick={() => void chooseVoice(v)} style={{ ...cardS, padding: 16, cursor: "pointer", border: `2px solid ${sel ? "var(--purple)" : "var(--border)"}`, background: sel ? "var(--purple-soft)" : "var(--card)", opacity: savingVoice && !sel ? 0.7 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontSize: 14.5, fontWeight: 700 }}>{v.name}</span>
                          {sel && <span className="material-symbols-rounded" style={{ fontSize: 17, color: "var(--purple)", fontVariationSettings: "'FILL' 1" }}>check_circle</span>}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 2, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.tagline || " "}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); previewVoice(v); }} title="Preview this voice" style={{ width: 36, height: 36, flexShrink: 0, borderRadius: "50%", border: "none", background: previewing === v.id ? "var(--accent)" : "var(--ghost)", color: previewing === v.id ? "#fff" : "var(--ink1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 19, fontVariationSettings: "'FILL' 1" }}>{previewing === v.id ? "stop" : "play_arrow"}</span>
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }}>
                      {v.category !== "premade" && <span style={{ ...pillS, background: "var(--purple)", color: "#fff" }}>custom</span>}
                      {v.gender && <span style={{ ...pillS, background: "var(--sunk)", color: "var(--ink2)", textTransform: "capitalize" }}>{v.gender}</span>}
                      {v.accent && <span style={{ ...pillS, background: "var(--sunk)", color: "var(--ink2)", textTransform: "capitalize" }}>{v.accent}</span>}
                      {v.age && <span style={{ ...pillS, background: "var(--sunk)", color: "var(--ink2)", textTransform: "capitalize" }}>{v.age}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {voices.length > 0 && !shown.length && <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 18 }}>No voices match those filters.</div>}
          </div>
          );
        })()}

        {/* ============ STEP 5 · CONFIRM ============ */}
        {step === 5 && (
          <div style={{ maxWidth: 760 }}>
            <div style={kicker}>Step 5 of 5 · Confirm</div>
            <h1 style={h1S}>{firstName}'s clone is ready to calibrate</h1>
            <p style={leadS}>Nothing here is live yet. The clone enters the Calibration Room as a draft and cannot take real calls until it passes all quality checks.</p>

            <div style={{ ...cardS, padding: 26, marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, paddingBottom: 20, borderBottom: "1px solid var(--divider)" }}>
                <div style={{ width: 60, height: 60, borderRadius: "50%", background: T.grad, color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>{initials(name)}</div>
                <div>
                  <div style={{ fontSize: 19, fontWeight: 700 }}>{name.trim() || "Unnamed clone"}</div>
                  <div style={{ fontSize: 13, color: "var(--ink2)" }}>{role.trim() || "No role"}{company.trim() ? ` · ${company.trim()}` : ""}</div>
                </div>
                <span style={{ marginLeft: "auto", ...pillS, padding: "5px 12px", background: "var(--sunk)", color: "var(--ink2)" }}>Draft · {gatesDone} of {gates.length} gates</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, padding: "20px 0", borderBottom: "1px solid var(--divider)" }}>
                {[
                  { v: String(sources.length), l: sources.length === 1 ? "Source call" : "Source calls" },
                  { v: String(phrases.length), l: "Phrases" },
                  { v: String(knowledge.length), l: "Knowledge" },
                  { v: voiceId ? "Ready" : "Not set", l: "Voice", ok: !!voiceId },
                ].map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: s.ok ? "var(--success-ink)" : undefined }}>{s.v}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)", marginTop: 2 }}>{s.l}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 18 }}>
                {gates.map((g, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 19, color: g.done ? "var(--success-ink)" : "var(--ink3)" }}>{g.done ? "check_circle" : "radio_button_unchecked"}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: g.done ? "var(--ink1)" : "var(--ink2)" }}>{g.label}</span>
                    {g.note && <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>{g.note}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Demo environment — the GoPerfect account THIS clone signs into.
                Per-agent with a shared-default fallback; saving overrides it. */}
            <div style={{ ...cardS, padding: 26 }}>
              <div style={secHead}>
                <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--purple)", fontVariationSettings: "'FILL' 1" }}>key</span>
                <div style={secTitle}>Demo environment</div>
                {demoLoaded && demoInherited && demoEmail && (
                  <span style={{ marginLeft: "auto", ...pillS, background: "var(--sunk)", color: "var(--ink3)" }}>shared default</span>
                )}
              </div>
              <div style={secSub}>The GoPerfect account {firstName} signs into on every rehearsal and live call.</div>
              {demoLoaded && demoInherited && (
                <div style={{ fontSize: 12, color: "var(--ink3)", lineHeight: 1.5, marginBottom: 14 }}>Using the shared default — set one to override for this clone.</div>
              )}
              <div className="field">
                <label>Account email</label>
                <input type="email" value={demoEmail} onChange={(e) => setDemoEmail(e.target.value)} placeholder="demo@goperfectmatch.com" disabled={!agent} />
              </div>
              <div className="field">
                <label>{demoHasPw && !demoInherited ? "Password (leave blank to keep current)" : "Password"}</label>
                <input type="password" value={demoPw} onChange={(e) => setDemoPw(e.target.value)} placeholder={demoHasPw && !demoInherited ? "•••••••• — a password is set" : "Set a password"} disabled={!agent} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                {demoNote && <span style={{ fontSize: 12, fontWeight: 700, color: demoNote.ok ? "var(--success-ink)" : "var(--error-ink)" }}>{demoNote.text}</span>}
                <button onClick={() => void saveDemoLogin()} disabled={!agent || demoBusy} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 18px", borderRadius: 9999, background: "var(--purple)", color: "#fff", border: "none", ...btnFont, opacity: !agent || demoBusy ? 0.6 : 1 }}>
                  {demoBusy ? "Saving…" : "Save demo login"}
                </button>
              </div>
              {!agent && <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 8 }}>Available once the clone is created.</div>}
            </div>
          </div>
        )}

        {/* ============ FOOTER NAV (wizfoot) ============ */}
        <div className="wizfoot">
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="btn ghost"
            style={{ visibility: step === 1 ? "hidden" : "visible" }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>arrow_back</span>Back
          </button>
          <div className="spacer" />
          <span className="mut" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink3)" }}>{stepHint}</span>
          <button onClick={() => void next()} disabled={extracting || saving} className="btn pink" style={{ letterSpacing: ".04em", opacity: extracting || saving ? 0.6 : 1 }}>
            {nextLabel}<span className="material-symbols-rounded" style={{ fontSize: 20 }}>{nextIcon}</span>
          </button>
        </div>
      </div>

      {/* EXTRACTION RUNNING OVERLAY — one awaited server job, indicative progress */}
      {extracting && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: T.scrim, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 460, background: "var(--card)", borderRadius: 24, padding: 30, boxShadow: "var(--shadow)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 26, color: "var(--purple)", animation: "pdsSpin 1.4s linear infinite" }}>progress_activity</span>
              <div style={{ fontSize: 19, fontWeight: 700 }}>Cloning {firstName}</div>
            </div>
            <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 20 }}>Reading {totalCount} {totalCount === 1 ? "transcript" : "transcripts"} · {kChars(totalChars)} characters · takes about a minute or two</div>
            <div style={{ height: 6, borderRadius: 9999, background: "var(--track)", overflow: "hidden", marginBottom: 22 }}>
              <div style={{ height: "100%", width: `${Math.round(((passIdx + 1) / PASS_DEFS.length) * 100)}%`, background: "linear-gradient(90deg, var(--purple), var(--accent))", borderRadius: 9999, transition: "width .4s ease" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {PASS_DEFS.map((p, i) => {
                const done = i < passIdx, active = i === passIdx;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20, color: done ? "var(--success-ink)" : active ? "var(--purple)" : "var(--ink3)", animation: active ? "pdsPulse 1s ease-in-out infinite" : "none" }}>{done ? "check_circle" : p.icon}</span>
                    <span style={{ fontSize: 13.5, fontWeight: active ? 700 : 500, color: done ? "var(--ink2)" : active ? "var(--ink1)" : "var(--ink3)" }}>{p.label}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 16 }}>Progress is indicative. Extraction runs as one job on the server and this screen waits for it to finish.</div>
          </div>
        </div>
      )}

      {/* corrections from the recording — review before anything changes */}
      {corrOpen && (
        <div onClick={() => !corrApplying && setCorrOpen(null)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(2,2,20,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} className="pds-scroll" style={{ width: "min(680px, 100%)", maxHeight: "80vh", overflowY: "auto", background: "var(--card)", borderRadius: 20, boxShadow: "var(--shadow)", padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--purple)" }}>movie</span>
              <div style={{ fontSize: 16, fontWeight: 800 }}>What the recording corrects</div>
              <button onClick={() => setCorrOpen(null)} disabled={corrApplying} style={{ marginLeft: "auto", width: 30, height: 30, borderRadius: 9, border: "none", background: "var(--ghost)", color: "var(--ink1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><span className="material-symbols-rounded" style={{ fontSize: 17 }}>close</span></button>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 14, lineHeight: 1.5 }}>
              The storyboard was drafted from words alone — these fixes come from watching what {firstName} actually had on screen. Nothing changes until you apply.
            </div>
            {corrLoading && <div style={{ fontSize: 13, color: "var(--ink3)", padding: "18px 0" }}>Comparing the storyboard against the recording…</div>}
            {corrErr && <div style={{ fontSize: 12.5, color: "var(--error-ink)", fontWeight: 600, padding: "8px 0" }}>{corrErr}</div>}
            {!corrLoading && !corrErr && !corrList.length && <div style={{ fontSize: 13, color: "var(--ink3)", padding: "14px 0" }}>No material corrections — the storyboard already matches the recording.</div>}
            {corrList.map((c, i) => (
              <div key={i} style={{ borderTop: i ? "1px solid var(--divider)" : "none", padding: "12px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 9999, background: "var(--purple-soft)", color: "var(--purple-ink)" }}>{c.kind}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink3)" }}>{c.stageId}</span>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                  <span style={{ color: "var(--error-ink)", textDecoration: "line-through", textDecorationThickness: 1 }}>{c.before}</span>
                  <span style={{ color: "var(--ink3)" }}> → </span>
                  <span style={{ color: "var(--success-ink)", fontWeight: 600 }}>{c.after}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4 }}>{c.why}</div>
              </div>
            ))}
            {!corrLoading && corrDraft && corrList.length > 0 && (
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button onClick={() => void applyCorrections()} disabled={corrApplying} style={{ height: 42, padding: "0 20px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", opacity: corrApplying ? 0.6 : 1, fontFamily: "inherit" }}>
                  {corrApplying ? "Applying…" : `Apply all ${corrList.length} to the storyboard`}
                </button>
                <button onClick={() => setCorrOpen(null)} disabled={corrApplying} style={{ background: "none", border: "none", color: "var(--ink2)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Not now</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
