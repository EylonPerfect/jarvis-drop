// Integrations — real credential store for connectable systems (email, calendar,
// messaging, voice, CRM, productivity, payments, runtime). Credentials are stored
// securely server-side; the browser only ever sees a masked hint, never the raw
// secret. Model providers and per-agent model come from the real agents/aicore
// backend and are left untouched below.
import { useState } from "react";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import { Panel, Badge, Button, Icon, EmptyState } from "../ds";
import type { Agent, AiProvider, Integration, IntegrationTestResult } from "@jarvis/shared";

// Static fallback model list, used only when no providers are configured in AI Core.
const FALLBACK_MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "gemini-2.0-flash", "groq/llama-3.3-70b"];

// Category display order + labels. Only categories with items render.
const CATEGORY_ORDER: Integration["category"][] = [
  "voice", "email", "calendar", "messaging", "crm", "productivity", "payments", "runtime",
];
const CATEGORY_LABEL: Record<Integration["category"], string> = {
  email: "Email",
  calendar: "Calendar",
  messaging: "Messaging",
  voice: "Voice",
  productivity: "Productivity",
  crm: "CRM",
  payments: "Payments",
  runtime: "Runtime",
};

function StatusPill({ status }: { status: Integration["status"] }) {
  if (status === "connected") return <Badge status="optimal">Connected</Badge>;
  if (status === "error") return <Badge status="critical">Error</Badge>;
  return <Badge status="neutral" dot={false}>Not connected</Badge>;
}

