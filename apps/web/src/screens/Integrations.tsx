// Integrations — connected tools (email, CRM, bank, Slack, browser) and, per
// integration, which agents may use it. The model provider is a swappable
// connector here too, and the model can be set PER AGENT, not just globally.
import { usePersistentState } from "../api/hooks";
import { Panel, Badge, Button, Icon } from "../ds";

const INTEGRATIONS: [string, string, string, string, string[]][] = [
  ["mail", "Gmail", "Email", "connected", ["SDR", "AR Clerk", "Support Agent"]],
  ["contact", "Salesforce", "CRM", "connected", ["SDR", "Recruiting Sourcer"]],
  ["landmark", "Mercury Bank", "Banking", "connected", ["AR Clerk"]],
  ["slack", "Slack", "Comms", "connected", ["System Agent", "Support Agent"]],
  ["globe", "Headless Browser", "Automation", "connected", ["SDR", "QA Tester"]],
  ["github", "GitHub", "Code", "connected", ["QA Tester", "Coding Agent"]],
  ["table", "Google Sheets", "Data", "connected", ["Data-Entry Clerk", "AR Clerk"]],
  ["headphones", "Zendesk", "Helpdesk", "disconnected", []],
];

// model connectors (swappable), and per-agent model assignment
const PROVIDERS: [string, string, string, string][] = [
  ["Anthropic", "claude-opus-4-8 · claude-sonnet-4-6", "connected", "var(--jv-cyan)"],
  ["Groq", "llama-3.3-70b · fast + free", "connected", "var(--jv-green)"],
  ["Google", "gemini-2.0-flash", "connected", "var(--jv-violet)"],
  ["OpenAI", "gpt-4o · o3", "disconnected", "var(--jv-text-faint)"],
];
const PER_AGENT_MODEL: [string, string, string][] = [
  ["SDR Agent", "send", "claude-sonnet-4-6"],
  ["AR Clerk", "credit-card", "claude-opus-4-8"],
  ["Recruiting Sourcer", "users", "gemini-2.0-flash"],
  ["QA Tester", "clipboard-check", "claude-opus-4-8"],
  ["Data-Entry Clerk", "table", "groq/llama-3.3-70b"],
];
const MODEL_OPTS = ["claude-opus-4-8", "claude-sonnet-4-6", "gemini-2.0-flash", "groq/llama-3.3-70b"];

function IntegrationCard({ ic, name, cat, status, agents }: { ic: string; name: string; cat: string; status: string; agents: string[] }) {
  const connected = status === "connected";
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
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {agents.map((a) => <span key={a} style={{ padding: "3px 9px", borderRadius: "var(--r-pill)", font: "var(--fw-medium) 10.5px var(--font-body)", color: "var(--jv-cyan-300)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>{a}</span>)}
            <button style={{ padding: "3px 9px", borderRadius: "var(--r-pill)", font: "var(--fw-medium) 10.5px var(--font-body)", color: "var(--jv-text-muted)", background: "var(--jv-void)", border: "1px dashed var(--jv-border)", cursor: "pointer" }}>+ Add</button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" icon={<Icon name="plug" size={13} />}>Connect</Button>
      )}
    </div>
  );
}

export default function Integrations() {
  const [models, setModels] = usePersistentState<Record<string, string>>("agent_models", Object.fromEntries(PER_AGENT_MODEL.map((r) => [r[0], r[2]])));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel title="Connected tools" eyebrow action={<Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />}>Add integration</Button>}>
        <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>Every connected tool, and which agents are allowed to use it. Access is granted per agent — no tool is open to the whole workforce by default.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {INTEGRATIONS.map((r, i) => <IntegrationCard key={i} ic={r[0]} name={r[1]} cat={r[2]} status={r[3]} agents={r[4]} />)}
        </div>
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <Panel title="Model providers" eyebrow action={<span style={{ font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>Swappable connectors</span>} bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PROVIDERS.map((p, i) => {
            const connected = p[2] === "connected";
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? p[3] : "var(--jv-text-faint)", boxShadow: connected ? `0 0 6px ${p[3]}` : "none" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{p[0]}</div>
                  <div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 1 }}>{p[1]}</div>
                </div>
                <span style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: connected ? "var(--jv-green)" : "var(--jv-text-faint)" }}>{connected ? "Connected" : "Off"}</span>
              </div>
            );
          })}
        </Panel>

        <Panel title="Model per agent" eyebrow action={<Icon name="cpu" size={15} color="var(--jv-cyan)" />}>
          <p style={{ margin: "0 0 12px", font: "var(--fw-regular) 11.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)" }}>Set the reasoning model per agent — not just one global default.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {PER_AGENT_MODEL.map((r) => (
              <div key={r[0]} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <span style={{ width: 28, height: 28, flex: "0 0 28px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name={r[1]} size={14} /></span>
                <span style={{ flex: 1, font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{r[0]}</span>
                <select value={models[r[0]]} onChange={(e) => setModels({ ...models, [r[0]]: e.target.value })} style={{ height: 32, padding: "0 8px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-cyan-300)", font: "11px var(--font-mono)", cursor: "pointer" }}>
                  {MODEL_OPTS.map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
