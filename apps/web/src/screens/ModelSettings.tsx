import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { AiProvider, Integration } from "@jarvis/shared";
import { api, getAccessKey } from "../api/client";
import "../pds.css";

// ============================================================
// AI core · model settings — Perfect Design System 2026 v2
// (from Model Settings.dc.html). The models that power every
// clone: a per-job routing view up top, providers and API keys
// below.
// REAL (same endpoints as the legacy AI-core screen):
//   GET/POST /api/aicore/providers, PATCH/DELETE
//   /api/aicore/providers/:id, POST /api/aicore/providers/:id/test,
//   GET /api/integrations, POST /api/integrations/:id/connect,
//   POST /api/integrations/:id/test, DELETE /api/integrations/:id,
//   POST /api/voice/speak (voice preview).
// Per-job routing has no backend yet, so the matrix shows the
// real active provider applied to all text jobs, ElevenLabs for
// voice, and honest "not wired yet" rows for the rest.
// ============================================================

type TestState = { ok: boolean; detail: string } | "testing" | null;

const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));

const card: CSSProperties = { background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: 20 };
const pill: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: 9999 };
const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };
const label: CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginBottom: 5 };

// One-click starting points for common OpenAI-compatible gateways (same as
// the legacy AI-core screen). Claude is reachable via OpenRouter.
const PRESETS: { label: string; baseUrl: string; model: string }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "OpenRouter (Claude)", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-3.5-sonnet" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "Together", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { label: "Ollama (local)", baseUrl: "http://host.docker.internal:11434/v1", model: "llama3.1" },
];

const MARKS = [
  { bg: "rgba(255,6,96,.14)", color: "var(--accent)" },
  { bg: "rgba(46,211,125,.16)", color: "var(--success-ink)" },
  { bg: "rgba(163,66,255,.18)", color: "var(--purple-ink)" },
  { bg: "rgba(0,187,255,.18)", color: "var(--decor)" },
];

function ResultLine({ r }: { r: { ok: boolean; detail: string } }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: r.ok ? "var(--success-ink)" : "var(--error-ink)" }}>
      <span className="material-symbols-rounded" style={{ fontSize: 14 }}>{r.ok ? "check_circle" : "warning"}</span>{r.detail}
    </span>
  );
}

// ---- one model provider (from /api/aicore/providers) ----
function ProviderCard({ p, mark, field, onChanged }: { p: AiProvider; mark: { bg: string; color: string }; field: CSSProperties; onChanged: () => void }) {
  const [keyDraft, setKeyDraft] = useState("");
  const [test, setTest] = useState<TestState>(null);
  const [busy, setBusy] = useState<"test" | "save" | "activate" | "remove" | null>(null);

  const runTest = async () => {
    setBusy("test"); setTest("testing");
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(`/api/aicore/providers/${p.id}/test`);
      setTest({ ok: r.ok, detail: r.detail });
    } catch (e) { setTest({ ok: false, detail: String(e) }); }
    setBusy(null);
  };
  const saveKey = async () => {
    if (!keyDraft.trim()) return;
    setBusy("save"); setTest(null);
    try {
      await api.patch(`/api/aicore/providers/${p.id}`, { apiKey: keyDraft.trim() });
      setKeyDraft("");
      setTest({ ok: true, detail: "Key rotated" });
      onChanged();
    } catch (e) { setTest({ ok: false, detail: String(e) }); }
    setBusy(null);
  };
  const activate = async () => {
    setBusy("activate");
    try { await api.patch(`/api/aicore/providers/${p.id}`, { active: true }); onChanged(); }
    catch (e) { setTest({ ok: false, detail: String(e) }); }
    setBusy(null);
  };
  const remove = async () => {
    setBusy("remove");
    try { await api.del(`/api/aicore/providers/${p.id}`); onChanged(); }
    catch (e) { setTest({ ok: false, detail: String(e) }); setBusy(null); }
  };

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: mark.bg, color: mark.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15 }}>{p.name.charAt(0).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.model} · {p.baseUrl}</div>
        </div>
        {p.active ? (
          <span style={{ ...pill, background: "var(--success-soft)", color: "var(--success-ink)" }}>
            <span className="material-symbols-rounded" style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}>star</span>Active
          </span>
        ) : (
          <span style={{ ...pill, background: "var(--sunk)", color: "var(--ink2)" }}>Connected</span>
        )}
      </div>
      <label style={label}>API key</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder={`••••${p.keyLast4} · paste a new key to rotate`} style={{ ...field, flex: 1, width: "auto", fontFamily: "'Courier New', monospace" }} />
        {keyDraft.trim() ? (
          <button onClick={() => void saveKey()} disabled={busy === "save"} style={{ height: 42, padding: "0 15px", borderRadius: 11, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 700, opacity: busy === "save" ? 0.6 : 1, ...btnFont }}>{busy === "save" ? "Saving…" : "Save key"}</button>
        ) : (
          <button onClick={() => void runTest()} disabled={busy === "test"} style={{ height: 42, padding: "0 15px", borderRadius: 11, border: "none", background: "var(--ghost)", color: "var(--ink1)", fontSize: 12.5, fontWeight: 700, opacity: busy === "test" ? 0.6 : 1, ...btnFont }}>{busy === "test" ? "Testing…" : "Test"}</button>
        )}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginBottom: 8 }}>Enabled models</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, padding: "5px 11px", borderRadius: 9999, background: p.active ? "var(--purple-soft)" : "var(--sunk)", color: p.active ? "var(--purple-ink)" : "var(--ink2)" }}>
          {p.active && <span className="material-symbols-rounded" style={{ fontSize: 13 }}>star</span>}{p.model}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        {!p.active && (
          <button onClick={() => void activate()} disabled={busy === "activate"} style={{ height: 34, padding: "0 14px", borderRadius: 9999, border: "2px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 12, fontWeight: 700, opacity: busy === "activate" ? 0.6 : 1, ...btnFont }}>Set active</button>
        )}
        <button onClick={() => void remove()} disabled={busy === "remove"} style={{ height: 34, padding: "0 10px", borderRadius: 9999, border: "none", background: "transparent", color: "var(--error-ink)", fontSize: 12, fontWeight: 700, opacity: busy === "remove" ? 0.6 : 1, ...btnFont }}>Remove</button>
        {test && test !== "testing" && <ResultLine r={test} />}
      </div>
    </div>
  );
}