function IntegrationCard({ ic, reload }: { ic: Integration; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<IntegrationTestResult | null>(null);
  const [disc, setDisc] = useState(false);

  const native = ic.authKind === "none";
  const hasForm = !native && ic.fields.length > 0;

  const setField = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const connect = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.post(`/api/integrations/${ic.id}/connect`, { values });
      setOpen(false);
      setValues({});
      reload();
    } catch {
      /* gateway may be offline — leave the form open */
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    setTest(null);
    try {
      const r = await api.post<IntegrationTestResult>(`/api/integrations/${ic.id}/test`);
      setTest(r);
    } catch {
      setTest({ ok: false, detail: "Test failed — gateway unreachable." });
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    if (disc) return;
    setDisc(true);
    try {
      await api.del(`/api/integrations/${ic.id}`);
      setTest(null);
      reload();
    } catch {
      /* ignore */
    } finally {
      setDisc(false);
    }
  };

  return (
    <div style={{ padding: 15, borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: `1px solid ${ic.connected ? "var(--jv-border)" : "var(--jv-border-soft)"}`, opacity: ic.connected ? 1 : 0.92, display: "flex", flexDirection: "column", gap: 11 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ width: 38, height: 38, flex: "0 0 38px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: ic.connected ? "var(--jv-cyan)" : "var(--jv-text-muted)", background: ic.connected ? "rgba(41,211,245,0.08)" : "rgba(120,160,190,0.06)" }}><Icon name={ic.icon} size={18} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ font: "var(--fw-bold) 13.5px var(--font-body)", color: "var(--jv-text)" }}>{ic.label}</span>
            {ic.recommended && <Badge status="info" dot={false}>Recommended</Badge>}
          </div>
          {ic.connected && ic.detail && (
            <div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 2 }}>{ic.detail}</div>
          )}
        </div>
        <StatusPill status={ic.status} />
      </div>

      {ic.note && (
        <div style={{ font: "var(--fw-regular) 11px/1.5 var(--font-body)", color: "var(--jv-text-faint)" }}>{ic.note}</div>
      )}

      {ic.live && ic.hermesToolset && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-green)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--jv-green)", boxShadow: "0 0 6px var(--jv-green)" }} />
          Live via Hermes · {ic.hermesToolset}
        </div>
      )}

      {native ? (
        <div style={{ font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-cyan-100)" }}>Available via Hermes — no setup required.</div>
      ) : (
        <>
          {!open && !ic.connected && (
            <div>
              <Button size="sm" variant="secondary" icon={<Icon name="plug" size={13} />} onClick={() => (hasForm ? setOpen(true) : connect())}>Connect</Button>
            </div>
          )}

          {open && hasForm && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)" }}>
              {ic.fields.map((f) => (
                <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ font: "var(--fw-medium) 10.5px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>
                    {f.label}{f.optional ? " (optional)" : ""}
                  </span>
                  <input
                    type={f.secret ? "password" : "text"}
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setField(f.key, e.target.value)}
                    style={{ height: 36, padding: "0 10px", borderRadius: "var(--r-sm)", background: "rgba(4,12,22,0.6)", border: "1px solid var(--jv-border)", color: "var(--jv-text)", font: "12px var(--font-mono)", outline: "none" }}
                  />
                </label>
              ))}
              {ic.docsUrl && (
                <a href={ic.docsUrl} target="_blank" rel="noreferrer" style={{ font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-cyan)", textDecoration: "none" }}>Where do I get this?</a>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                <Button size="sm" variant="primary" disabled={saving} icon={saving ? <Icon name="loader" size={13} /> : undefined} onClick={connect}>{saving ? "Connecting…" : "Save & connect"}</Button>
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setOpen(false); setValues({}); }}>Cancel</Button>
              </div>
            </div>
          )}

          {ic.connected && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Button size="sm" variant="secondary" disabled={testing} icon={testing ? <Icon name="loader" size={13} /> : <Icon name="activity" size={13} />} onClick={runTest}>{testing ? "Testing…" : "Test"}</Button>
              <Button size="sm" variant="ghost" disabled={disc} icon={<Icon name="plug" size={13} />} onClick={disconnect}>{disc ? "Disconnecting…" : "Disconnect"}</Button>
              {test && (
                <span style={{ font: "var(--fw-medium) 11px var(--font-body)", color: test.ok ? "var(--jv-green)" : "var(--jv-amber)" }}>{test.detail}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Integrations() {
  const { data: integrationsData, reload: reloadIntegrations } = useApi<Integration[]>("/api/integrations");
  const { data: agentsData, reload: reloadAgents } = useApi<Agent[]>("/api/agents");
  const { data: providersData } = useApi<AiProvider[]>("/api/aicore/providers");

  const integrations = integrationsData ?? [];
  const agents = agentsData ?? [];
  const providers = providersData ?? [];

  // Model options come from configured AI Core providers; fall back to a small
  // static list when none are set up yet.
  const providerModels = Array.from(new Set(providers.map((p) => p.model).filter(Boolean)));
  const baseModelOpts = providerModels.length > 0 ? providerModels : FALLBACK_MODELS;

  const setModel = async (id: string, model: string) => {
    try {
      await api.patch(`/api/agents/${id}`, { model });
      reloadAgents();
    } catch {
      /* gateway may be offline */
    }
  };

  const categories = CATEGORY_ORDER.filter((cat) => integrations.some((i) => i.category === cat));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel title="Connections" eyebrow>
        <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>Real connections to the systems your workforce uses. Credentials are stored securely server-side and never shown in full — only a masked hint after connecting.</p>
        {integrationsData == null ? (
          <EmptyState icon="plug" title="Loading connections…" compact />
        ) : integrations.length === 0 ? (
          <EmptyState icon="plug" title="No connections available" hint="Connectable integrations will appear here once the gateway is reachable." compact />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {categories.map((cat) => {
              const items = integrations.filter((i) => i.category === cat);
              return (
                <div key={cat}>
                  <div style={{ font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 10 }}>{CATEGORY_LABEL[cat]}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                    {items.map((ic) => <IntegrationCard key={ic.id} ic={ic} reload={reloadIntegrations} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <Panel title="Model providers" eyebrow action={<span style={{ font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>From AI Core</span>} bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {providers.length === 0 ? (
            <EmptyState icon="cpu" title="No providers configured" hint="Add an OpenAI-compatible provider in AI Core to power the workforce." compact />
          ) : (
            providers.map((p) => {
              const on = p.active || p.hasKey;
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: on ? "var(--jv-green)" : "var(--jv-text-faint)", boxShadow: on ? "0 0 6px var(--jv-green)" : "none" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{p.name}</div>
                    <div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 1 }}>{p.model}</div>
                  </div>
                  <span style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: p.active ? "var(--jv-green)" : "var(--jv-text-faint)" }}>{p.active ? "Active" : p.hasKey ? "Connected" : "Off"}</span>
                </div>
              );
            })
          )}
        </Panel>

        <Panel title="Model per agent" eyebrow action={<Icon name="cpu" size={15} color="var(--jv-cyan)" />}>
          <p style={{ margin: "0 0 12px", font: "var(--fw-regular) 11.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)" }}>Set the reasoning model per agent — not just one global default.</p>
          {agents.length === 0 ? (
            <EmptyState icon="cpu" title="No agents configured yet" hint="Once agents are hired, assign each one its own reasoning model here." compact />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {agents.map((a) => {
                // Include the agent's current model in the option list even if it
                // isn't advertised by any provider, so the <select> reflects it.
                const opts = a.model && !baseModelOpts.includes(a.model) ? [a.model, ...baseModelOpts] : baseModelOpts;
                return (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                    <span style={{ width: 28, height: 28, flex: "0 0 28px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name={a.icon || "bot"} size={14} /></span>
                    <span style={{ flex: 1, font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{a.name}</span>
                    <select value={a.model ?? ""} onChange={(e) => setModel(a.id, e.target.value)} style={{ height: 32, padding: "0 8px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-cyan-300)", font: "11px var(--font-mono)", cursor: "pointer" }}>
                      {!a.model && <option value="" disabled>Select model…</option>}
                      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
