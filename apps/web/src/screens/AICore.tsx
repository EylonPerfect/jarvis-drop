// AICore — the AI Control Center. Connect OpenAI-compatible AI providers (base
// URL + key + model), test them live, and pick the active one the Command
// Center chat routes through. Advanced routing toggles live below.
import { useEffect, useState } from "react";
import { Panel, Badge, Button, Switch, Icon, EmptyState, IconButton, ConfirmDialog } from "../ds";
import type { AICoreState, AiProvider } from "@jarvis/shared";
import { useApi } from "../api/hooks";
import { api } from "../api/client";

const EMPTY: AICoreState = {
  activeModel: "None",
  connectedProviders: "0 connected",
  fallbacks: "hermes gateway",
  savedKeys: "0",
  routing: false,
  streaming: false,
  verification: false,
  models: [],
  providers: [],
};

// One-click starting points for common OpenAI-compatible gateways. Claude is
// reachable via OpenRouter (model anthropic/claude-*).
const PRESETS: { label: string; baseUrl: string; model: string }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "OpenRouter (Claude)", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-3.5-sonnet" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "Together", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { label: "Ollama (local)", baseUrl: "http://host.docker.internal:11434/v1", model: "llama3.1" },
];

function MetaTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--grad-panel)", border: "1px solid var(--jv-border-soft)" }}>
      <span style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name={icon} size={16} /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{label}</div>
        <div style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      </div>
    </div>
  );
}

const fieldStyle = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  borderRadius: "var(--r-sm)",
  background: "var(--jv-void)",
  border: "1px solid var(--jv-border)",
  color: "var(--jv-text)",
  font: "var(--fw-medium) 13px var(--font-body)",
  outline: "none",
  boxSizing: "border-box" as const,
};

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{label}</span>
      {children}
    </label>
  );
}

type TestState = { ok: boolean; detail: string } | "testing" | undefined;

