import { useState } from "react";
import type { CSSProperties } from "react";
import { api, getAccessKey } from "../api/client";
import { useApi } from "../api/hooks";
import type { Integration, AiProvider, IntegrationTestResult } from "@jarvis/shared";
import PdsNav from "../components/PdsNav";
import "../pds.css";

// ============================================================
// Connections — the Perfect-native place to connect the three
// services a clone needs: a model provider (its reasoning), a
// voice (ElevenLabs) and a sandbox (E2B). Self-contained PDS
// screen. It reuses the same server-side credential vault the
// legacy ops console uses, so nothing is stored twice:
//   voice / sandbox  ->  /api/integrations  (id: elevenlabs, e2b)
//   model provider   ->  /api/aicore/providers
// Honesty rule: every status here is read from the backend. We
// never paint a connected state we cannot prove.
// ============================================================

const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

// A small status pill in PDS colours.
function StatusPill({ connected, error }: { connected: boolean; error?: boolean }) {
  const bg = error ? "var(--error-soft)" : connected ? "var(--success-soft)" : "var(--ghost)";
  const fg = error ? "var(--error-ink)" : connected ? "var(--success-ink)" : "var(--ink3)";
  const label = error ? "Error" : connected ? "Connected" : "Not connected";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 11px", borderRadius: 9999, background: bg, color: fg, fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
      {label.toUpperCase()}
    </span>
  );
}

const fieldStyle: CSSProperties = {
  width: "100%", height: 40, padding: "0 12px", borderRadius: 10,
  border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)",
  fontFamily: "inherit", fontSize: 13, outline: "none", boxSizing: "border-box",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".05em", color: "var(--ink3)", textTransform: "uppercase" }}>{label}</span>
      {children}
    </label>
  );
}

function PillButton({ children, onClick, disabled, tone = "ghost" }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: "primary" | "ghost" | "danger" }) {
  const styles: Record<string, CSSProperties> = {
    primary: { background: "var(--purple)", color: "#fff", border: "none" },
    ghost: { background: "transparent", color: "var(--ink1)", border: "1px solid var(--border)" },
    danger: { background: "transparent", color: "var(--error-ink)", border: "1px solid var(--border)" },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ height: 36, padding: "0 16px", borderRadius: 9999, fontSize: 12, fontWeight: 800, opacity: disabled ? 0.55 : 1, ...styles[tone], ...btnFont }}>
      {children}
    </button>
  );
}

