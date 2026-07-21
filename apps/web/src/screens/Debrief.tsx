import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api, getAccessKey } from "../api/client";
import PdsNav from "../components/PdsNav";
import ReportCallModal from "../components/ReportCallModal";
import ReferralShare from "../components/ReferralShare";
import "../pds.css";

// ============================================================
// Post-call debrief — first screen of the Perfect Design System
// 2026 (from the Claude Design project, Post-Call Debrief.dc.html).
// Nudge-to-delta diff cards, memory extraction, create persona vN.
// Wired to the real debrief API: build from a calibration session
// or a note-taker call, Apply = real PersonaDelta -> new version.
// ============================================================

type Delta = { id: string; tag: "Nudge" | "Grounding" | "Rating"; src: string; before: string; after: string; state?: string };
type Memory = { icon: string; text: string; prov: string; kind: string };
type DebriefData = {
  title: string; who: string; when: string;
  stats: { durationMin: number; moments: number; nudges: number; groundingFlags: number };
  banner?: string | null; deltas: Delta[]; memory: Memory[]; finalizedVersion?: number | null;
};
type Agent = { id: string; name: string; role?: string };
type SourceRow = { id: string; title?: string; chars: number };
// film review (persisted timeline + screenshots for a finished call)
type TimelineEvent = { kind: "guest" | "maya" | "action"; text: string; shot?: number };
type Moment = { guest: string; maya: string; action: string; shot?: number };
type FixProposal = Record<string, unknown> & { summary?: string; stageName?: string; before?: unknown; after?: unknown };

const ACTION_LABELS: Record<string, string> = {
  new_position: "created position",
  ask_perfect: "sent brief",
  answer_question: "answered card",
  show_screen: "navigated",
  read_screen: "read screen",
  start_matching: "started matching",
  skip_candidate: "skipped candidate",
  start_autopilot: "started autopilot",
};
function prettyAction(text: string): string {
  const name = text.trim().split(/\s/)[0] ?? text;
  return ACTION_LABELS[name] ?? name.replace(/_/g, " ");
}
function listify(v: unknown): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.map(String).join(" → ");
  if (typeof v === "object") {
    // screen-route proposals return { actions, waitBehavior }
    const o = v as { actions?: unknown; waitBehavior?: unknown };
    const acts = Array.isArray(o.actions) ? o.actions.map(String).join(" → ") : "";
    const wait = o.waitBehavior ? String(o.waitBehavior) : "";
    return [acts, wait ? `while it works: ${wait}` : ""].filter(Boolean).join(" · ");
  }
  return String(v);
}

