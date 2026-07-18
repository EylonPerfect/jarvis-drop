import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import "../pds.css";
import PdsNav from "../components/PdsNav";

// ============================================================
// Echo dashboard — workforce overview, re-skinned to the Perfect
// Design System 2026 mockup (Overview / view-home). Floating glass
// nav (PdsNav), KPI tiles, workforce roster table, latest debrief
// spotlight. Wired to the real API: agents roster, per-agent
// versions and sources counts, latest debrief. Call-volume telemetry
// has no backend yet, so that area renders an honest holding state.
// ============================================================

type Agent = {
  id: string;
  name: string;
  role?: string;
  icon?: string;
  status?: string;
  buildTrack?: string;
  persona?: { identity?: unknown } | null;
  golden_persona_id?: string | null;
  voice_id?: string | null;
};
type VersionRow = { id: string; number: number; change_note?: string | null; created_by?: string; created_at?: string };
type SourceRow = { id: string; title?: string; kind?: string; chars?: number; created_at?: string };
type DebriefStats = { durationMin?: number; moments?: number; nudges?: number; groundingFlags?: number };
type DebriefLatest = {
  debriefId: string | null;
  data?: { title?: string; who?: string; when?: string; stats?: DebriefStats; deltas?: unknown[]; memory?: unknown[] };
};
type AgentMeta = { versions: number; sources: number; golden: boolean };

const AGENT_KEY = "pds_agent";
function nav(view: string): void {
  window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "AI";
}
function handleOf(name: string): string {
  return "@" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}