// ---- one AI service (from /api/integrations, aiHub) ----
function ServiceCard({ svc, mark, field, onChanged }: { svc: Integration; mark: { bg: string; color: string }; field: CSSProperties; onChanged: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(!svc.connected);
  const [busy, setBusy] = useState<"connect" | "test" | "disconnect" | "preview" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [error, setError] = useState("");

  const connect = async () => {
    setError("");
    const missing = svc.fields.filter((f) => !f.optional && !vals[f.key]?.trim());
    if (missing.length) { setError(`Fill in: ${missing.map((m) => m.label).join(", ")}`); return; }
    setBusy("connect");
    try {
      await api.post(`/api/integrations/${svc.id}/connect`, { values: vals });
      setVals({}); setEditing(false); setResult(null);
      onChanged();
    } catch (e) { setError(String(e)); }
    setBusy(null);
  };
  const runTest = async () => {
    setBusy("test"); setResult(null);
    try { setResult(await api.post<{ ok: boolean; detail: string }>(`/api/integrations/${svc.id}/test`)); }
    catch (e) { setResult({ ok: false, detail: String(e) }); }
    setBusy(null);
  };
  const disconnect = async () => {
    setBusy("disconnect");
    try { await api.del(`/api/integrations/${svc.id}`); setResult(null); onChanged(); }
    catch (e) { setError(String(e)); setBusy(null); }
  };
  const preview = async () => {
    setBusy("preview"); setResult(null);
    try {
      const key = getAccessKey();
      const res = await fetch(`${api.base}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) },
        body: JSON.stringify({ text: "Hi, this is the voice your clones use on live demos and calls." }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch { setResult({ ok: false, detail: "Could not play a preview · try Test" }); }
    setBusy(null);
  };

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: mark.bg, color: mark.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15 }}>{svc.label.charAt(0).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{svc.label}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{svc.connected ? svc.detail || "credentials stored" : svc.note || "AI service"}</div>
        </div>
        {svc.connected ? (
          <span style={{ ...pill, background: "var(--success-soft)", color: "var(--success-ink)" }}>Connected</span>
        ) : (
          <span style={{ ...pill, background: "var(--warning-soft)", color: "var(--warning-ink)" }}>Not connected</span>
        )}
      </div>

      {editing && svc.fields.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {svc.docsUrl && (
            <a href={svc.docsUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "var(--decor)", textDecoration: "none" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 14 }}>open_in_new</span>Where to get the credential
            </a>
          )}
          {svc.fields.map((f) => (
            <div key={f.key}>
              <label style={label}>{f.label}{f.optional ? " · optional" : ""}</label>
              <input type={f.secret ? "password" : "text"} placeholder={f.placeholder} value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} style={field} />
            </div>
          ))}
          {error && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--error-ink)" }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {svc.connected && <button onClick={() => { setEditing(false); setError(""); }} style={{ height: 36, padding: "0 14px", borderRadius: 9999, border: "none", background: "transparent", color: "var(--ink2)", fontSize: 12.5, fontWeight: 700, ...btnFont }}>Cancel</button>}
            <button onClick={() => void connect()} disabled={busy === "connect"} style={{ height: 36, padding: "0 16px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 700, opacity: busy === "connect" ? 0.6 : 1, ...btnFont }}>
              {busy === "connect" ? "Connecting…" : svc.connected ? "Update credentials" : "Connect"}
            </button>
          </div>
        </div>
      )}

      {svc.connected && !editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => void runTest()} disabled={busy === "test"} style={{ height: 34, padding: "0 14px", borderRadius: 9999, border: "none", background: "var(--ghost)", color: "var(--ink1)", fontSize: 12, fontWeight: 700, opacity: busy === "test" ? 0.6 : 1, ...btnFont }}>{busy === "test" ? "Testing…" : "Test"}</button>
          {svc.id === "elevenlabs" && (
            <button onClick={() => void preview()} disabled={busy === "preview"} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 34, padding: "0 14px", borderRadius: 9999, border: "2px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 12, fontWeight: 700, opacity: busy === "preview" ? 0.6 : 1, ...btnFont }}>
              <span className="material-symbols-rounded" style={{ fontSize: 15, color: "var(--purple)" }}>volume_up</span>{busy === "preview" ? "Playing…" : "Preview voice"}
            </button>
          )}
          <button onClick={() => { setEditing(true); setResult(null); }} style={{ height: 34, padding: "0 14px", borderRadius: 9999, border: "2px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 12, fontWeight: 700, ...btnFont }}>Update key</button>
          <button onClick={() => void disconnect()} disabled={busy === "disconnect"} style={{ height: 34, padding: "0 10px", borderRadius: 9999, border: "none", background: "transparent", color: "var(--error-ink)", fontSize: 12, fontWeight: 700, opacity: busy === "disconnect" ? 0.6 : 1, ...btnFont }}>Disconnect</button>
          {result && <ResultLine r={result} />}
        </div>
      )}
    </div>
  );
}

export default function ModelSettings() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [services, setServices] = useState<Integration[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const [p, i] = await Promise.all([
      api.get<AiProvider[]>("/api/aicore/providers").catch(() => [] as AiProvider[]),
      api.get<Integration[]>("/api/integrations").catch(() => [] as Integration[]),
    ]);
    setProviders(p);
    setServices(i.filter((s) => s.aiHub));
    setLoaded(true);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const addProvider = async () => {
    setError("");
    if (!form.name.trim() || !form.baseUrl.trim() || !form.apiKey.trim() || !form.model.trim()) {
      setError("Fill in a name, base URL, model and API key.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/aicore/providers", form);
      setForm({ name: "", baseUrl: "", apiKey: "", model: "" });
      setAdding(false);
      await reload();
    } catch (e) { setError(String(e)); }
    setSaving(false);
  };

  const active = providers.find((p) => p.active) ?? null;
  const eleven = services.find((s) => s.id === "elevenlabs") ?? null;

  const themeIcon = theme === "dark" ? "light_mode" : "dark_mode";
  const inputBg = theme === "dark" ? "rgba(255,255,255,.05)" : "#FFFFFF";
  const field: CSSProperties = { width: "100%", height: 42, padding: "0 13px", borderRadius: 11, border: "2px solid var(--border)", background: inputBg, color: "var(--ink1)", fontSize: 12.5, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };

  const activeLabel = !loaded ? "Checking…" : active ? `${active.name} · ${active.model}` : "No active provider yet";
  const activeDot = !loaded ? "var(--track)" : active ? "var(--success)" : "var(--error)";
  const roles = [
    { icon: "forum", job: "Conversation and reasoning", desc: "How the clone talks and decides on calls", value: activeLabel, dot: activeDot },
    { icon: "shield", job: "Grounding and fact-check", desc: "Blocks ungrounded claims before they are spoken", value: activeLabel, dot: activeDot },
    { icon: "graphic_eq", job: "Voice synthesis", desc: "Speaks in the source person's cloned voice", value: !loaded ? "Checking…" : eleven?.connected ? "ElevenLabs" : "ElevenLabs · not connected", dot: !loaded ? "var(--track)" : eleven?.connected ? "var(--success)" : "var(--warning)" },
    { icon: "mic", job: "Transcription", desc: "Turns live call audio into text", value: "Not wired yet", dot: "var(--track)" },
    { icon: "tv", job: "Screen understanding", desc: "Reads and drives the shared screen", value: "Not wired yet", dot: "var(--track)" },
  ];

  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)" }}>
      {/* header */}
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--nav-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--border)", padding: "12px 24px", display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => nav("agentshome")} style={{ width: 36, height: 36, borderRadius: 10, border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }} aria-label="Back">
          <span className="material-symbols-rounded" style={{ fontSize: 22 }}>arrow_back</span>
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>AI core · model connections</div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>Settings · the models that power every clone</div>
        </div>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} style={{ marginLeft: "auto", width: 36, height: 36, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }} aria-label="Toggle theme">
          <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{themeIcon}</span>
        </button>
      </header>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 24px 60px" }}>
        {/* ROLE ROUTING */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--purple)" }}>account_tree</span>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Which model does which job</div>
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 14, color: "var(--ink2)", maxWidth: 640, lineHeight: 1.5 }}>A clone runs on several models at once. Route each job to the model you trust for it, and swap any of them without retraining the persona.</p>
        <div style={{ background: "var(--card)", borderRadius: 20, boxShadow: "var(--shadow)", overflow: "hidden", marginBottom: 12 }}>
          {roles.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "34px 1.3fr 1.4fr", gap: 16, alignItems: "center", padding: "16px 22px", borderBottom: i < roles.length - 1 ? "1px solid var(--divider)" : "none" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--purple)" }}>{r.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{r.job}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>{r.desc}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 14px", borderRadius: 12, border: "2px solid var(--border)", background: inputBg }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: r.dot, flexShrink: 0 }}></span>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.value}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--ink2)", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 14px", marginBottom: 34, lineHeight: 1.45 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 17, color: "var(--purple)", marginTop: 1 }}>info</span>
          Per job routing is not wired yet. The active provider below applies to all text jobs for now, voice routes through ElevenLabs once connected, and transcription and screen understanding have no backend to route.
        </div>

        {/* PROVIDERS */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--accent)" }}>key</span>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Providers and API keys</div>
          <button onClick={() => { setAdding((a) => !a); setError(""); }} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, height: 40, padding: "0 16px", borderRadius: 9999, border: "2px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 13, fontWeight: 700, ...btnFont }}>
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>{adding ? "close" : "add"}</span>{adding ? "Cancel" : "Add provider"}
          </button>
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 14, color: "var(--ink2)" }}>Keys are stored server-side. Only the last 4 characters are shown after saving.</p>

        {adding && (
          <div style={{ ...card, marginBottom: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginRight: 4 }}>Quick fill</span>
              {PRESETS.map((pr) => (
                <button key={pr.label} onClick={() => setForm((f) => ({ ...f, name: pr.label, baseUrl: pr.baseUrl, model: pr.model }))} style={{ padding: "5px 11px", borderRadius: 9999, border: "none", background: "var(--purple-soft)", color: "var(--purple-ink)", fontSize: 11.5, fontWeight: 700, ...btnFont }}>{pr.label}</button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label style={label}>Provider name</label><input placeholder="OpenAI" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={field} /></div>
              <div><label style={label}>Model</label><input placeholder="gpt-4o-mini" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} style={field} /></div>
            </div>
            <div><label style={label}>API base URL</label><input placeholder="https://api.openai.com/v1" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} style={field} /></div>
            <div><label style={label}>Secret key · from your provider</label><input type="password" placeholder="sk-…" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} style={{ ...field, fontFamily: "'Courier New', monospace" }} /></div>
            {error && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--error-ink)" }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => void addProvider()} disabled={saving} style={{ height: 42, padding: "0 18px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 700, opacity: saving ? 0.6 : 1, ...btnFont }}>{saving ? "Connecting…" : "Connect provider"}</button>
            </div>
          </div>
        )}

        {loaded && providers.length === 0 && services.length === 0 && !adding && (
          <div style={{ ...card, textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No providers connected yet</div>
            <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 16 }}>Connect an OpenAI-compatible provider to give the clones a model to think with. For Claude, use OpenRouter.</div>
            <button onClick={() => setAdding(true)} style={{ height: 40, padding: "0 18px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 700, ...btnFont }}>Add provider</button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {providers.map((p, i) => (
            <ProviderCard key={p.id} p={p} mark={MARKS[i % MARKS.length]} field={field} onChanged={() => void reload()} />
          ))}
          {services.map((s, i) => (
            <ServiceCard key={s.id} svc={s} mark={MARKS[(providers.length + i) % MARKS.length]} field={field} onChanged={() => void reload()} />
          ))}
        </div>
      </div>
    </div>
  );
}