const TAGC: Record<string, { bg: string; color: string; icon: string }> = {
  Nudge: { bg: "rgba(0,187,255,.18)", color: "var(--decor)", icon: "ads_click" },
  Grounding: { bg: "var(--warning-soft)", color: "var(--warning-ink)", icon: "flag" },
  Rating: { bg: "var(--purple-soft)", color: "var(--purple-ink)", icon: "thumb_down" },
};
const pill: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 9999 };
const card: CSSProperties = { background: "var(--card)", borderRadius: 16, boxShadow: "var(--shadow)", padding: 18 };
const btnFont: CSSProperties = { fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" };

export default function Debrief() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [debriefId, setDebriefId] = useState<string | null>(null);
  const [data, setData] = useState<DebriefData | null>(null);
  const [status, setStatus] = useState<Record<string, "applied" | "skipped">>({});
  const [building, setBuilding] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [done, setDone] = useState<{ version: number; applied: number; scenarios: number } | null>(null);
  // picker (no debrief yet)
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [reportOpen, setReportOpen] = useState(false);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [srcId, setSrcId] = useState<string>("");
  // film review
  const [film, setFilm] = useState<{ agentId: string; sourceId: string; moments: Moment[] } | null>(null);
  const [shotUrls, setShotUrls] = useState<Record<number, string>>({});
  const shotCache = useRef<Record<string, string>>({});
  const [sel, setSel] = useState<number | null>(null);
  // call recording (Phase 1: replay the film + transcript; audio next)
  const [showTranscript, setShowTranscript] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [recUrl, setRecUrl] = useState<string | null>(null);
  const filmRef = useRef<HTMLDivElement | null>(null);
  // "Show off this call" — floats on the right when there's margin room for it.
  const [shareDismissed, setShareDismissed] = useState(false);
  const [floatShare, setFloatShare] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1240px)");
    const on = () => setFloatShare(mq.matches); on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const scrollToFilm = () => filmRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const [fixNote, setFixNote] = useState("");
  const [fixRoute, setFixRoute] = useState<"speech" | "screen">("screen");
  const [proposal, setProposal] = useState<FixProposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [fixErr, setFixErr] = useState<string | null>(null);
  const [fixed, setFixed] = useState<Record<number, string>>({});

  useEffect(() => {
    void (async () => {
      const latest = await api.get<{ debriefId: string | null; agentId?: string; data?: DebriefData }>("/api/debrief/latest").catch(() => null);
      if (latest?.debriefId && latest.data) {
        setDebriefId(latest.debriefId); setData(latest.data); seedStatus(latest.data);
        if (latest.agentId) void resolveFilm(latest.agentId, latest.data.who);
      }
      const list = await api.get<Agent[]>("/api/agents").catch(() => [] as Agent[]);
      setAgents(list);
      if (list.length) setAgentId(list[0].id);
    })();
  }, []);
  useEffect(() => {
    if (!agentId) return;
    void api.get<{ sources: SourceRow[] }>(`/api/clones/${agentId}/sources`).then((r) => { setSources(r.sources); if (r.sources.length) setSrcId(r.sources[r.sources.length - 1].id); }).catch(() => setSources([]));
  }, [agentId]);

  function seedStatus(d: DebriefData) {
    const s: Record<string, "applied" | "skipped"> = {};
    for (const dl of d.deltas) if (dl.state === "applied" || dl.state === "skipped") s[dl.id] = dl.state;
    setStatus(s);
    if (d.finalizedVersion) setDone({ version: d.finalizedVersion, applied: d.deltas.filter((x) => x.state === "applied").length, scenarios: 0 });
  }

  async function build() {
    if (!agentId || !srcId) return;
    setBuilding(true); setDone(null); setStatus({});
    try {
      const r = await api.post<{ debriefId: string; data: DebriefData }>("/api/debrief/build", { agentId, sourceId: srcId });
      setDebriefId(r.debriefId); setData(r.data);
      void loadFilm(agentId, srcId);
    } catch (e) { alert("Debrief failed: " + (e instanceof Error ? e.message : e)); }
    setBuilding(false);
  }

  // ---- film review: timeline + screenshots (only calls that left a film) ----
  function resetFilmPanel() { setSel(null); setFixNote(""); setFixRoute("screen"); setProposal(null); setFixErr(null); setFixed({}); }

  // The debrief row does not expose its source id, so find the source whose
  // title matches the debrief's who suffix ("{agent} · {source title}").
  async function resolveFilm(agId: string, who: string) {
    try {
      const r = await api.get<{ sources: SourceRow[] }>(`/api/clones/${agId}/sources`);
      const title = who.includes(" · ") ? who.split(" · ").slice(1).join(" · ") : who;
      const matches = r.sources.filter((s) => (s.title || "") === title);
      if (!matches.length) { setFilm(null); return; }
      await loadFilm(agId, matches[matches.length - 1].id);
    } catch { setFilm(null); }
  }

  async function loadFilm(agId: string, sourceId: string) {
    setFilm(null); resetFilmPanel(); setHasRecording(false);
    try {
      const r = await api.get<{ events: TimelineEvent[]; recording?: boolean }>(`/api/sources/${sourceId}/timeline`);
      // group each action with the nearest preceding guest line, and with her
      // narration: the last maya line before the action OR (tools usually fire
      // before she speaks) the first maya line after it, whichever exists
      const evs = r.events;
      const moments: Moment[] = [];
      let guest = ""; let maya = "";
      evs.forEach((e, i) => {
        if (e.kind === "guest") guest = e.text;
        else if (e.kind === "maya") maya = e.text;
        else if (e.kind === "action") {
          let narration = maya;
          if (!narration) {
            for (let j = i + 1; j < evs.length && evs[j].kind !== "action"; j++) {
              if (evs[j].kind === "maya") { narration = evs[j].text; break; }
            }
            if (!narration) { const nx = evs.slice(i + 1).find((x) => x.kind === "maya"); narration = nx?.text ?? ""; }
          }
          moments.push({ guest, maya: narration, action: e.text, shot: e.shot });
          maya = "";
        }
      });
      if (moments.length) { setFilm({ agentId: agId, sourceId, moments }); setHasRecording(!!r.recording); }
    } catch { /* 404: no film for this call */ }
  }

  // fetch the thumbnails as blobs (the endpoint needs X-API-Key)
  useEffect(() => {
    if (!film) { setShotUrls({}); return; }
    let gone = false;
    const key = getAccessKey();
    void (async () => {
      for (const m of film.moments) {
        if (m.shot === undefined) continue;
        const ck = `${film.sourceId}:${m.shot}`;
        if (shotCache.current[ck]) { setShotUrls((s) => ({ ...s, [m.shot as number]: shotCache.current[ck] })); continue; }
        try {
          const res = await fetch(`${api.base}/api/sources/${film.sourceId}/shot/${m.shot}`, { headers: key ? { "X-API-Key": key } : {} });
          if (!res.ok) continue;
          const url = URL.createObjectURL(await res.blob());
          shotCache.current[ck] = url;
          if (gone) return;
          setShotUrls((s) => ({ ...s, [m.shot as number]: url }));
        } catch { /* no screenshot then */ }
      }
    })();
    return () => { gone = true; };
  }, [film]);

  // fetch the call recording as a blob (the endpoint needs X-API-Key)
  useEffect(() => {
    if (!film || !hasRecording) { setRecUrl(null); return; }
    let gone = false; const key = getAccessKey();
    void (async () => {
      try {
        const res = await fetch(`${api.base}/api/sources/${film.sourceId}/recording`, { headers: key ? { "X-API-Key": key } : {} });
        if (!res.ok) return;
        const url = URL.createObjectURL(await res.blob());
        if (gone) { URL.revokeObjectURL(url); return; }
        setRecUrl(url);
      } catch { /* no recording then */ }
    })();
    return () => { gone = true; };
  }, [film, hasRecording]);

  function openMoment(i: number) {
    if (sel === i) { setSel(null); return; }
    setSel(i); setFixNote(""); setFixRoute("screen"); setProposal(null); setFixErr(null);
  }

  const selMoment = film && sel !== null ? film.moments[sel] : null;
  const momentPayload = selMoment ? { guest: selMoment.guest, maya: selMoment.maya, action: prettyAction(selMoment.action) } : null;

  async function proposeFilmFix() {
    if (!film || !momentPayload || !fixNote.trim() || proposing) return;
    setProposing(true); setFixErr(null);
    try {
      const r = await api.post<Record<string, unknown>>("/api/rehearsal/fix", { agentId: film.agentId, route: fixRoute, note: fixNote.trim(), moment: momentPayload });
      setProposal((r.proposal ?? r) as FixProposal);
    } catch (e) { setFixErr(e instanceof Error ? e.message : String(e)); }
    setProposing(false);
  }

  async function applyFilmFix() {
    if (!film || !momentPayload || !proposal || applying || sel === null) return;
    setApplying(true); setFixErr(null);
    try {
      const r = await api.post<Record<string, unknown>>("/api/rehearsal/fix", { agentId: film.agentId, route: fixRoute, note: fixNote.trim(), moment: momentPayload, apply: true, proposal });
      const v = fixRoute === "speech" ? r.personaVersion : r.graphVersion;
      setFixed((f) => ({ ...f, [sel]: `${fixRoute === "speech" ? "persona" : "graph"} v${typeof v === "number" ? v : "?"}` }));
      setProposal(null); setFixNote("");
    } catch (e) { setFixErr(e instanceof Error ? e.message : String(e)); }
    setApplying(false);
  }

  const pendingN = useMemo(() => (data ? data.deltas.filter((d) => !status[d.id]).length : 0), [data, status]);
  const appliedIds = useMemo(() => (data ? data.deltas.filter((d) => status[d.id] === "applied").map((d) => d.id) : []), [data, status]);

  async function finalize() {
    if (!debriefId || finalizing) return;
    const ids = appliedIds.length ? appliedIds : data?.deltas.filter((d) => status[d.id] !== "skipped").map((d) => d.id) ?? [];
    if (!ids.length) return;
    setFinalizing(true);
    try {
      const r = await api.post<{ version: number; applied: number; scenarios: number }>(`/api/debrief/${debriefId}/finalize`, { appliedIds: ids });
      setDone(r);
    } catch (e) { alert("Finalize failed: " + (e instanceof Error ? e.message : e)); }
    setFinalizing(false);
  }

  const scenarioN = appliedIds.length || (data ? data.deltas.filter((d) => status[d.id] !== "skipped").length : 0);

  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)" }}>
      <PdsNav
        active="debrief"
        theme={theme}
        onTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        context={<div style={{ fontSize: 11.5, color: "var(--ink3)" }}>{data ? `${data.who} · ${new Date(data.when).toLocaleDateString()}` : "pick a call to debrief"}</div>}
      />

      {/* "Show off this call" — floating share, pinned to the right of the screen */}
      {data && floatShare && !shareDismissed && (
        <div style={{ position: "fixed", right: 22, top: 110, width: 300, zIndex: 40 }}>
          <button onClick={() => setShareDismissed(true)} aria-label="Dismiss" style={{ position: "absolute", top: -9, right: -9, zIndex: 1, width: 26, height: 26, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink3)", cursor: "pointer", display: "grid", placeItems: "center", boxShadow: "var(--shadow)", fontFamily: "inherit" }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>close</span>
          </button>
          <ReferralShare loop="clip" wowTrigger="live_call" variant="brag" />
        </div>
      )}

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "26px 24px 140px" }}>
        {/* build picker */}
        <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", marginBottom: 22, flexWrap: "wrap" }}>
          <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--purple)" }}>graph_1</span>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ height: 36, borderRadius: 10, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 13, padding: "0 10px" }}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={srcId} onChange={(e) => setSrcId(e.target.value)} style={{ flex: 1, minWidth: 160, height: 36, borderRadius: 10, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 13, padding: "0 10px" }}>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
          </select>
          <button onClick={build} disabled={building || !srcId} style={{ height: 38, padding: "0 18px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", opacity: building ? 0.6 : 1, ...btnFont }}>
            {building ? "Analyzing the call…" : "Debrief this call"}
          </button>
          <button onClick={() => setReportOpen(true)} disabled={!srcId} title="Flag a problem on this call for the team" style={{ height: 38, padding: "0 14px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink1)", display: "inline-flex", alignItems: "center", gap: 6, opacity: srcId ? 1 : 0.5, ...btnFont }}>
            <span className="material-symbols-rounded" style={{ fontSize: 17, color: "var(--warning-ink)" }}>flag</span>Report this call
          </button>
        </div>

        {reportOpen && srcId && (
          <ReportCallModal
            callId={srcId}
            agentId={agentId}
            context={data ? `Post-call report — ${data.who}` : "Post-call report"}
            onClose={() => setReportOpen(false)}
          />
        )}

        {data && (
          <>
            {/* summary */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 22 }}>
              {[
                { v: `${data.stats.durationMin} min`, l: "Duration" },
                { v: String(data.stats.moments), l: "Moments" },
                { v: String(data.stats.nudges), l: "Nudges given" },
                { v: String(data.stats.groundingFlags), l: data.stats.groundingFlags === 1 ? "Grounding flag" : "Grounding flags", warn: data.stats.groundingFlags > 0 },
              ].map((s, i) => (
                <div key={i} style={{ ...card, border: s.warn ? "1.5px solid var(--warning)" : undefined }}>
                  <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: s.warn ? "var(--warning-ink)" : undefined }}>{s.v}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink3)", marginTop: 3 }}>{s.l}</div>
                </div>
              ))}
            </div>
            {data.banner && (
              <div style={{ fontSize: 12.5, color: "var(--ink2)", background: "var(--warning-soft)", borderRadius: 12, padding: "12px 16px", marginBottom: 26, display: "flex", alignItems: "center", gap: 9 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 18, color: "var(--warning-ink)" }}>flag</span>{data.banner}
              </div>
            )}

            {/* CALL RECORDING — replay the film + transcript (Phase 1; audio next) */}
            <div style={{ ...card, borderRadius: 18, padding: "16px 18px", marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: film && film.moments.length > 0 ? 12 : 4 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 21, color: "var(--purple-ink)" }}>smart_display</span>
                <span style={{ fontSize: 15.5, fontWeight: 800 }}>Call recording</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink3)" }}>{data.who} · {data.stats.durationMin} min</span>
              </div>
              {hasRecording && recUrl && (
                <audio controls src={recUrl} style={{ width: "100%", height: 42, marginBottom: 14 }} />
              )}
              {film && film.moments.length > 0 ? (
                <>
                  <div className="pds-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
                    {film.moments.slice(0, 10).map((m, i) => (
                      <button key={i} onClick={() => { openMoment(i); scrollToFilm(); }} title={m.maya || "screen"} style={{ flexShrink: 0, width: 116, padding: 0, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--sunk)", cursor: "pointer" }}>
                        {m.shot !== undefined && shotUrls[m.shot]
                          ? <img src={shotUrls[m.shot]} alt="" style={{ display: "block", width: "100%", height: 72, objectFit: "cover" }} />
                          : <div style={{ height: 72, display: "flex", alignItems: "center", justifyContent: "center" }}><span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--ink3)" }}>image</span></div>}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => { openMoment(0); scrollToFilm(); }} style={{ display: "flex", alignItems: "center", gap: 7, height: 40, padding: "0 18px", border: "none", borderRadius: 9999, background: "#FF0660", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 19 }}>play_arrow</span>Replay the call
                    </button>
                    <button onClick={() => setShowTranscript((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 7, height: 40, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9999, background: "transparent", color: "var(--ink1)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 18 }}>description</span>{showTranscript ? "Hide transcript" : "Transcript"}
                    </button>
                  </div>
                  {showTranscript && (
                    <div className="pds-scroll" style={{ marginTop: 14, maxHeight: 320, overflowY: "auto", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                      {film.moments.map((m, i) => (
                        <div key={i} style={{ marginBottom: 12 }}>
                          {m.guest && <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 3, lineHeight: 1.5 }}><b style={{ color: "var(--ink3)", fontWeight: 700 }}>{data.who}:</b> {m.guest}</div>}
                          {m.maya && <div style={{ fontSize: 12.5, color: "var(--ink1)", lineHeight: 1.5 }}><b style={{ color: "var(--purple-ink)", fontWeight: 700 }}>Clone:</b> {m.maya}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>No replay was captured for this call.</div>
              )}
              {hasRecording && recUrl ? (
                <a href={recUrl} download="call-recording.mp3" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 12.5, fontWeight: 700, color: "var(--ink2)", textDecoration: "none" }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 16 }}>download</span>Download audio
                </a>
              ) : (
                <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 15 }}>graphic_eq</span>Audio replay is coming soon.
                </div>
              )}
            </div>

            {/* film review — only when this call left a persisted timeline */}
            {film && film.moments.length > 0 && (
              <>
                <div ref={filmRef} style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, scrollMarginTop: 80 }}>Film review</div>
                <div style={{ fontSize: 12.5, color: "var(--ink3)", marginBottom: 14 }}>scrub the call, screen by screen</div>
                <div className="pds-scroll" style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6, marginBottom: sel !== null ? 14 : 32 }}>
                  {film.moments.map((m, i) => (
                    <button key={i} onClick={() => openMoment(i)} style={{ flexShrink: 0, width: 180, textAlign: "left", background: "var(--card)", borderRadius: 16, boxShadow: "var(--shadow)", border: sel === i ? "1.5px solid var(--purple)" : "1.5px solid transparent", padding: 10, color: "var(--ink1)", fontFamily: "inherit", cursor: "pointer" }}>
                      {m.shot !== undefined ? (
                        shotUrls[m.shot] ? (
                          <img src={shotUrls[m.shot]} alt={`screen at moment ${i + 1}`} style={{ display: "block", width: "100%", height: 96, objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)", marginBottom: 8 }} />
                        ) : (
                          <div style={{ width: "100%", height: 96, borderRadius: 12, border: "1px solid var(--border)", background: "var(--sunk)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "var(--ink3)", marginBottom: 8 }}>loading…</div>
                        )
                      ) : (
                        <div style={{ width: "100%", height: 96, borderRadius: 12, border: "1px solid var(--border)", background: "var(--sunk)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                          <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--ink3)" }}>image_not_supported</span>
                        </div>
                      )}
                      <span style={{ ...pill, background: "var(--purple-soft)", color: "var(--purple-ink)", fontSize: 10.5 }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 13 }}>ads_click</span>{prettyAction(m.action)}
                      </span>
                      {fixed[i] && (
                        <span style={{ ...pill, background: "var(--success-soft)", color: "var(--success-ink)", fontSize: 10.5, marginLeft: 5 }}>
                          <span className="material-symbols-rounded" style={{ fontSize: 13 }}>check</span>{fixed[i]}
                        </span>
                      )}
                      <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.maya || "no line at this moment"}</div>
                    </button>
                  ))}
                </div>
                {selMoment && sel !== null && (
                  <div style={{ ...card, borderRadius: 18, padding: "18px 20px", marginBottom: 32 }}>
                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                      {selMoment.shot !== undefined && (
                        <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                          {shotUrls[selMoment.shot] ? (
                            <img src={shotUrls[selMoment.shot]} alt="screen at this moment" style={{ display: "block", width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 12, border: "1px solid var(--border)", background: "var(--sunk)" }} />
                          ) : (
                            <div style={{ height: 160, borderRadius: 12, border: "1px solid var(--border)", background: "var(--sunk)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "var(--ink3)" }}>loading the screenshot…</div>
                          )}
                          <div style={{ fontSize: 10.5, color: "var(--ink3)", fontWeight: 700, marginTop: 5 }}>screen at this moment</div>
                        </div>
                      )}
                      <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                        <div style={{ background: "var(--sunk)", borderRadius: 13, padding: "12px 14px", marginBottom: 12 }}>
                          {selMoment.guest && (
                            <div style={{ display: "flex", gap: 8, fontSize: 11.5, lineHeight: 1.5, marginBottom: 7 }}>
                              <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)", width: 44, paddingTop: 2 }}>Guest</span>
                              <span>{selMoment.guest}</span>
                            </div>
                          )}
                          {selMoment.maya && (
                            <div style={{ display: "flex", gap: 8, fontSize: 11.5, lineHeight: 1.5, marginBottom: 7 }}>
                              <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)", width: 44, paddingTop: 2 }}>Rep</span>
                              <span>"{selMoment.maya}"</span>
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8, fontSize: 11.5, lineHeight: 1.5 }}>
                            <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)", width: 44, paddingTop: 2 }}>Screen</span>
                            <span style={{ color: "var(--purple-ink)", fontWeight: 600 }}>▸ {prettyAction(selMoment.action)}</span>
                          </div>
                        </div>
                        {fixed[sel] ? (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: "var(--success-ink)", background: "var(--success-soft)", borderRadius: 9999, padding: "8px 16px" }}>
                            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>check</span>Fix applied · {fixed[sel]}
                          </div>
                        ) : (
                          <>
                            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                              {(["speech", "screen"] as const).map((r) => (
                                <button key={r} onClick={() => { setFixRoute(r); setProposal(null); setFixErr(null); }} style={{ flex: 1, height: 34, borderRadius: 9999, border: fixRoute === r ? "1.5px solid var(--purple)" : "1.5px solid var(--border)", background: fixRoute === r ? "var(--purple-soft)" : "transparent", color: fixRoute === r ? "var(--purple-ink)" : "var(--ink2)", fontSize: 11.5, fontWeight: 800, ...btnFont }}>
                                  {r === "speech" ? "Speech · persona" : "Screen · graph"}
                                </button>
                              ))}
                            </div>
                            <textarea
                              value={fixNote}
                              onChange={(e) => setFixNote(e.target.value)}
                              rows={2}
                              placeholder={fixRoute === "speech" ? "What should she have said differently here?" : "What should the screen have done differently here?"}
                              style={{ width: "100%", boxSizing: "border-box", background: "var(--sunk)", border: "1px solid var(--border)", borderRadius: 13, padding: "10px 13px", fontSize: 11.5, lineHeight: 1.5, color: "var(--ink1)", fontFamily: "inherit", resize: "vertical", outline: "none", marginBottom: 10 }}
                            />
                            {proposal && fixRoute === "screen" && (
                              <div style={{ marginBottom: 10 }}>
                                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 7 }}>Change to graph{proposal.stageName ? ` · ${proposal.stageName}` : ""}</div>
                                <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                                  <div style={{ background: "var(--diff-del)", padding: "9px 13px" }}>
                                    <div style={{ fontSize: 8.5, fontWeight: 800, marginBottom: 2, color: "var(--error-ink)" }}>− BEFORE</div>
                                    <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--ink1)", margin: 0 }}>{listify(proposal.before) || "no actions on this beat"}</p>
                                  </div>
                                  <div style={{ background: "var(--diff-add)", padding: "9px 13px" }}>
                                    <div style={{ fontSize: 8.5, fontWeight: 800, marginBottom: 2, color: "var(--success-ink)" }}>+ AFTER</div>
                                    <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--ink1)", margin: 0 }}>{listify(proposal.after) || proposal.summary || "no change proposed"}</p>
                                  </div>
                                </div>
                              </div>
                            )}
                            {proposal && fixRoute === "speech" && (
                              <div style={{ marginBottom: 10 }}>
                                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 7 }}>Change to persona</div>
                                <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--ink1)" }}>{proposal.summary || "small persona adjustment"}</div>
                              </div>
                            )}
                            {fixErr && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--error-ink)", marginBottom: 10 }}>{fixErr}</div>}
                            <div style={{ display: "flex", gap: 9 }}>
                              {!proposal ? (
                                <button onClick={proposeFilmFix} disabled={!fixNote.trim() || proposing} style={{ flex: 1, height: 40, borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", opacity: !fixNote.trim() || proposing ? 0.6 : 1, ...btnFont }}>
                                  {proposing ? "Thinking…" : "Propose fix"}
                                </button>
                              ) : (
                                <button onClick={applyFilmFix} disabled={applying} style={{ flex: 1, height: 40, borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", opacity: applying ? 0.6 : 1, ...btnFont }}>
                                  {applying ? "Applying…" : "Apply"}
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* nudge to delta */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Turn each correction into a permanent change</div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink3)" }}>{pendingN} pending</span>
              <button onClick={() => setStatus(Object.fromEntries(data.deltas.map((d) => [d.id, "applied"])))} disabled={!!done} style={{ marginLeft: "auto", height: 38, padding: "0 16px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", ...btnFont }}>Apply all</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 32 }}>
              {data.deltas.map((d) => {
                const st = status[d.id];
                const tc = TAGC[d.tag] ?? TAGC.Nudge;
                return (
                  <div key={d.id} style={{ ...card, borderRadius: 18, padding: "18px 20px", opacity: st === "skipped" ? 0.5 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
                      <span style={{ ...pill, background: tc.bg, color: tc.color }}><span className="material-symbols-rounded" style={{ fontSize: 14 }}>{tc.icon}</span>{d.tag}</span>
                      <span style={{ fontSize: 12, color: "var(--ink3)" }}>{d.src}</span>
                      <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: st === "applied" ? "var(--success-ink)" : "var(--ink3)" }}>{st === "applied" ? "Applied" : st === "skipped" ? "Skipped" : ""}</span>
                    </div>
                    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: st ? 0 : 14 }}>
                      <div style={{ padding: "10px 13px", background: "var(--diff-del)" }}>
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--error-ink)", marginBottom: 2 }}>− before</div>
                        <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{d.before}</div>
                      </div>
                      <div style={{ padding: "10px 13px", background: "var(--diff-add)" }}>
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--success-ink)", marginBottom: 2 }}>+ after</div>
                        <div style={{ fontSize: 12.5, color: "var(--ink1)" }}>{d.after}</div>
                      </div>
                    </div>
                    {!st && !done && (
                      <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setStatus((s) => ({ ...s, [d.id]: "skipped" }))} style={{ flex: 1, height: 40, borderRadius: 9999, background: "transparent", border: "2px solid var(--border)", color: "var(--ink1)", ...btnFont }}>Skip</button>
                        <button onClick={() => setStatus((s) => ({ ...s, [d.id]: "applied" }))} style={{ flex: 1.4, height: 40, borderRadius: 9999, background: "var(--purple)", border: "none", color: "#fff", ...btnFont }}>Apply</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* memory extraction */}
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Memory extracted from this call</div>
            <div style={{ fontSize: 12.5, color: "var(--ink3)", marginBottom: 14 }}>Facts to remember about this account, each with where it came from.</div>
            <div style={{ ...card, borderRadius: 18, padding: "8px 20px" }}>
              {data.memory.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 0", borderBottom: i < data.memory.length - 1 ? "1px solid var(--divider)" : "none" }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 18, color: "var(--purple)", marginTop: 1 }}>{m.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.4 }}>{m.text}</div>
                    <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 3 }}>{m.prov}</div>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 9999, background: "var(--purple-soft)", color: "var(--purple-ink)" }}>{m.kind}</span>
                </div>
              ))}
              {!data.memory.length && <div style={{ padding: "13px 0", fontSize: 12.5, color: "var(--ink3)" }}>No account facts surfaced in this call.</div>}
            </div>
          </>
        )}
        {!data && !building && (
          <div style={{ ...card, borderRadius: 18, textAlign: "center", padding: 40, color: "var(--ink3)", fontSize: 13.5 }}>
            Pick a rep and a call above, then debrief it. Corrections become permanent persona changes; facts become account memory.
          </div>
        )}
      </div>

      {/* close bar */}
      {data && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 20, background: "var(--nav-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderTop: "1px solid var(--border)", padding: "14px 24px" }}>
          <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2)" }}>
              {done ? `Persona v${done.version} created · ${done.applied} corrections applied` : pendingN === 0 ? "All corrections reviewed" : `${pendingN} corrections still pending`}
            </div>
            <button onClick={finalize} disabled={!!done || finalizing || (appliedIds.length === 0 && pendingN === data.deltas.length)} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, height: 48, padding: "0 24px", borderRadius: 9999, background: done ? "var(--success)" : "#FF0660", border: "none", color: "#fff", fontSize: 14.5, fontWeight: 800, letterSpacing: ".02em", boxShadow: done ? "none" : "0 8px 24px rgba(255,6,96,.3)", fontFamily: "inherit", cursor: done ? "default" : "pointer", opacity: finalizing ? 0.7 : 1 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 20 }}>check</span>
              {done ? `Persona v${done.version} created` : finalizing ? "Creating…" : `Create persona · add ${scenarioN} scenario${scenarioN === 1 ? "" : "s"} to bank`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
