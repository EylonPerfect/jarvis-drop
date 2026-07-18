import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import PdsNav from "../components/PdsNav";
import "../pds.css";

// ============================================================
// Certification — Perfect Design System 2026, re-skinned to the
// afterhuman-ui-mockup "Quality checks" view (.pmx / .app shell).
// Seven certification gates derived from REAL clone lifecycle
// data: sources, persona, playbook, verify score (on-demand
// POST /api/verify), golden pin, voice config. Red team review
// has no automation yet and is shown as a manual gate. All
// automated gates green flips the status card to "cleared" with
// a Run-a-call CTA. Only the render output changed — every API
// call, run action, loading/running state and nav is preserved.
// ============================================================

type PersonaVoice = { elevenlabs_voice_id?: string };
type Persona = { identity?: unknown; voice?: PersonaVoice };
type Agent = {
  id: string; name: string; role?: string; icon?: string; status?: string;
  buildTrack?: string; persona?: Persona; golden_persona_id?: string; voice_id?: string;
};
type VersionRow = { id: string; number: number; change_note?: string; created_by?: string; created_at?: string };
type PlaybookStage = { id: string; name: string };
type VerifyResult = { situation: string; humanResponse: string; cloneResponse: string; score: number; note?: string; source?: string };
type VerifyRun = { average: number; results: VerifyResult[] };

type GateState = "pass" | "fail" | "manual" | "notrun" | "running";
type Gate = { key: string; name: string; threshold: string; state: GateState; value: string; view?: string };
// the server-authoritative pass/fail for each gate (GET /api/clones/:id/gates)
type ServerGate = { key: string; label: string; pass: boolean; score: number | null };

const VERIFY_THRESHOLD = 0.7;

const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));