// persona.identity shape is flexible (string or object with name/role fields)
function identityName(a: Agent): string | null {
  const idn = a.persona?.identity;
  if (typeof idn === "string" && idn.trim()) return idn.trim();
  if (idn && typeof idn === "object") {
    const o = idn as Record<string, unknown>;
    for (const k of ["name", "fullName", "full_name"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}
function identityRole(a: Agent): string | null {
  const idn = a.persona?.identity;
  if (idn && typeof idn === "object") {
    const o = idn as Record<string, unknown>;
    for (const k of ["role", "title"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

type StatusTone = { label: string; bg: string; color: string; dot: string; pulse: boolean };
function statusOf(a: Agent, meta: AgentMeta | undefined): StatusTone {
  if (a.golden_persona_id || meta?.golden)
    return { label: "Live", bg: "var(--success-soft)", color: "var(--success-ink)", dot: "var(--success)", pulse: false };
  if ((meta?.versions ?? 0) > 0 || a.persona?.identity)
    return { label: "Training", bg: "var(--purple-soft)", color: "var(--purple-ink)", dot: "var(--purple)", pulse: true };
  if ((meta?.sources ?? 0) > 0)
    return { label: "Needs persona", bg: "var(--warning-soft)", color: "var(--warning-ink)", dot: "var(--warning)", pulse: false };
  return { label: "New", bg: "var(--neutral-soft)", color: "var(--neutral-ink)", dot: "var(--neutral-dot)", pulse: false };
}

export default function EchoDashboard() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [meta, setMeta] = useState<Record<string, AgentMeta>>({});
  const [loading, setLoading] = useState(true);
  const [debrief, setDebrief] = useState<DebriefLatest | null>(null);
  const [debriefAgent, setDebriefAgent] = useState<Agent | null>(null);
  const [period, setPeriod] = useState<7 | 14 | 30>(14);
  const [filter, setFilter] = useState<string>("All");

  useEffect(() => {
    void (async () => {
      const list = await api.get<Agent[]>("/api/agents").catch(() => [] as Agent[]);
      setAgents(list);
      setLoading(false);
      // selected agent: shared via localStorage, fall back to the first agent
      let selId: string | null = null;
      try { selId = localStorage.getItem(AGENT_KEY); } catch { /* ignore */ }
      const sel = list.find((a) => a.id === selId) ?? list[0] ?? null;
      setDebriefAgent(sel);
      if (sel) {
        void api.get<DebriefLatest>(`/api/debrief/latest?agentId=${encodeURIComponent(sel.id)}`)
          .then((r) => setDebrief(r))
          .catch(() => setDebrief(null));
      }
      // per-agent versions + sources counts (real lifecycle data)
      await Promise.all(list.map(async (a) => {
        const [v, s] = await Promise.all([
          api.get<{ versions: VersionRow[]; goldenVersionId?: string | null }>(`/api/clones/${a.id}/versions`).catch(() => null),
          api.get<{ sources: SourceRow[] }>(`/api/clones/${a.id}/sources`).catch(() => null),
        ]);
        setMeta((m) => ({ ...m, [a.id]: {
          versions: v?.versions.length ?? 0,
          sources: s?.sources.filter((x) => x.kind !== "live_call").length ?? 0, // ground truth only
          golden: Boolean(v?.goldenVersionId || a.golden_persona_id),
        } }));
      }));
    })();
  }, []);

  function pickAgent(a: Agent): void {
    try { localStorage.setItem(AGENT_KEY, a.id); } catch { /* ignore */ }
    // design nav model: certified clones open their workspace, uncertified ones go to calibration
    const certified = Boolean(a.golden_persona_id || meta[a.id]?.golden);
    nav(certified ? "workspace" : "pdsstudio");
  }

  const totals = useMemo(() => {
    let versions = 0, sources = 0, golden = 0;
    for (const a of agents) {
      const m = meta[a.id];
      versions += m?.versions ?? 0;
      sources += m?.sources ?? 0;
      if (a.golden_persona_id || m?.golden) golden += 1;
    }
    return { versions, sources, golden };
  }, [agents, meta]);

  const roleChips = useMemo(() => {
    const seen: string[] = [];
    for (const a of agents) {
      const r = (a.role ?? "").trim();
      if (r && !seen.includes(r)) seen.push(r);
    }
    return seen.slice(0, 3);
  }, [agents]);
  const rows = useMemo(
    () => (filter === "All" ? agents : agents.filter((a) => (a.role ?? "").trim() === filter)),
    [agents, filter],
  );
  const maxVersions = useMemo(
    () => Math.max(1, ...agents.map((a) => meta[a.id]?.versions ?? 0)),
    [agents, meta],
  );

  const dStats: DebriefStats = debrief?.data?.stats ?? {};
  const deltaCount = debrief?.data?.deltas?.length ?? 0;
  const whoName = debrief?.data?.who ?? debriefAgent?.name ?? "";
  const whoLine = [debrief?.data?.who ?? debriefAgent?.name, debrief?.data?.when ? new Date(debrief.data.when).toLocaleString() : null]
    .filter(Boolean).join(" · ");

  return (
    <div
      className="pmx"
      data-theme={theme}
      style={{ height: "100%", overflowY: "auto", background: "var(--bg)", transition: "background .2s ease" }}
    >
      <style>{"@keyframes echoPulse { 0%,100% { opacity: 1; } 50% { opacity: .25; } }"}</style>

      <PdsNav active="echo" theme={theme} onTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />

      <div className="app">
        {/* hero */}
        <div className="hero">
          <div>
            <div className="ey">Workforce overview</div>
            <h1>Your AI sales and customer success team,<br /><b>always on, fully managed.</b></h1>
            <p>
              {loading
                ? "Loading your roster."
                : agents.length === 0
                  ? "No clones yet. Clone your first rep to put an AI teammate on the roster."
                  : `${agents.length} clone${agents.length === 1 ? "" : "s"} on the roster, ${totals.golden} live with a live version pinned. Each one is mirrored from a top performer and refined version by version.`}
            </p>
          </div>
          <div className="bolt">
            <svg className="i lg" viewBox="0 0 24 24" style={{ color: "var(--purple)" }}><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
            <div>
              <b>{totals.sources}</b> real call{totals.sources === 1 ? "" : "s"} power <b>{totals.versions} persona version{totals.versions === 1 ? "" : "s"}</b>
            </div>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="kpis5">
          <div className="card kpi">
            <div className="l">Active clones</div>
            <div className="n">{loading ? "…" : agents.length}</div>
            <div className="d">{totals.golden} live with a version pinned</div>
          </div>
          <div className="card kpi">
            <div className="l">Persona versions</div>
            <div className="n" style={{ color: "var(--purple)" }}>{loading ? "…" : totals.versions}</div>
            <div className="d">across all clones</div>
          </div>
          <div className="card kpi">
            <div className="l">Real calls learned from</div>
            <div className="n">{loading ? "…" : totals.sources}</div>
            <div className="d">note-taker transcripts ingested</div>
          </div>
          <div className="card kpi">
            <div className="l">Conversations today</div>
            <div className="n" style={{ color: "var(--ink3)" }}>—</div>
            <div className="d">collects after your first calls</div>
          </div>
          <div className="card kpi">
            <div className="l">Avg fidelity to source</div>
            <div className="n" style={{ color: "var(--ink3)" }}>—</div>
            <div className="d">scored during quality checks</div>
          </div>
        </div>

        {/* two column */}
        <div className="dash2">
          {/* left column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
            {/* chart (holding state, no call-volume backend yet) */}
            <div className="card chartcard">
              <div className="ch-h">
                <div>
                  <div className="t">Conversations handled</div>
                  <div className="s">Clone vs human volume, last {period} days</div>
                </div>
                <div className="seg">
                  {([7, 14, 30] as const).map((p) => (
                    <button key={p} className={p === period ? "on" : undefined} onClick={() => setPeriod(p)}>{p}d</button>
                  ))}
                </div>
              </div>
              <div className="legend">
                <span><i style={{ background: "var(--purple)" }} />Clone-handled</span>
                <span><i style={{ background: "var(--track)" }} />Human-handled</span>
              </div>
              <div className="chart-empty">
                <svg className="i" viewBox="0 0 24 24" style={{ width: 30, height: 30 }}><path d="M3 3v18h18M7 15l3-3 3 3 5-6" /></svg>
                <div style={{ maxWidth: 360, fontSize: 13 }}>No call volume yet. This chart collects after your first certified calls go live.</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink3)", marginTop: 9 }}>
                <span>{period} days ago</span><span>Today</span>
              </div>
            </div>

            {/* roster */}
            <div className="card" style={{ overflow: "hidden" }}>
              <div className="rtitle">
                <div className="t">Workforce roster</div>
                <div className="chips">
                  {["All", ...roleChips].map((c) => (
                    <button key={c} className={filter === c ? "on" : undefined} onClick={() => setFilter(c)}>{c}</button>
                  ))}
                </div>
              </div>
              <div className="rtablewrap">
                <table className="rtable">
                  <thead>
                    <tr><th>AI employee</th><th>Cloned from</th><th>Status</th><th>Versions</th><th>Sources</th><th>Voice</th></tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr><td colSpan={6} className="faint" style={{ textAlign: "center", cursor: "default" }}>Loading roster…</td></tr>
                    )}
                    {!loading && rows.length === 0 && (
                      <tr><td colSpan={6} className="faint" style={{ textAlign: "center", cursor: "default" }}>
                        {agents.length === 0 ? "No clones yet. Use Clone a rep to add your first AI employee." : "No clones match this filter."}
                      </td></tr>
                    )}
                    {rows.map((a) => {
                      const m = meta[a.id];
                      const st = statusOf(a, m);
                      const srcName = identityName(a);
                      const srcRole = identityRole(a);
                      const versions = m?.versions ?? 0;
                      const voiceReady = Boolean(a.voice_id);
                      const clonedFrom = srcName
                        ? `${srcName}${srcRole ? `, ${srcRole}` : a.role ? `, ${a.role}` : ""}`
                        : "persona not extracted yet";
                      return (
                        <tr key={a.id} onClick={() => pickAgent(a)} title="Open in studio">
                          <td>
                            <div className="emp">
                              <div className="pic">{initials(a.name)}<span className="st" style={{ background: st.dot }} /></div>
                              <div>
                                <div style={{ fontWeight: 700 }}>{a.name}</div>
                                <div className="h">{handleOf(a.name)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="mut">{clonedFrom}</td>
                          <td>
                            <span className="st-pill" style={{ background: st.bg, color: st.color }}>
                              <span className="dot" style={{ background: st.dot, animation: st.pulse ? "echoPulse 1.2s ease-in-out infinite" : undefined }} />{st.label}
                            </span>
                          </td>
                          <td>
                            <span className="vbar"><span style={{ width: `${Math.round((versions / maxVersions) * 100)}%` }} /></span>{m ? versions : "…"}
                          </td>
                          <td>{m ? m.sources : "…"}</td>
                          <td style={{ color: voiceReady ? "var(--success-ink)" : "var(--ink3)", fontWeight: 700 }}>{voiceReady ? "Ready" : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* right rail — latest debrief + the ground rules */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card spot">
            <div className="sh">Latest debrief</div>
            {debrief?.debriefId && debrief.data ? (
              <>
                <div className="who">
                  <div className="pic">{initials(whoName || "Call")}</div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{debrief.data.title ?? "Call debrief"}</div>
                    <div className="mut" style={{ fontSize: 12.5 }}>{whoLine}</div>
                  </div>
                </div>
                <div className="stat"><span className="mut">Call duration (min)</span><b>{dStats.durationMin ?? "—"}</b></div>
                <div className="stat"><span className="mut">Moments reviewed</span><b>{dStats.moments ?? "—"}</b></div>
                <div className="stat"><span className="mut">Nudges during call</span><b>{dStats.nudges ?? "—"}</b></div>
                <div className="stat"><span className="mut">Honesty flags</span><b style={{ color: (dStats.groundingFlags ?? 0) > 0 ? "var(--warning-ink)" : "var(--success-ink)" }}>{dStats.groundingFlags ?? 0}</b></div>
                <div className="stat" style={{ border: 0 }}><span className="mut">New scenarios banked</span><b>{deltaCount}</b></div>
                <button className="btn pink sm" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} onClick={() => nav("debrief")}>Open the film review</button>
              </>
            ) : (
              <>
                <div className="faint" style={{ fontSize: 13, lineHeight: 1.5, margin: "4px 0 14px" }}>
                  No debriefs yet{debriefAgent ? ` for ${debriefAgent.name}` : ""}. Run a calibration call, then debrief it to turn corrections into persona changes.
                </div>
                <button className="btn ghost sm" style={{ width: "100%", justifyContent: "center" }} onClick={() => nav("debrief")}>Go to debrief</button>
              </>
            )}
          </div>
          <div className="card spot">
            {/* header — same .sh treatment as the sibling cards (uppercase 13px/800/ink3) */}
            <div className="sh" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 18, color: "var(--purple)", fontVariationSettings: "'FILL' 1" }}>bolt</span>Cloning rules
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, letterSpacing: 0, textTransform: "none", padding: "4px 11px", borderRadius: 9999, background: "var(--success-soft)", color: "var(--success-ink)" }}>Active</span>
            </div>
            {[
              { icon: "verified", color: "var(--success-ink)", text: "Auto-escalate any clone below 70 fidelity to a human" },
              { icon: "pause_circle", color: "var(--gold)", text: "Auto-pause on tone drift greater than 5% vs. source" },
              { icon: "autorenew", color: "var(--purple)", text: "Retrain weekly from top-rated human calls" },
              { icon: "forum", color: "var(--ink2)", text: "Route enterprise accounts to human + clone pair" },
            ].map((r) => (
              <div key={r.text} style={{ display: "flex", gap: 11, alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--divider)", fontSize: 13.5 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 19, color: r.color, flexShrink: 0, fontVariationSettings: "'FILL' 1" }}>{r.icon}</span>
                <span style={{ fontWeight: 500, lineHeight: 1.4 }}>{r.text}</span>
              </div>
            ))}
            <button className="btn ghost sm" style={{ width: "100%", justifyContent: "center", marginTop: 14 }}>Manage automation</button>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
