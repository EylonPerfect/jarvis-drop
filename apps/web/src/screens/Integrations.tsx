// Integrations — connectable tools (email, CRM, bank, Slack, browser) shown as a
// catalog. Tool cards are local operator preferences (no live OAuth backend).
// Model providers and per-agent model come from the real agents/aicore backend.
import { usePersistentState, useApi } from "../api/hooks";
import { api } from "../api/client";
import { Panel, Badge, Button, Icon, EmptyState } from "../ds";
import type { Agent, AiProvider } from "@jarvis/shared";

// Catalog of connectable services. These have no real backend integration yet,
// so the toggle is a local preference only — it does not open a live connection.
const CATALOG: [string, string, string][] = [
  ["mail", "Gmail", "Email"],
  ["contact", "Salesforce", "CRM"],
  ["landmark", "Mercury Bank", "Banking"],
  ["slack", "Slack", "Comms"],
  ["globe", "Headless Browser", "Automation"],
  ["github", "GitHub", "Code"],
  ["table", "Google Sheets", "Data"],
  ["headphones", "Zendesk", "Helpdesk"],
];

// Static fallback model list, used only when no providers are configured in AI Core.
const FALLBACK_MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "gemini-2.0-flash", "groq/llama-3.3-70b"];

function IntegrationCard({ ic, name, cat, connected, onToggle }: { ic: string; name: string; cat: string; connected: boolean; onToggle: () => void }) {
  return (
    <div style={{ padding: 15, borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: `1px solid ${connected ? "var(--jv-border)" : "var(--jv-border-soft)"}`, opacity: connected ? 1 : 0.72 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 11 }}>
        <span style={{ width: 38, height: 38, flex: "0 0 38px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: connected ? "var(--jv-cyan)" : "var(--jv-text-muted)", background: connected ? "rgba(41,211,245,0.08)" : "rgba(120,160,190,0.06)" }}><Icon name={ic} size={18} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ font: "var(--fw-bold) 13.5px var(--font-body)", color: "var(--jv-text)" }}>{name}</div>
          <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{cat}</div>
        </div>
        <Badge status={connected ? "optimal" : "standby"}>{connected ? "On" : "Off"}</Badge>
      </div>
      <div style={{ font: "var(--fw-regular) 10.5px var(--font-body)", color: "var(--jv-text-faint)", marginBottom: 10 }}>Local preference — no live connection.</div>
      {connected ? (
        <Button size="sm" variant="ghost" icon={<Icon name="plug" size={13} />} onClick={onToggle}>Turn off</Button>
      ) : (
        <Button size="sm" variant="secondary" icon={<Icon name="plug" size={13} />} onClick={onToggle}>Turn on</Button>
      )}
    </div>
  );
}

export default function Integrations() {
  const [connections, setConnections] = usePersistentState<Record<string, boolean>>("integrations", {});
  const { data: agentsData, reload: reloadAgents } = useApi<Agent[]>("/api/agents");
  const { data: providersData } = useApi<AiProvider[]>("/api/aicore/providers");

  const agents = agentsData ?? [];
  const providers = providersData ?? [];

  const toggleConnection = (name: string) => setConnections((prev) => ({ ...prev, [name]: !prev[name] }));

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel title="Connected tools" eyebrow>
        <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>Toggle which tools your workforce should prefer. These are local preferences — there is no live OAuth connection behind them yet.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {CATALOG.map((r) => <IntegrationCard key={r[1]} ic={r[0]} name={r[1]} cat={r[2]} connected={!!connections[r[1]]} onToggle={() => toggleConnection(r[1])} />)}
        </div>
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