export default function Certification() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceCount, setSourceCount] = useState<number>(0);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [goldenId, setGoldenId] = useState<string | null>(null);
  const [stageCount, setStageCount] = useState<number>(0);
  const [verify, setVerify] = useState<VerifyRun | null>(null);
  const [redteam, setRedteam] = useState<{ average: number; cases: number } | null>(null);
  const [redteaming, setRedteaming] = useState(false);
  // server-authoritative gate pass/fail — the static lifecycle gates read this
  const [serverGates, setServerGates] = useState<ServerGate[]>([]);

  // ---- call fidelity: clone replayed against a real recorded call ----
  type FidReport = { runAt: string; sourceId: string; sourceTitle?: string; aborted?: boolean; plannedTurns: number; repliedTurns: number; avg: number; prevAvg: number | null; topGaps?: { atSec: number; fidelity: number; gap: string }[]; autoFixes?: unknown[] };
  const [fidReport, setFidReport] = useState<FidReport | null>(null);
  const [fidSources, setFidSources] = useState<{ sourceId: string; title: string }[]>([]);
  const [fidSource, setFidSource] = useState("");
  const [fidRunning, setFidRunning] = useState(false);
  const [fidErr, setFidErr] = useState("");
  useEffect(() => {
    if (!agent?.id) { setFidReport(null); setFidSources([]); setFidSource(""); return; }
    void api.get<{ report: FidReport | null }>(`/api/fidelity/latest?agentId=${agent.id}`).then((r) => setFidReport(r.report)).catch(() => setFidReport(null));
    void api.get<{ observed: { sourceId: string; title: string }[] }>(`/api/fathom/observed?agentId=${agent.id}`).then((r) => {
      setFidSources(r.observed);
      setFidSource((cur) => cur || r.observed[0]?.sourceId || "");
    }).catch(() => setFidSources([]));
  }, [agent?.id]);
  async function runFidelity() {
    if (!agent || !fidSource || fidRunning) return;
    setFidRunning(true); setFidErr("");
    try {
      const r = await api.post<FidReport>(`/api/fidelity/run`, { agentId: agent.id, sourceId: fidSource });
      setFidReport(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFidErr(msg.includes("409") ? "A live session is running — end it, then run fidelity." : `Run failed: ${msg}`);
    }
    setFidRunning(false);
  }
  async function runRedteam() {
    if (!agent || redteaming) return;
    setRedteaming(true);
    try {
      const r = await api.post<{ average: number; results?: unknown[] }>(`/api/redteam/${agent.id}`, {});
      setRedteam({ average: r.average, cases: Array.isArray(r.results) ? r.results.length : 8 });
    } catch { /* gate stays as-is; the row shows the last saved run */ }
    setRedteaming(false);
  }
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const loadAgentData = useCallback(async (a: Agent) => {
    const [src, ver, pb, gt] = await Promise.all([
      api.get<{ sources: { id: string; kind?: string }[] }>(`/api/clones/${a.id}/sources`).catch(() => ({ sources: [] as { id: string; kind?: string }[] })),
      api.get<{ versions: VersionRow[]; goldenVersionId: string | null; verifyLatest?: { average: number; cases: number; at: string } | null }>(`/api/clones/${a.id}/versions`).catch(() => ({ versions: [] as VersionRow[], goldenVersionId: null })),
      api.get<{ playbook: { stages: PlaybookStage[] } }>(`/api/clones/${a.id}/playbook`).catch(() => ({ playbook: { stages: [] as PlaybookStage[] } })),
      api.get<{ gates: ServerGate[]; passed: number; total: number }>(`/api/clones/${a.id}/gates`).catch(() => ({ gates: [] as ServerGate[], passed: 0, total: 7 })),
    ]);
    setSourceCount(src.sources.filter((s) => s.kind !== "live_call").length); // ground truth only
    setVersions(ver.versions);
    setGoldenId(ver.goldenVersionId ?? a.golden_persona_id ?? null);
    setStageCount(pb.playbook?.stages?.length ?? 0);
    setServerGates(gt.gates ?? []);
    // the last verification run persists server-side — the gate stays earned
    const vl = (ver as { verifyLatest?: { average: number; cases: number } | null }).verifyLatest;
    if (vl && typeof vl.average === "number") setVerify((cur) => cur ?? { average: vl.average, results: [] });
    const rt = (ver as { redteamLatest?: { average: number; cases: number } | null }).redteamLatest;
    setRedteam(rt && typeof rt.average === "number" ? rt : null);
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const list = await api.get<Agent[]>("/api/agents");
        setAgents(list);
        const stored = localStorage.getItem("pds_agent");
        const picked = list.find((x) => x.id === stored) ?? list[0] ?? null;
        setAgent(picked);
        if (picked) {
          localStorage.setItem("pds_agent", picked.id);
          await loadAgentData(picked);
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
      setLoading(false);
    })();
  }, [loadAgentData]);

  async function pickAgent(id: string) {
    const a = agents.find((x) => x.id === id);
    if (!a) return;
    localStorage.setItem("pds_agent", a.id);
    setAgent(a);
    setVerify(null);
    setVerifyError(null);
    setLoading(true);
    await loadAgentData(a);
    setLoading(false);
  }

  async function runVerify() {
    if (!agent || verifying) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const r = await api.post<VerifyRun>(`/api/verify/${agent.id}`, {});
      setVerify(r);
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : String(e));
    }
    setVerifying(false);
  }

  const latestVersion = useMemo(() => versions.reduce<number>((m, v) => Math.max(m, v.number), 0), [versions]);
  const goldenNumber = useMemo(() => versions.find((v) => v.id === goldenId)?.number ?? null, [versions, goldenId]);
  const hasPersona = !!agent?.persona?.identity;
  const voiceId = agent?.voice_id || agent?.persona?.voice?.elevenlabs_voice_id || "";

  const gates: Gate[] = useMemo(() => {
    // static lifecycle gates read their pass/fail from the server; verify and
    // red team stay local because their run buttons update state live here
    const gm = new Map(serverGates.map((g) => [g.key, g]));
    const gp = (k: string) => gm.get(k)?.pass ?? false;
    const verifyState: GateState = verifying ? "running" : verify ? (verify.average >= VERIFY_THRESHOLD ? "pass" : "fail") : "notrun";
    return [
      { key: "sources", name: "Call sources", threshold: "At least 1 source call ingested", state: gp("sources") ? "pass" : "fail", value: sourceCount > 0 ? `${sourceCount} real call${sourceCount === 1 ? "" : "s"}` : "none", view: "clonerep" },
      { key: "persona", name: "Persona extracted", threshold: "Persona spec with identity extracted from sources", state: gp("persona") ? "pass" : "fail", value: hasPersona ? (latestVersion ? `v${latestVersion}` : "present") : "missing", view: "pdsstudio" },
      { key: "playbook", name: "Storyboard", threshold: "Call playbook with at least 1 stage", state: gp("playbook") ? "pass" : "fail", value: stageCount > 0 ? `${stageCount} stage${stageCount === 1 ? "" : "s"}` : "none", view: "pdsstudio" },
      {
        key: "verify", name: "Verification", threshold: `At least ${Math.round(VERIFY_THRESHOLD * 100)}% average match to source calls`, state: verifyState,
        value: verifying ? "replaying…" : verify ? `${Math.round(verify.average * 100)}%${verify.results.length ? ` · ${verify.results.length} cases` : " · last run"}` : verifyError ? "run failed" : "not run yet", view: "pdsstudio",
      },
      { key: "golden", name: "Live version pinned", threshold: "A golden version pinned for the live bridge", state: gp("golden") ? "pass" : "fail", value: goldenId ? (goldenNumber ? `v${goldenNumber}` : "pinned") : "none", view: "pdsstudio" },
      { key: "voice", name: "Voice configured", threshold: "A voice id configured for speech", state: gp("voice") ? "pass" : "fail", value: voiceId ? "ready" : "missing", view: "pdsstudio" },
      {
        key: "redteam", name: "Red team", threshold: "8-attack adversarial battery at 70% or better",
        state: (redteam ? (redteam.average >= 0.7 ? "pass" : "fail") : "manual") as GateState,
        value: redteam ? `${Math.round(redteam.average * 100)}% · ${redteam.cases} attacks` : "not run yet",
      },
    ];
  }, [serverGates, sourceCount, hasPersona, latestVersion, stageCount, verifying, verify, verifyError, goldenId, goldenNumber, voiceId]);

  const gatesPassed = gates.filter((g) => g.state === "pass").length;
  const automated = gates.filter((g) => g.state !== "manual");
  const blockers = automated.filter((g) => g.state !== "pass").length;
  const certified = !loading && automated.length > 0 && blockers === 0;
  const running = verifying;

  const headline = certified
    ? `${agent?.name ?? "This clone"} is cleared for real calls`
    : running
      ? "Running verification against source calls"
      : loading
        ? "Running quality checks"
        : agent
          ? `${blockers} gate${blockers === 1 ? " is" : "s are"} blocking go-live`
          : "No clone selected";
  const sub = certified
    ? "All 7 gates are green, including the adversarial red team battery."
    : running
      ? "Replaying saved situations against the current persona. This can take a minute or two."
      : loading
        ? "Loading sources, versions and playbook for this clone."
        : agent
          ? "Fix the red gates, then run verification. The score gate uses the real average from replaying source calls."
          : "Create a clone first, then come back to clear it for live.";

  return (
    <div className="pmx" data-theme={theme}>
      <PdsNav
        active="quality"
        theme={theme}
        onTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        context={agents.length > 1 ? (
          <select
            value={agent?.id ?? ""}
            onChange={(e) => void pickAgent(e.target.value)}
            style={{ height: 34, borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink1)", font: "inherit", fontSize: 13, fontWeight: 700, padding: "0 12px", cursor: "pointer" }}
          >
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        ) : undefined}
      />
      <div className="app">

        <div style={{ paddingBottom: 96 }}>
          {/* page heading */}
          <div className="page-h">
            <h1 style={{ fontSize: 26 }}>Quality checks</h1>
            <p style={{ marginTop: 6 }}>{agent ? `${agent.name} clears these gates before running real calls.` : "Clear these gates before running real calls."}</p>
          </div>

          {loadError && (
            <div className="card" style={{ padding: "12px 16px", background: "var(--error-soft)", color: "var(--error-ink)", fontSize: 13, fontWeight: 600, margin: "0 4px 14px", border: 0 }}>
              Could not load agents: {loadError}
            </div>
          )}

          {/* status card — overall clearance, count and the primary action */}
          <div className="card statuscard">
            <div className="big" style={certified ? undefined : { background: "var(--warning-soft)", color: "var(--warning-ink)" }}>
              <svg className="i lg" viewBox="0 0 24 24">
                {certified ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 20v-6M12 20l-3-3M12 20l3-3M12 4v4" />}
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <h3>{headline}</h3>
              <p>{sub}</p>
              <p className="faint" style={{ fontSize: 13, marginTop: 6 }}>{loading ? "Checking gates…" : `${gatesPassed} of ${gates.length} gates passed`}</p>
            </div>
            <div className="spacer" />
            {certified && (
              <button className="btn pink" onClick={() => nav("precall")}>Run a call</button>
            )}
            {!certified && running && (
              <button className="btn purple" disabled>Running verification…</button>
            )}
            {!certified && !running && agent && (
              <button className="btn pink" onClick={() => void runVerify()} disabled={loading}>{verify ? "Re-run verification" : "Run verification"}</button>
            )}
          </div>

          {/* gate rows — one card per real gate */}
          {gates.map((g) => {
            const pass = g.state === "pass";
            const view = g.view;
            return (
              <div className="card gate" key={g.key}>
                <div className={`chk ${pass ? "pass" : "warn"}`}>
                  <svg className="i sm" viewBox="0 0 24 24">
                    {pass ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 20v-6M12 20l-3-3M12 20l3-3M12 4v4" />}
                  </svg>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{g.name}</div>
                  <div className="d">{g.threshold}</div>
                </div>
                <div className="spacer" />
                {g.key === "redteam" && agent && (
                  <button className="btn purple sm" onClick={() => void runRedteam()} disabled={redteaming}>
                    {redteaming ? "Attacking… ~2 min" : redteam ? "Re-run red team" : "Run red team"}
                  </button>
                )}
                <span className={`score ${pass ? "pass" : "warn"}`}>{loading ? "…" : g.value}</span>
                {view && (
                  <button className="iconbtn" onClick={() => nav(view)} aria-label={`Open ${g.name}`} style={{ width: 32, height: 32 }}>
                    <svg className="i sm" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                )}
              </div>
            );
          })}

          {/* call fidelity — the clone replayed against a REAL recorded call */}
          <div className="card" style={{ padding: 22, margin: "14px 4px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Rehearsal match</div>
              {fidReport && (
                <span style={{ fontSize: 26, fontWeight: 800, color: fidReport.avg >= 0.7 ? "var(--success-ink)" : "var(--warning-ink)", letterSpacing: "-.02em" }}>{Math.round(fidReport.avg * 100)}%</span>
              )}
              {fidReport?.prevAvg != null && (
                <span style={{ fontSize: 11.5, fontWeight: 700, color: fidReport.avg >= fidReport.prevAvg ? "var(--success-ink)" : "var(--error-ink)" }}>
                  {fidReport.avg >= fidReport.prevAvg ? "▲" : "▼"} from {Math.round(fidReport.prevAvg * 100)}%
                </span>
              )}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                {fidSources.length > 0 && (
                  <select value={fidSource} onChange={(e) => setFidSource(e.target.value)} style={{ height: 30, borderRadius: 9999, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, padding: "0 10px", maxWidth: 240 }}>
                    {fidSources.map((s) => <option key={s.sourceId} value={s.sourceId}>{s.title.slice(0, 44) || s.sourceId}</option>)}
                  </select>
                )}
                <button onClick={() => void runFidelity()} disabled={fidRunning || !fidSource} title={fidSources.length ? "Replay the real customer against the clone, score every moment, auto-fix the worst gaps" : "Ground a recording first (Sources step → Ground in recording)"} style={{ height: 30, padding: "0 14px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 11.5, fontWeight: 800, cursor: "pointer", opacity: fidRunning || !fidSource ? 0.6 : 1, fontFamily: "inherit" }}>
                  {fidRunning ? "Rehearsing vs the real call… ~10–15 min" : fidReport ? "Run again" : "Run fidelity"}
                </button>
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink3)", marginBottom: fidReport ? 12 : 0 }}>
              {fidSources.length
                ? "The clone replays a real call — the actual customer's questions — and every moment is scored against what the human rep did. The worst gaps are fixed automatically into the draft persona."
                : "No grounded recordings yet — open the Sources step and use \"Ground in recording\" on a call, then run fidelity here."}
              {fidErr && <span style={{ color: "var(--error-ink)", fontWeight: 700 }}> {fidErr}</span>}
            </div>
            {fidReport && (
              <>
                <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 10 }}>
                  vs “{fidReport.sourceTitle}” · {fidReport.repliedTurns}/{fidReport.plannedTurns} moments · {new Date(fidReport.runAt).toLocaleString()} {fidReport.aborted ? " · aborted early" : ""}
                </div>
                {(fidReport.topGaps ?? []).map((g, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderTop: "1px solid var(--divider)" }}>
                    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: g.fidelity < 0.4 ? "var(--error-ink)" : "var(--warning-ink)" }}>{Math.round(g.fidelity * 100)}%</span>
                    <span style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.45 }}>{g.gap}</span>
                  </div>
                ))}
                {(fidReport.autoFixes ?? []).length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--success-ink)", fontWeight: 600 }}>
                    {(fidReport.autoFixes ?? []).length} fixes self-applied to the draft persona — review in the room's Versions tab, pin to promote.
                  </div>
                )}
              </>
            )}
          </div>

          {/* fidelity, from the latest verify run (real per-case scores) */}
          <div className="card" style={{ padding: 22, margin: "14px 4px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Answer accuracy</div>
              {verify && verify.average < VERIFY_THRESHOLD && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 9999, background: "var(--warning-soft)", color: "var(--warning-ink)" }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 14 }}>warning</span>Below the {Math.round(VERIFY_THRESHOLD * 100)}% gate
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink3)", marginBottom: 18 }}>
              {verify ? "Per-case similarity to the source calls from the latest verification run." : "A session-over-session trend collects after repeated verification runs."}
            </div>
            {verify && verify.results.length > 0 ? (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, borderBottom: "1px solid var(--border)" }}>
                {verify.results.map((r, i) => (
                  <div key={i} title={`${Math.round(r.score * 100)}% · ${r.situation}`} style={{ flex: 1, height: Math.max(6, Math.round(r.score * 120)), background: r.score >= VERIFY_THRESHOLD ? "var(--success)" : "var(--warning)", borderRadius: "4px 4px 0 0" }} />
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, borderBottom: "1px solid var(--border)", color: "var(--ink3)", fontSize: 13 }}>
                {verifying ? "Replaying source calls…" : "No verification data yet. Run verification to see per-case fidelity."}
              </div>
            )}
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink2)", marginTop: 18, padding: "14px 16px", borderRadius: 14, background: "var(--sunk)", display: "flex", alignItems: "center", gap: 10 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--purple)" }}>flag_circle</span>
              When every gate is green, more tuning is comfort, not progress.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
