import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { api, getAccessKey } from "../api/client";
import PdsNav from "../components/PdsNav";
import "../pds.css";

// ============================================================
// Storyboard — Perfect Design System 2026 (screenmap view).
// The CONSOLIDATED storyboard editor: one screen, two columns.
//   Left  — the beat list (numbered, reorderable, add/drop).
//   Right — the selected beat: name + goal, a VOICE block
//           (what she SAYS) and a SCREEN block (what she DOES).
// A top bar reshapes the whole flow from one instruction
// (preview -> confirm), shows the saved/dirty state and a Done
// button back to the room.
// Wired to GET/PUT /api/clones/:id/playbook and
//          POST /api/clones/:id/playbook/reshape.
// Hand-off: on mount, localStorage "sb_open_beat" (a beat id or
// index) selects that beat, then the key is cleared.
// ============================================================

// Local, permissive mirrors of @jarvis/shared's CallStage / CallPlaybook.
// Index signatures keep any fields we don't edit (wireframe.regions,
// voice.moves, facts, objections, closes, sources, …) intact on save.
type Voice = { objective?: string; moves?: string[]; exampleLines?: string[]; listenFor?: string[] } & Record<string, unknown>;
type Screen = { actions?: string[]; waitBehavior?: string } & Record<string, unknown>;
type Wireframe = { archetype?: string; screenTitle?: string; regions?: string[] } & Record<string, unknown>;
type Stage = {
  id: string;
  name: string;
  goal?: string;
  exitCriteria?: string;
  wireframe?: Wireframe;
  voice?: Voice;
  screen?: Screen;
} & Record<string, unknown>;
type Playbook = { stages: Stage[]; graphVersion?: number } & Record<string, unknown>;
type Agent = { id: string; name: string; role?: string };
type SaveResp = { ok: boolean; playbook: Playbook; goldenRecompiled?: boolean };

// The real screen-control tool set. Actions are free text on save; a chip just
// drops a canonical, editable phrase into the list. Wording mirrors the draft
// prompt in apps/bff/src/routes/studio.ts (GoPerfect product verbs).
const CAPABILITIES: { label: string; icon: string; action: string }[] = [
  { label: "Create position", icon: "add_box", action: "open a new outbound position" },
  { label: "Send brief", icon: "send", action: "send the role brief" },
  { label: "Show screen", icon: "desktop_windows", action: "show the ranked candidates" },
  { label: "Start matching", icon: "join_inner", action: "start matching" },
  { label: "Answer card", icon: "quiz", action: "answer the match-card question" },
  { label: "Read screen", icon: "visibility", action: "read what's on the current screen" },
];

const btnFont: CSSProperties = { fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const selectStyle: CSSProperties = { height: 34, borderRadius: 10, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12.5, padding: "0 10px" };
const kicker: CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)" };
const fieldLabel: CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginBottom: 5, display: "block" };
const textInput: CSSProperties = { width: "100%", height: 38, borderRadius: 10, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 13, padding: "0 12px", outline: "none", boxSizing: "border-box" };

function voiceOf(s: Stage): Voice { return s.voice ?? {}; }
function screenOf(s: Stage): Screen { return s.screen ?? {}; }
function exampleLinesOf(s: Stage): string[] { return Array.isArray(voiceOf(s).exampleLines) ? (voiceOf(s).exampleLines as string[]) : []; }
function listenForOf(s: Stage): string[] { return Array.isArray(voiceOf(s).listenFor) ? (voiceOf(s).listenFor as string[]) : []; }
function actionsOf(s: Stage): string[] { return Array.isArray(screenOf(s).actions) ? (screenOf(s).actions as string[]) : []; }

// -- small editable-list of single-line inputs (example lines, actions) --
function ListEditor({ items, onChange, placeholder, addLabel }: { items: string[]; onChange: (next: string[]) => void; placeholder: string; addLabel: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((val, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={val}
            onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))}
            placeholder={placeholder}
            style={{ ...textInput, height: 34, fontSize: 12.5 }}
          />
          <button
            onClick={() => onChange(items.filter((_, k) => k !== i))}
            title="Remove"
            style={{ flex: "0 0 auto", width: 30, height: 30, borderRadius: 8, border: "none", background: "var(--ghost)", color: "var(--ink3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, ""])}
        style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5, height: 30, padding: "0 12px", borderRadius: 9999, border: "1px dashed var(--border)", background: "transparent", color: "var(--ink2)", ...btnFont, fontSize: 11.5 }}
      >
        <span className="material-symbols-rounded" style={{ fontSize: 15 }}>add</span>{addLabel}
      </button>
    </div>
  );
}