function Card({ icon, title, subtitle, right, children }: { icon: string; title: string; subtitle: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div style={{ background: "var(--card)", borderRadius: 20, boxShadow: "var(--shadow)", padding: "22px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <span className="material-symbols-rounded" style={{ fontSize: 26, color: "var(--purple)", background: "var(--purple-soft)", width: 46, height: 46, borderRadius: 13, display: "grid", placeItems: "center", flexShrink: 0 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800 }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.5, marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ flexShrink: 0 }}>{right}</div>
      </div>
      {children && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  );
}

// ---- Credential-vault service (ElevenLabs voice, E2B sandbox) --------------
// Both live in /api/integrations. We reuse the exact connect / test / disconnect
// contract the legacy screens use, so a key set here shows up everywhere.
function ServiceCard({ svc, reload }: { svc: Integration; reload: () => void }) {
  const [editing, setEditing] = useState(!svc.connected);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "test" | "remove" | "preview" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState("");

  const setField = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setErr("");
    const missing = svc.fields.filter((f) => !f.optional && !vals[f.key]?.trim());
    if (missing.length) { setErr(`Fill in: ${missing.map((m) => m.label).join(", ")}`); return; }
    setBusy("save");
    try {
      await api.post(`/api/integrations/${svc.id}/connect`, { values: vals });
      setVals({}); setEditing(false); setNote(null);
      reload();
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };

  const test = async () => {
    setBusy("test"); setNote(null);
    try {
      const r = await api.post<IntegrationTestResult>(`/api/integrations/${svc.id}/test`);
      setNote({ ok: r.ok, text: r.detail });
    } catch { setNote({ ok: false, text: "Could not reach the service." }); } finally { setBusy(null); }
  };

  const remove = async () => {
    setBusy("remove");
    try { await api.del(`/api/integrations/${svc.id}`); setNote(null); reload(); }
    catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };

  // ElevenLabs only: play a short sample through the real voice endpoint.
  const preview = async () => {
    setBusy("preview"); setNote(null);
    try {
      const res = await fetch(`${api.base}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getAccessKey() ? { "X-API-Key": getAccessKey() } : {}) },
        body: JSON.stringify({ text: "Hi, this is the voice your clone will use on live calls." }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const audio = new Audio(URL.createObjectURL(await res.blob()));
      await audio.play();
    } catch { setNote({ ok: false, text: "Could not play a preview, try test connection." }); } finally { setBusy(null); }
  };

  return (
    <Card icon={svc.icon === "mic" ? "graphic_eq" : "dns"} title={svc.label} subtitle={svc.connected ? (svc.detail || "Credentials stored server-side.") : (svc.note || "Not connected yet.")} right={<StatusPill connected={svc.connected} error={svc.status === "error"} />}>
      {editing && svc.fields.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, borderRadius: 14, background: "var(--sunk)", border: "1px solid var(--border)" }}>
          {svc.docsUrl && (
            <a href={svc.docsUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "var(--purple-ink)", textDecoration: "none" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 15 }}>open_in_new</span> Where to get this credential
            </a>
          )}
          {svc.fields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.optional ? " (optional)" : ""}`}>
              <input style={fieldStyle} type={f.secret ? "password" : "text"} placeholder={f.placeholder} value={vals[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} />
            </Field>
          ))}
          {err && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--error-ink)" }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            {svc.connected && <PillButton tone="ghost" onClick={() => { setEditing(false); setErr(""); }}>Cancel</PillButton>}
            <PillButton tone="primary" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : svc.connected ? "Update credentials" : "Connect"}</PillButton>
          </div>
        </div>
      )}

      {svc.connected && !editing && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <PillButton tone="ghost" disabled={busy === "test"} onClick={test}>{busy === "test" ? "Testing…" : "Test connection"}</PillButton>
          {svc.id === "elevenlabs" && <PillButton tone="ghost" disabled={busy === "preview"} onClick={preview}>{busy === "preview" ? "Playing…" : "Preview voice"}</PillButton>}
          <PillButton tone="ghost" onClick={() => { setEditing(true); setNote(null); }}>Update key</PillButton>
          <PillButton tone="danger" disabled={busy === "remove"} onClick={remove}>{busy === "remove" ? "Removing…" : "Disconnect"}</PillButton>
          {note && <span style={{ fontSize: 12, fontWeight: 700, color: note.ok ? "var(--success-ink)" : "var(--error-ink)" }}>{note.text}</span>}
        </div>
      )}
    </Card>
  );
}

