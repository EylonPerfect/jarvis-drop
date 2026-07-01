// Integrations — connectable tools (email, CRM, bank, Slack, browser) shown as a
// catalog. Each can be connected per operator; connection state is persisted.
// The model provider is a swappable connector, and the model can be set PER AGENT.
import { usePersistentState } from "../api/hooks";
import { Panel, Badge, Button, Icon, EmptyState } from "../ds";

// Catalog of connectable services. Connection state lives in persisted state,
// so on a clean system nothing is connected by default.
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

// Available model connectors (catalog). Off until an operator connects one.
const PROVIDERS: [string, string, string][] = [
  ["Anthropic", "claude-opus-4-8 · claude-sonnet-4-6", "var(--jv-cyan)"],
  ["Groq", "llama-3.3-70b · fast + free", "var(--jv-green)"],
  ["Google", "gemini-2.0-flash", "var(--jv-violet)"],
  ["OpenAI", "gpt-4o · o3", "var(--jv-text-faint)"],
];
const MODEL_OPTS = ["claude-opus-4-8", "claude-sonnet-4-6", "gemini-2.0-flash", "groq/llama-3.3-70b"];

function IntegrationCard({ ic, name, cat, connected, onToggle }: { ic: string; name: string; cat: string; connected: boolean; onToggle: () => void }) {
  return (
    <div style={{ padding: 15, borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: `1px solid ${connected ? "var(--jv-border)" : "var(--jv-border-soft)"}`, opacity: connected ? 1 : 0.72 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 11 }}>
        <span style={{ width: 38, height: 38, flex: "0 0 38px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: connected ? "var(--jv-cyan)" : "var(--jv-text-muted)", background: connected ? "rgba(41,211,245,0.08)" : "rgba(120,160,190,0.06)" }}><Icon name={ic} size={18} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ font: "var(--fw-bold) 13.5px var(--font-body)", color: "var(--jv-text)" }}>{name}</div>
          <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{cat}</div>
        </div>
        <Badge status={connected ? "optimal" : "standby"}>{connected ? "Connected" : "Off"}</Badge>
      </div>
      {connected ? (
        <div>
          <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-faint)", marginBottom: 6 }}>Agents allowed</div>
          <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", marginBottom: 10 }}>No agents assigned yet — grant access per agent in Permissions.</div>
          <Button size="sm" variant="ghost" icon={<Icon name="plug" size={13} />} onClick={onToggle}>Disconnect</Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" icon={<Icon name="plug" size={13} />} onClick={onToggle}>Connect</Button>
      )}
    </div>
  );
}

export default function Integrations() {
  const [connections, setConnections] = usePersistentState<Record<string, boolean>>("integrations", {});
  const [models, setModels] = usePersistentState<Record<string, string>>("agent_models", {});
  const toggleConnection = (name: string) => setConnections((prev) => ({ ...prev, [name]: !prev[name] }));
  const modelEntries = Object.entries(models);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel title="Connected tools" eyebrow>
        <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>Every connectable tool, and which agents are allowed to use it. Access is granted per agent — no tool is open to the whole workforce by default.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {CATALOG.map((r) => <IntegrationCard key={r[1]} ic={r[0]} name={r[1]} cat={r[2]} connected={!!connections[r[1]]} onToggle={() => toggleConnection(r[1])} />)}
        </div>
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <Panel title="Model providers" eyebrow action={<span style={{ font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>Swappable connectors</span>} bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PROVIDERS.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--jv-text-faint)", boxShadow: "none" }} />
              <div style={{ flex: 1 }}>
                <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{p[0]}</div>
                <div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 1 }}>{p[1]}</div>
              </div>
              <span style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-text-faint)" }}>Off</span>
            </div>
          ))}
        </Panel>

        <Panel title="Model per agent" eyebrow action={<Icon name="cpu" size={15} color="var(--jv-cyan)" />}>
          <p style={{ margin: "0 0 12px", font: "var(--fw-regular) 11.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)" }}>Set the reasoning model per agent — not just one global default.</p>
          {modelEntries.length === 0 ? (
            <EmptyState icon="cpu" title="No agents configured yet" hint="Once agents are hired, assign each one its own reasoning model here." compact />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {modelEntries.map(([name, model]) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                  <span style={{ width: 28, height: 28, flex: "0 0 28px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name="bot" size={14} /></span>
                  <span style={{ flex: 1, font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{name}</span>
                  <select value={model} onChange={(e) => setModels({ ...models, [name]: e.target.value })} style={{ height: 32, padding: "0 8px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-cyan-300)", font: "11px var(--font-mono)", cursor: "pointer" }}>
                    {MODEL_OPTS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