function ProviderRow({ p, onActivate, onTest, onDelete, onEdit, editing, test }: { p: AiProvider; onActivate: () => void; onTest: () => void; onDelete: () => void; onEdit: () => void; editing: boolean; test: TestState }) {
  return (
    <div style={{ padding: 14, borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: `1px solid ${p.active ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 34, height: 34, flex: "0 0 34px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}><Icon name="cpu" size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ font: "var(--fw-bold) 14px var(--font-body)", color: "var(--jv-text)" }}>{p.name}</span>
            {p.active && <Badge status="optimal">Active</Badge>}
          </div>
          <div style={{ font: "var(--fw-regular) 11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.model} · {p.baseUrl} · key ••••{p.keyLast4}</div>
        </div>
        <IconButton icon="trash-2" tone="danger" title="Delete provider" onClick={onDelete} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {!p.active && <Button size="sm" variant="secondary" icon={<Icon name="check" size={13} />} onClick={onActivate}>Set active</Button>}
        <Button size="sm" variant="ghost" icon={<Icon name={test === "testing" ? "loader" : "plug-zap"} size={13} />} onClick={onTest} disabled={test === "testing"}>Test connection</Button>
        <Button size="sm" variant="ghost" icon={<Icon name={editing ? "x" : "settings-2"} size={13} />} onClick={onEdit}>{editing ? "Close" : "Edit"}</Button>
        {test && test !== "testing" && (
          <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 11.5px var(--font-body)", color: test.ok ? "var(--jv-green)" : "var(--jv-red-400)" }}>
            <Icon name={test.ok ? "check-circle" : "alert-triangle"} size={13} /> {test.detail}
          </span>
        )}
      </div>
    </div>
  );
}

export default function AICore() {
  const { data, reload } = useApi<AICoreState>("/api/aicore");
  const { data: provData, reload: reloadProviders } = useApi<AiProvider[]>("/api/aicore/providers");
  const state = data ?? EMPTY;
  const providers = provData ?? [];

  const [routing, setRouting] = useState(state.routing);
  const [stream, setStream] = useState(state.streaming);
  const [verify, setVerify] = useState(state.verification);

  // Pre-filled with OpenAI defaults so a user who only has a secret key can just
  // paste it and connect. Quick-fill chips swap these for another provider.
  const [form, setForm] = useState({ name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" });
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [confirmClear, setConfirmClear] = useState(false);
  // Inline edit of an existing provider (name / base URL / model / rotate key).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", baseUrl: "", model: "", apiKey: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  useEffect(() => {
    if (data) {
      setRouting(data.routing);
      setStream(data.streaming);
      setVerify(data.verification);
    }
  }, [data]);

  const refreshAll = () => {
    reload();
    reloadProviders();
  };

  const addProvider = async () => {
    setError("");
    if (!form.name.trim() || !form.baseUrl.trim() || !form.apiKey.trim() || !form.model.trim()) {
      setError("Fill in a name, base URL, model, and API key.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/aicore/providers", form);
      setForm({ name: "", baseUrl: "", apiKey: "", model: "" });
      setAdding(false);
      refreshAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const activate = async (id: string) => {
    await api.patch(`/api/aicore/providers/${id}`, { active: true });
    refreshAll();
  };
  const remove = async (id: string) => {
    await api.del(`/api/aicore/providers/${id}`);
    refreshAll();
  };
  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: "testing" }));
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(`/api/aicore/providers/${id}/test`);
      setTests((t) => ({ ...t, [id]: { ok: r.ok, detail: r.detail } }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, detail: String(e) } }));
    }
  };
  const clearAll = async () => {
    await api.del("/api/aicore/providers");
    setConfirmClear(false);
    refreshAll();
  };
  const startEdit = (p: AiProvider) => {
    setEditingId(p.id);
    setEditForm({ name: p.name, baseUrl: p.baseUrl, model: p.model, apiKey: "" });
    setEditError("");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditError("");
  };
  const saveEdit = async (id: string) => {
    if (!editForm.name.trim() || !editForm.baseUrl.trim() || !editForm.model.trim()) {
      setEditError("Name, base URL and model are required.");
      return;
    }
    setSavingEdit(true);
    try {
      const body: Record<string, string> = { name: editForm.name.trim(), baseUrl: editForm.baseUrl.trim(), model: editForm.model.trim() };
      if (editForm.apiKey.trim()) body.apiKey = editForm.apiKey.trim(); // blank = keep existing key
      await api.patch(`/api/aicore/providers/${id}`, body);
      setEditingId(null);
      refreshAll();
    } catch (e) {
      setEditError(String(e));
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* hero */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>
        <Panel>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <Badge status={providers.some((p) => p.active) ? "optimal" : "standby"}>{providers.some((p) => p.active) ? "Ready for chat" : "No active provider"}</Badge>
            <Badge status="info" dot={false}><Icon name="shield" size={11} style={{ marginRight: 4 }} />keys stored server-side</Badge>
          </div>
          <div style={{ font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>AI Control Center</div>
          <p style={{ margin: "0 0 16px", maxWidth: 620, font: "var(--fw-regular) 13.5px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>Connect any OpenAI-compatible provider — OpenAI, Groq, OpenRouter (for Claude), DeepSeek, Together, or a local Ollama. The active provider is what After Human speaks through in the Command Center. Keys never leave the server.</p>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="primary" icon={<Icon name="plus" size={14} />} onClick={() => setAdding((a) => !a)}>Connect a provider</Button>
            <Button variant="ghost" icon={<Icon name="refresh-cw" size={14} />} onClick={refreshAll}>Refresh</Button>
          </div>
        </Panel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <MetaTile icon="cpu" label="Active model" value={state.activeModel} />
          <MetaTile icon="plug" label="Connected providers" value={state.connectedProviders} />
          <MetaTile icon="git-branch" label="Chat routes via" value={state.fallbacks} />
        </div>
      </div>

      {/* providers */}
      <Panel
        title="AI providers"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            {providers.length > 0 && <Button size="sm" variant="danger" icon={<Icon name="trash-2" size={13} />} onClick={() => setConfirmClear(true)}>Clear all</Button>}
            <Button size="sm" variant="secondary" icon={<Icon name={adding ? "x" : "plus"} size={13} />} onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "Add provider"}</Button>
          </div>
        }
      >
        {adding && (
          <div style={{ padding: 16, borderRadius: "var(--r-md)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)", marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 2 }}>
              <span style={{ font: "var(--fw-medium) 11px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-text-muted)", alignSelf: "center", marginRight: 4 }}>Quick fill:</span>
              {PRESETS.map((p) => (
                <button key={p.label} onClick={() => setForm((f) => ({ ...f, name: f.name || p.label, baseUrl: p.baseUrl, model: p.model }))}
                  style={{ padding: "4px 10px", borderRadius: "var(--r-pill)", cursor: "pointer", font: "var(--fw-semibold) 11px var(--font-body)", color: "var(--jv-cyan-100)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>{p.label}</button>
              ))}
            </div>
            <div style={{ font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-muted)" }}>
              For OpenAI you only need to paste your <b style={{ color: "var(--jv-text-soft)" }}>secret key</b> below — the base URL and model are already filled in. Connecting a different provider? Use a Quick-fill chip above.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Labeled label="Provider name">
                <input style={fieldStyle} placeholder="OpenAI" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </Labeled>
              <Labeled label="Model">
                <input style={fieldStyle} placeholder="gpt-4o-mini" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
              </Labeled>
            </div>
            <Labeled label="API base URL">
              <input style={fieldStyle} placeholder="https://api.openai.com/v1" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
            </Labeled>
            <Labeled label="Secret key  ·  from your provider">
              <input style={fieldStyle} type="password" placeholder="sk-…" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} />
            </Labeled>
            {error && <div style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-red-400)" }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="primary" icon={<Icon name={saving ? "loader" : "plus"} size={14} />} onClick={addProvider} disabled={saving}>Connect provider</Button>
            </div>
          </div>
        )}

        {providers.length === 0 && !adding ? (
          <EmptyState
            icon="plug"
            title="No AI providers connected"
            hint="Connect an OpenAI-compatible provider to give After Human a model to think and speak with. For Claude, use OpenRouter with model anthropic/claude-3.5-sonnet."
            action={<Button size="sm" variant="primary" icon={<Icon name="plus" size={13} />} onClick={() => setAdding(true)}>Connect a provider</Button>}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {providers.map((p) => (
              <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <ProviderRow p={p} test={tests[p.id]} editing={editingId === p.id} onActivate={() => activate(p.id)} onTest={() => test(p.id)} onDelete={() => remove(p.id)} onEdit={() => (editingId === p.id ? cancelEdit() : startEdit(p))} />
                {editingId === p.id && (
                  <div style={{ padding: 16, borderRadius: "var(--r-md)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>Edit provider</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <Labeled label="Provider name"><input style={fieldStyle} value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} /></Labeled>
                      <Labeled label="Model"><input style={fieldStyle} placeholder="gpt-4o-mini" value={editForm.model} onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))} /></Labeled>
                    </div>
                    <Labeled label="API base URL"><input style={fieldStyle} value={editForm.baseUrl} onChange={(e) => setEditForm((f) => ({ ...f, baseUrl: e.target.value }))} /></Labeled>
                    <Labeled label="Secret key  ·  leave blank to keep current"><input style={fieldStyle} type="password" placeholder="•••• keep existing key" value={editForm.apiKey} onChange={(e) => setEditForm((f) => ({ ...f, apiKey: e.target.value }))} /></Labeled>
                    {editError && <div style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-red-400)" }}>{editError}</div>}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
                      <Button size="sm" variant="primary" icon={<Icon name={savingEdit ? "loader" : "check"} size={13} />} onClick={() => saveEdit(p.id)} disabled={savingEdit}>Save changes</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* advanced */}
      <Panel title="Advanced settings" eyebrow>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {([
            ["Expert model routing", "Route each turn to the best-fit model automatically", routing, (val: boolean) => { setRouting(val); api.patch("/api/aicore", { routing: val }); }],
            ["Token streaming", "Stream responses token-by-token to the HUD", stream, (val: boolean) => { setStream(val); api.patch("/api/aicore", { streaming: val }); }],
            ["Response verification pass", "Run a second-model check on critical answers", verify, (val: boolean) => { setVerify(val); api.patch("/api/aicore", { verification: val }); }],
          ] as [string, string, boolean, (v: boolean) => void][]).map(([t, d, val, set], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderBottom: i < 2 ? "1px solid var(--jv-hairline)" : "none" }}>
              <div>
                <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{t}</div>
                <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{d}</div>
              </div>
              <Switch checked={val} onChange={set} />
            </div>
          ))}
        </div>
      </Panel>

      <ConfirmDialog open={confirmClear} danger title="Remove all providers?" message="This deletes every connected AI provider and its stored key. This cannot be undone." confirmLabel="Remove all" onConfirm={clearAll} onCancel={() => setConfirmClear(false)} />
    </div>
  );
}