// ---- Model provider (reasoning) --------------------------------------------
// Reuses /api/aicore/providers. First provider added is made active by the
// backend; more can be added and one set active. Keys never return to the
// browser (only last 4 + hasKey), so we honour that here.
function ProviderSection() {
  const { data, reload } = useApi<AiProvider[]>("/api/aicore/providers");
  const providers = data ?? [];
  const active = providers.find((p) => p.active) ?? null;

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string } | "testing">>({});

  const add = async () => {
    setErr("");
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim() || !form.apiKey.trim()) {
      setErr("Fill in a name, base URL, model, and API key."); return;
    }
    setBusy("add");
    try {
      await api.post("/api/aicore/providers", form);
      setForm({ name: "", baseUrl: "", model: "", apiKey: "" });
      setAdding(false);
      reload();
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };

  const activate = async (id: string) => { setBusy(id); try { await api.patch(`/api/aicore/providers/${id}`, { active: true }); reload(); } finally { setBusy(null); } };
  const remove = async (id: string) => { setBusy(id); try { await api.del(`/api/aicore/providers/${id}`); reload(); } finally { setBusy(null); } };
  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: "testing" }));
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(`/api/aicore/providers/${id}/test`);
      setTests((t) => ({ ...t, [id]: { ok: r.ok, text: r.detail } }));
    } catch (e) { setTests((t) => ({ ...t, [id]: { ok: false, text: String(e) } })); }
  };

  return (
    <Card icon="neurology" title="Model provider" subtitle="The reasoning model your clones think with. Any OpenAI-compatible provider works, for Claude use OpenRouter." right={<StatusPill connected={!!active} />}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {providers.map((p) => {
          const t = tests[p.id];
          return (
            <div key={p.id} style={{ padding: 14, borderRadius: 14, background: "var(--sunk)", border: `1px solid ${p.active ? "var(--purple)" : "var(--border)"}`, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 800 }}>{p.name}</span>
                    {p.active && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".04em", color: "var(--success-ink)", background: "var(--success-soft)", padding: "2px 8px", borderRadius: 9999 }}>ACTIVE</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.model} · {p.baseUrl}{p.hasKey ? ` · key ••••${p.keyLast4}` : ""}</div>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                {!p.active && <PillButton tone="ghost" disabled={busy === p.id} onClick={() => activate(p.id)}>Set active</PillButton>}
                <PillButton tone="ghost" disabled={t === "testing"} onClick={() => test(p.id)}>{t === "testing" ? "Testing…" : "Test connection"}</PillButton>
                <PillButton tone="danger" disabled={busy === p.id} onClick={() => remove(p.id)}>Remove</PillButton>
                {t && t !== "testing" && <span style={{ fontSize: 12, fontWeight: 700, color: t.ok ? "var(--success-ink)" : "var(--error-ink)" }}>{t.text}</span>}
              </div>
            </div>
          );
        })}

        {adding ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, borderRadius: 14, background: "var(--sunk)", border: "1px solid var(--border)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Provider name"><input style={fieldStyle} placeholder="OpenAI" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
              <Field label="Model"><input style={fieldStyle} placeholder="gpt-4o-mini" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} /></Field>
            </div>
            <Field label="API base URL"><input style={fieldStyle} placeholder="https://api.openai.com/v1" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} /></Field>
            <Field label="Secret key"><input style={fieldStyle} type="password" placeholder="sk-…" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} /></Field>
            {err && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--error-ink)" }}>{err}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <PillButton tone="ghost" onClick={() => { setAdding(false); setErr(""); }}>Cancel</PillButton>
              <PillButton tone="primary" disabled={busy === "add"} onClick={add}>{busy === "add" ? "Connecting…" : "Connect provider"}</PillButton>
            </div>
          </div>
        ) : (
          <div>
            <PillButton tone={providers.length === 0 ? "primary" : "ghost"} onClick={() => setAdding(true)}>{providers.length === 0 ? "Connect a provider" : "Add another provider"}</PillButton>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---- Demo environment (shared GoPerfect product login) ---------------------
// The ONE GoPerfect account every clone signs into the product with — on every
// rehearsal and every live call. Stored server-side and shared across all
// clones (not per-agent). The password is write-only: GET returns only whether
// one is set (hasPassword), never the value, so we send `password` in the PUT
// ONLY when the operator types a new one. An email-only edit leaves the stored
// password untouched (the backend keeps the current one when none is sent).
function DemoEnvironmentCard() {
  const { data, reload } = useApi<{ email: string; hasPassword: boolean }>("/api/demo-login");
  const loaded = data != null;
  const email = data?.email ?? "";
  const hasPassword = !!data?.hasPassword;

  const [editing, setEditing] = useState(false);
  const [formEmail, setFormEmail] = useState("");
  const [formPw, setFormPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const open = () => { setFormEmail(email); setFormPw(""); setErr(""); setEditing(true); };

  const save = async () => {
    const e = formEmail.trim();
    if (!e || !e.includes("@")) { setErr("Enter a valid email."); return; }
    if (!hasPassword && !formPw) { setErr("Set a password — none is stored yet."); return; }
    setBusy(true); setErr("");
    try {
      // Send `password` only when a new one was typed, so an email-only edit
      // never wipes the stored password (the backend keeps the current one).
      await api.put("/api/demo-login", { email: e, ...(formPw ? { password: formPw } : {}) });
      setFormPw(""); setEditing(false);
      reload();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); } finally { setBusy(false); }
  };

  return (
    <Card
      icon="key"
      title="Demo environment"
      subtitle="The GoPerfect login every clone uses to sign in — one shared account, used on every rehearsal and live call."
      right={<StatusPill connected={!!email && hasPassword} />}
    >
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, borderRadius: 14, background: "var(--sunk)", border: "1px solid var(--border)" }}>
          <Field label="Account email">
            <input style={fieldStyle} type="email" placeholder="demo@goperfectmatch.com" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
          </Field>
          <Field label={hasPassword ? "Password (leave blank to keep current)" : "Password"}>
            <input style={fieldStyle} type="password" placeholder={hasPassword ? "•••••••• — a password is set" : "Set a password"} value={formPw} onChange={(e) => setFormPw(e.target.value)} />
          </Field>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.5 }}>Stored on your server only and used by the sandbox to sign in. The password is never shown back.</div>
          {err && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--error-ink)" }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <PillButton tone="ghost" onClick={() => { setEditing(false); setErr(""); }}>Cancel</PillButton>
            <PillButton tone="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save credentials"}</PillButton>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12.5, color: email ? "var(--ink2)" : "var(--ink3)" }}>
            {loaded
              ? (email
                  ? <>Signed in as <b style={{ color: "var(--ink1)" }}>{email}</b> · {hasPassword ? "Password set" : "Password not set"}</>
                  : "No account saved yet.")
              : "Loading…"}
          </span>
          <PillButton tone={email && hasPassword ? "ghost" : "primary"} onClick={open}>{email ? "Edit credentials" : "Set up"}</PillButton>
        </div>
      )}
    </Card>
  );
}