// -- chip list with an inline add box (listen-for cues) --
function ChipEditor({ items, onChange, placeholder }: { items: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...items, t]);
    setDraft("");
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center" }}>
      {items.map((c, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 6px 4px 11px", borderRadius: 9999, background: "var(--success-soft)", color: "var(--success-ink)", fontSize: 12, fontWeight: 700 }}>
          {c}
          <button onClick={() => onChange(items.filter((_, k) => k !== i))} title="Remove" style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", display: "flex", alignItems: "center", padding: 0 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 14 }}>close</span>
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        onBlur={commit}
        placeholder={placeholder}
        style={{ flex: "1 1 140px", minWidth: 120, height: 32, borderRadius: 9999, border: "1px dashed var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12, padding: "0 12px", outline: "none" }}
      />
    </div>
  );
}

export default function ScreenMap() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [selIdx, setSelIdx] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string>("");
  // drag to reorder the beat list
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [armIdx, setArmIdx] = useState<number | null>(null);

  const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(""), 4000); };

  // ---- agents ----
  useEffect(() => {
    void (async () => {
      const list = await api.get<Agent[]>("/api/agents").catch(() => [] as Agent[]);
      setAgents(list);
      const stored = (() => { try { return localStorage.getItem("pds_agent"); } catch { return null; } })();
      const pick = list.find((a) => a.id === stored)?.id ?? list[0]?.id ?? "";
      setAgentId(pick);
      if (!pick) setLoading(false);
    })();
  }, []);

  // ---- playbook + the sb_open_beat hand-off ----
  useEffect(() => {
    if (!agentId) return;
    try { localStorage.setItem("pds_agent", agentId); } catch { /* ignore */ }
    setLoading(true); setDirty(false);
    void (async () => {
      const pb = await api.get<{ playbook: Playbook }>(`/api/clones/${agentId}/playbook`).catch(() => null);
      const stgs = Array.isArray(pb?.playbook?.stages) ? (pb!.playbook.stages as Stage[]) : [];
      // Hand-off: the room may point us at a specific beat (id or index).
      let target = 0;
      try {
        const raw = localStorage.getItem("sb_open_beat");
        if (raw != null) {
          localStorage.removeItem("sb_open_beat");
          const byId = stgs.findIndex((s) => s.id === raw);
          if (byId >= 0) target = byId;
          else { const n = parseInt(raw, 10); if (Number.isFinite(n) && n >= 0 && n < stgs.length) target = n; }
        }
      } catch { /* ignore */ }
      setPlaybook(pb?.playbook ?? null);
      setSelIdx(target);
      setLoading(false);
    })();
  }, [agentId]);

  const stages = useMemo(() => playbook?.stages ?? [], [playbook]);
  const agent = agents.find((a) => a.id === agentId);
  const agentName = agent?.name ?? "this clone";
  const version = typeof playbook?.graphVersion === "number" ? playbook.graphVersion : 1;

  // keep the selection in range as the beat list changes
  useEffect(() => {
    if (!stages.length) { if (selIdx !== 0) setSelIdx(0); return; }
    if (selIdx > stages.length - 1) setSelIdx(stages.length - 1);
    else if (selIdx < 0) setSelIdx(0);
  }, [stages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = stages[selIdx];

  // ---- mutation helpers ----
  function mutate(next: Playbook) { setPlaybook(next); setDirty(true); }
  function mutStage(i: number, patch: Partial<Stage>) {
    if (!playbook) return;
    mutate({ ...playbook, stages: stages.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  }
  function setVoice(i: number, patch: Partial<Voice>) { mutStage(i, { voice: { ...voiceOf(stages[i]), ...patch } }); }
  function setScreen(i: number, patch: Partial<Screen>) { mutStage(i, { screen: { ...screenOf(stages[i]), ...patch } }); }

  function addBeat() {
    if (!playbook) return;
    const id = (() => { try { return crypto.randomUUID(); } catch { return `stage-${Date.now()}`; } })();
    const beat: Stage = {
      id,
      name: `Beat ${stages.length + 1}`,
      goal: "",
      wireframe: { archetype: "talk-only", screenTitle: "", regions: [] },
      voice: { objective: "", moves: [], exampleLines: [], listenFor: [] },
      screen: { actions: [], waitBehavior: "" },
      exitCriteria: "",
    };
    mutate({ ...playbook, stages: [...stages, beat] });
    setSelIdx(stages.length);
  }
  function dropBeat(i: number) {
    if (!playbook) return;
    const next = stages.filter((_, k) => k !== i);
    mutate({ ...playbook, stages: next });
    setSelIdx((cur) => (cur > i ? cur - 1 : cur === i ? Math.min(i, next.length - 1) : cur));
  }
  function moveBeat(from: number, to: number) {
    if (!playbook || from === to || from < 0 || to < 0 || from >= stages.length || to >= stages.length) return;
    const keepSel = stages[selIdx];
    const next = [...stages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    mutate({ ...playbook, stages: next });
    const ns = next.indexOf(keepSel);
    setSelIdx(ns >= 0 ? ns : Math.min(selIdx, next.length - 1));
  }

  async function save() {
    if (!agentId || !playbook || saving) return;
    setSaving(true);
    const clean = (a: string[]) => a.map((x) => x.trim()).filter(Boolean);
    const norm: Playbook = {
      ...playbook,
      stages: stages.map((s) => ({
        ...s,
        voice: { ...voiceOf(s), exampleLines: clean(exampleLinesOf(s)), listenFor: clean(listenForOf(s)) },
        screen: { ...screenOf(s), actions: clean(actionsOf(s)) },
      })),
    };
    try {
      const r = await api.put<SaveResp>(`/api/clones/${agentId}/playbook`, { playbook: norm });
      setPlaybook(r.playbook ?? norm);
      setDirty(false);
      flash(r.goldenRecompiled ? "Saved · live prompt updated" : "Saved");
    } catch (e) { alert("Save failed: " + (e instanceof Error ? e.message : String(e))); }
    setSaving(false);
  }

  // ---- reshape the whole flow from one instruction (preview -> confirm) ----
  const [reshapeText, setReshapeText] = useState("");
  const [reshapeBusy, setReshapeBusy] = useState(false);
  const [reshapeErr, setReshapeErr] = useState("");
  const [reshapeProp, setReshapeProp] = useState<Playbook | null>(null);
  const [reshapeOpen, setReshapeOpen] = useState(false);

  function reshapeDiff(cur: Stage[], prop: Stage[]): { name: string; label: string }[] {
    const key = (st: Stage, i: number) => String((st as { id?: string }).id ?? `i${i}`);
    const curBy = new Map(cur.map((st, i) => [key(st, i), { st, i }]));
    const propIds = new Set(prop.map((st, i) => key(st, i)));
    const rows = prop.map((st, i) => {
      const k = key(st, i);
      const old = curBy.get(k);
      let label = "added";
      if (old) label = JSON.stringify(old.st) === JSON.stringify(st) ? (old.i === i ? "unchanged" : "moved") : "changed";
      return { name: String(st.name ?? `Beat ${i + 1}`), label };
    });
    for (const [k, v] of curBy) if (!propIds.has(k)) rows.push({ name: String(v.st.name ?? "beat"), label: "removed" });
    return rows;
  }
  async function proposeReshape() {
    const t = reshapeText.trim();
    if (!t || reshapeBusy || !agentId) return;
    setReshapeBusy(true); setReshapeErr(""); setReshapeProp(null); setReshapeOpen(true);
    try {
      const res = await fetch(`${api.base}/api/clones/${agentId}/playbook/reshape`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getAccessKey() ? { "X-API-Key": getAccessKey() } : {}) },
        body: JSON.stringify({ instruction: t }),
      });
      const jj = (await res.json().catch(() => ({}))) as { playbook?: Playbook; error?: string };
      if (!res.ok || !jj.playbook) throw new Error(jj.error || `reshape → ${res.status}`);
      setReshapeProp(jj.playbook);
    } catch (e) { setReshapeErr(e instanceof Error ? e.message : String(e)); }
    setReshapeBusy(false);
  }
  async function applyReshape() {
    if (!reshapeProp || reshapeBusy || !agentId) return;
    setReshapeBusy(true); setReshapeErr("");
    try {
      const cur = await api.get<{ playbook: Playbook }>(`/api/clones/${agentId}/playbook`);
      const gv = (Number((cur.playbook as Record<string, unknown>)?.graphVersion) || 1) + 1;
      const next = { ...cur.playbook, ...reshapeProp, graphVersion: gv } as Playbook;
      const r = await api.put<SaveResp>(`/api/clones/${agentId}/playbook`, { playbook: next });
      setPlaybook(r.playbook ?? next);
      setDirty(false);
      setSelIdx(0);
      setReshapeOpen(false); setReshapeProp(null); setReshapeText("");
      flash("Flow reshaped");
    } catch (e) { setReshapeErr(e instanceof Error ? e.message : String(e)); }
    setReshapeBusy(false);
  }

  // ---- render ----
  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)", color: "var(--ink1)" }}>
      <PdsNav active="screenmap" theme={theme} onTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />

      {/* ---------- top bar ---------- */}
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "14px clamp(14px,3vw,32px) 0", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
            Storyboard
            <span style={{ color: "var(--ink3)", fontWeight: 700 }}>· {agentName}</span>
          </div>
          {agents.length > 1 && (
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ ...selectStyle, height: 26, marginTop: 4, fontSize: 11.5 }}>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>

        {/* reshape by instruction */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 260, maxWidth: 520 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 18, color: "var(--purple)" }}>auto_fix_high</span>
          <input
            value={reshapeText}
            onChange={(e) => setReshapeText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void proposeReshape(); }}
            placeholder="Reshape by instruction — e.g. move pricing before autopilot"
            style={{ ...textInput, height: 36, fontSize: 12.5 }}
          />
          <button onClick={() => void proposeReshape()} disabled={reshapeBusy || !reshapeText.trim()} style={{ flex: "0 0 auto", height: 36, padding: "0 15px", borderRadius: 9999, border: "1px solid var(--purple)", background: "transparent", color: "var(--purple-ink)", ...btnFont, fontSize: 12, opacity: reshapeBusy || !reshapeText.trim() ? 0.55 : 1 }}>
            {reshapeBusy && !reshapeProp ? "Previewing…" : "Preview"}
          </button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {/* save / dirty indicator */}
          <button onClick={() => void save()} disabled={!dirty || saving} style={{ display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 16px", borderRadius: 9999, border: "none", background: dirty ? "#FF0660" : "var(--ghost)", color: dirty ? "#fff" : "var(--ink3)", boxShadow: dirty ? "0 8px 24px rgba(255,6,96,.3)" : "none", ...btnFont, fontSize: 12.5, cursor: dirty ? "pointer" : "default", opacity: saving ? 0.7 : 1 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 17 }}>{dirty ? "save" : "check_circle"}</span>
            {saving ? "Saving…" : dirty ? "Save changes" : `Saved · script v${version}`}
          </button>
          <button onClick={() => nav("rehearsal")} title="Back to the room" style={{ display: "flex", alignItems: "center", gap: 6, height: 38, padding: "0 15px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink1)", ...btnFont, fontSize: 12.5 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 17 }}>done</span>Done
          </button>
        </div>
      </div>

      {/* ---------- reshape preview modal ---------- */}
      {reshapeOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(2,2,20,.6)", display: "grid", placeItems: "center" }} onClick={() => !reshapeBusy && setReshapeOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "94vw", maxHeight: "84vh", overflowY: "auto", background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: "22px 24px" }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Reshape the storyboard</div>
            <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.5, marginBottom: 12 }}>One instruction reshapes the whole flow — review the per-beat diff before anything is applied.</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)", background: "var(--sunk)", borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>“{reshapeText}”</div>
            {reshapeBusy && !reshapeProp && <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>Reshaping…</div>}
            {reshapeErr && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--error-ink)", marginTop: 4 }}>{reshapeErr}</div>}
            {reshapeProp && (
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 8 }}>Proposed flow · per-beat diff</div>
                {reshapeDiff(stages, (reshapeProp.stages ?? []) as Stage[]).map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 9, background: i % 2 ? "transparent" : "var(--sunk)" }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em", padding: "1px 8px", borderRadius: 9999, background: r.label === "added" ? "var(--success-soft)" : r.label === "removed" ? "var(--error-soft)" : r.label === "changed" ? "var(--purple-soft)" : r.label === "moved" ? "rgba(0,187,255,.15)" : "var(--ghost)", color: r.label === "added" ? "var(--success-ink)" : r.label === "removed" ? "var(--error-ink)" : r.label === "changed" ? "var(--purple-ink)" : r.label === "moved" ? "var(--decor)" : "var(--ink3)" }}>{r.label.toUpperCase()}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, textDecoration: r.label === "removed" ? "line-through" : "none", opacity: r.label === "removed" ? 0.6 : 1 }}>{r.name}</span>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
                  <button onClick={() => void applyReshape()} disabled={reshapeBusy} style={{ height: 42, padding: "0 20px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", opacity: reshapeBusy ? 0.6 : 1, fontFamily: "inherit" }}>{reshapeBusy ? "Applying…" : "Confirm — apply this flow"}</button>
                  <button onClick={() => setReshapeProp(null)} disabled={reshapeBusy} style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Discard proposal</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- body: two columns ---------- */}
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "20px clamp(14px,3vw,32px) 60px" }}>
        {loading ? (
          <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", textAlign: "center", padding: 40, color: "var(--ink3)", fontSize: 13.5 }}>Loading the storyboard…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>
            {/* ===== left: beat list ===== */}
            <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: 12, position: "sticky", top: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 10px" }}>
                <span style={kicker}>Beats</span>
                <span style={{ fontSize: 11, color: "var(--ink3)" }}>{stages.length}</span>
                <button onClick={addBeat} title="Add a beat" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, height: 28, padding: "0 11px", borderRadius: 9999, border: "none", background: "var(--purple-soft)", color: "var(--purple-ink)", ...btnFont, fontSize: 11.5 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 15 }}>add</span>Add beat
                </button>
              </div>

              {stages.length === 0 ? (
                <div style={{ padding: "20px 10px", textAlign: "center", color: "var(--ink3)", fontSize: 12.5 }}>No beats yet. Add the first one.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {stages.map((s, i) => {
                    const active = i === selIdx;
                    const dropTarget = dragIdx !== null && dragIdx !== i && overIdx === i;
                    return (
                      <div
                        key={s.id}
                        draggable={armIdx === i}
                        onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { setDragIdx(null); setOverIdx(null); setArmIdx(null); }}
                        onDragOver={(e) => { if (dragIdx !== null) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overIdx !== i) setOverIdx(i); } }}
                        onDragLeave={() => { if (overIdx === i) setOverIdx(null); }}
                        onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) moveBeat(dragIdx, i); setDragIdx(null); setOverIdx(null); setArmIdx(null); }}
                        onMouseUp={() => setArmIdx(null)}
                        onClick={() => setSelIdx(i)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "8px 8px", borderRadius: 12, cursor: "pointer",
                          background: active ? "var(--purple-soft)" : "transparent",
                          outline: dropTarget ? "2px solid var(--purple)" : "2px solid transparent", outlineOffset: -2,
                          opacity: dragIdx === i ? 0.5 : 1, transition: "background .12s, outline-color .12s",
                        }}
                      >
                        <span
                          onMouseDown={(e) => { e.stopPropagation(); setArmIdx(i); }}
                          onClick={(e) => e.stopPropagation()}
                          title="Drag to reorder"
                          className="material-symbols-rounded"
                          style={{ fontSize: 17, color: "var(--ink3)", cursor: "grab", userSelect: "none" }}
                        >drag_indicator</span>
                        <span style={{ flex: "0 0 auto", width: 22, height: 22, borderRadius: 7, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, background: active ? "var(--purple)" : "var(--ghost)", color: active ? "#fff" : "var(--ink2)" }}>{i + 1}</span>
                        <span style={{ flex: 1, fontSize: 12.5, fontWeight: active ? 800 : 600, color: "var(--ink1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name || `Beat ${i + 1}`}</span>
                        <button onClick={(e) => { e.stopPropagation(); dropBeat(i); }} title="Drop this beat" style={{ flex: "0 0 auto", width: 24, height: 24, borderRadius: 7, border: "none", background: "transparent", color: "var(--ink3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span className="material-symbols-rounded" style={{ fontSize: 15 }}>delete</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ===== right: selected beat editor ===== */}
            {!sel ? (
              <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: 40, textAlign: "center", color: "var(--ink3)" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 32, color: "var(--purple)" }}>theaters</span>
                <div style={{ fontSize: 15, fontWeight: 700, margin: "10px 0 4px", color: "var(--ink1)" }}>No beat selected</div>
                <div style={{ fontSize: 12.5 }}>Add a beat on the left to start the storyboard.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* beat header: name + goal */}
                <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <span style={{ flex: "0 0 auto", width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800, background: "var(--purple)", color: "#fff" }}>{selIdx + 1}</span>
                    <input
                      value={sel.name}
                      onChange={(e) => mutStage(selIdx, { name: e.target.value })}
                      placeholder="Name this beat"
                      style={{ flex: 1, fontSize: 17, fontWeight: 800, fontFamily: "inherit", color: "var(--ink1)", background: "transparent", border: "none", outline: "none", padding: 0 }}
                    />
                  </div>
                  <label style={fieldLabel}>Goal — what this beat is for</label>
                  <input
                    value={sel.goal ?? ""}
                    onChange={(e) => mutStage(selIdx, { goal: e.target.value })}
                    placeholder="e.g. get them to feel the time saved sourcing"
                    style={textInput}
                  />
                </div>

                {/* VOICE */}
                <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--purple)" }}>record_voice_over</span>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>Voice</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>what {agentName} says</div>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={fieldLabel}>Objective</label>
                    <input
                      value={voiceOf(sel).objective ?? ""}
                      onChange={(e) => setVoice(selIdx, { objective: e.target.value })}
                      placeholder="What she's trying to land, in one line"
                      style={textInput}
                    />
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={fieldLabel}>Example lines</label>
                    <ListEditor
                      items={exampleLinesOf(sel)}
                      onChange={(next) => setVoice(selIdx, { exampleLines: next })}
                      placeholder="A line she could say here"
                      addLabel="Add line"
                    />
                  </div>

                  <div>
                    <label style={fieldLabel}>Listen for</label>
                    <ChipEditor
                      items={listenForOf(sel)}
                      onChange={(next) => setVoice(selIdx, { listenFor: next })}
                      placeholder="Add a cue + Enter"
                    />
                  </div>
                </div>

                {/* SCREEN */}
                <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--decor)" }}>desktop_windows</span>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>Screen</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>what {agentName} does</div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={fieldLabel}>Actions</label>
                    <ListEditor
                      items={actionsOf(sel)}
                      onChange={(next) => setScreen(selIdx, { actions: next })}
                      placeholder="An on-screen action, in order"
                      addLabel="Add action"
                    />
                  </div>

                  {/* capability chips — append an editable canonical action */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
                    {CAPABILITIES.map((c) => (
                      <button
                        key={c.label}
                        onClick={() => setScreen(selIdx, { actions: [...actionsOf(sel), c.action] })}
                        title={`Append: ${c.action}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 12px", borderRadius: 9999, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink2)", ...btnFont, fontSize: 11.5 }}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: 15, color: "var(--decor)" }}>{c.icon}</span>{c.label}
                      </button>
                    ))}
                  </div>

                  <div>
                    <label style={fieldLabel}>While the screen works…</label>
                    <input
                      value={screenOf(sel).waitBehavior ?? ""}
                      onChange={(e) => setScreen(selIdx, { waitBehavior: e.target.value })}
                      placeholder="What she does during loaders / async work"
                      style={textInput}
                    />
                  </div>
                </div>

                {/* exit cue */}
                <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: "18px 20px" }}>
                  <label style={{ ...fieldLabel, color: "var(--success-ink)" }}>Exit cue — when to move on</label>
                  <input
                    value={sel.exitCriteria ?? ""}
                    onChange={(e) => mutStage(selIdx, { exitCriteria: e.target.value })}
                    placeholder="when they … → next beat"
                    style={textInput}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {dirty && !loading && (
          <div style={{ marginTop: 18, fontSize: 12.5, color: "var(--warning-ink)", display: "flex", alignItems: "center", gap: 7 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>info</span>
            Unsaved changes. Save to push them to {agentName}'s playbook.
          </div>
        )}
      </div>

      {/* toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 60, display: "flex", alignItems: "center", gap: 8, background: "var(--ink1)", color: "var(--card)", borderRadius: 9999, padding: "10px 18px", fontSize: 12.5, fontWeight: 700, boxShadow: "0 12px 32px rgba(0,0,0,.3)" }}>
          <span className="material-symbols-rounded" style={{ fontSize: 17 }}>bolt</span>
          {toast}
        </div>
      )}
    </div>
  );
}