export default function Connections() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const { data: integrations, reload } = useApi<Integration[]>("/api/integrations");
  const list = integrations ?? [];
  const elevenlabs = list.find((i) => i.id === "elevenlabs") ?? null;
  const e2b = list.find((i) => i.id === "e2b") ?? null;

  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)", color: "var(--ink1)" }}>
      <PdsNav active="connections" theme={theme} onTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "26px 24px 60px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Connections</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 2 }}>The services your clones use to think, speak, and run</div>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.6, background: "var(--card)", borderRadius: 16, boxShadow: "var(--shadow)", padding: "16px 20px", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--decor)", flexShrink: 0 }}>lock</span>
          <span>Keys are stored securely on the server and never shown in full, only a masked hint after connecting. Everything on this page reflects the real connection state.</span>
        </div>

        <ProviderSection />

        {elevenlabs
          ? <ServiceCard svc={elevenlabs} reload={reload} />
          : <Card icon="graphic_eq" title="ElevenLabs (voice)" subtitle={integrations == null ? "Loading…" : "Unavailable right now."} right={<StatusPill connected={false} />} />}

        {e2b
          ? <ServiceCard svc={e2b} reload={reload} />
          : <Card icon="dns" title="E2B (sandbox)" subtitle={integrations == null ? "Loading…" : "Unavailable right now."} right={<StatusPill connected={false} />} />}

        <DemoEnvironmentCard />
      </div>
    </div>
  );
}
