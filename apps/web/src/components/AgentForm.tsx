import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Button, Icon } from "../ds";
import { useApi } from "../api/hooks";
import type { AiProvider, Agent, NewAgent } from "@jarvis/shared";

// Shared agent-builder form used by both the Roster (modal) and Hire an Agent
// (inline). Model choices come from the providers connected in AI Core;
// collaborators come from the real roster. One source of truth for both places.

const ICON_CHOICES = ["bot", "code", "search", "database", "globe", "list-checks", "shield-check", "mail", "calendar", "pen-tool", "bar-chart-3", "terminal"];
const TOOL_CHOICES = ["web_search", "code_interpreter", "filesystem", "github", "memory.query", "calendar", "gmail", "whatsapp", "shell", "vision"];
const AUTONOMY_CHOICES = ["Ask before acting", "Act, then report", "Fully autonomous"];

const inputStyle: CSSProperties = {
  width: "100%",
  height: 40,
  padding: "0 14px",
  borderRadius: "var(--r-sm)",
  background: "var(--jv-void)",
  border: "1px solid var(--jv-border)",
  color: "var(--jv-text)",
  font: "var(--fw-medium) 13px var(--font-body)",
  outline: "none",
  boxSizing: "border-box",
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>{label}</div>
      {children}
      {hint && <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: "var(--r-pill)",
        border: `1px solid ${active ? "var(--jv-border-cyan)" : "var(--jv-border)"}`,
        background: active ? "var(--grad-cyan-soft)" : "var(--jv-void)",
        color: active ? "var(--jv-cyan-300)" : "var(--jv-text-muted)",
        font: `${active ? "var(--fw-semibold)" : "var(--fw-medium)"} 12px var(--font-mono)`,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function AgentForm({
  submitLabel = "Deploy Agent",
  onSubmit,
  resetOnSubmit = false,
  onCancel,
}: {
  submitLabel?: string;
  onSubmit: (a: NewAgent) => void;
  resetOnSubmit?: boolean;
  onCancel?: () => void;
}) {
  const { data: provData } = useApi<AiProvider[]>("/api/aicore/providers");
  const providers = provData ?? [];
  const models = Array.from(new Set(providers.map((p) => p.model)));
  const activeModel = providers.find((p) => p.active)?.model ?? models[0] ?? "";

  const { data: agentsData } = useApi<Agent[]>("/api/agents");
  const roster = (agentsData ?? []).map((a) => a.name);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [icon, setIcon] = useState("bot");
  const [model, setModel] = useState("");
  const [tools, setTools] = useState<string[]>(["web_search"]);
  const [collabs, setCollabs] = useState<string[]>([]);
  const [autonomy, setAutonomy] = useState(AUTONOMY_CHOICES[0]);
  const [instr, setInstr] = useState("");

  useEffect(() => {
    if (!model && activeModel) setModel(activeModel);
  }, [activeModel, model]);

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const ready = name.trim() !== "" && role.trim() !== "";

  const submit = () => {
    if (!ready) return;
    onSubmit({ icon, name: name.trim(), role: role.trim(), model: model || undefined, tools, collaborators: collabs, autonomy, instructions: instr.trim() || undefined });
    if (resetOnSubmit) {
      setName("");
      setRole("");
      setIcon("bot");
      setTools(["web_search"]);
      setCollabs([]);
      setAutonomy(AUTONOMY_CHOICES[0]);
      setInstr("");
    }
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label="Agent name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Finance Agent" style={inputStyle} />
        </Field>
        <Field label="Role">
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Tracks spend & budgets" style={inputStyle} />
        </Field>
      </div>

      <Field label="Icon">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ICON_CHOICES.map((ic) => (
            <button
              key={ic}
              onClick={() => setIcon(ic)}
              title={ic}
              style={{
                width: 38,
                height: 38,
                display: "grid",
                placeItems: "center",
                borderRadius: "var(--r-sm)",
                cursor: "pointer",
                color: icon === ic ? "var(--jv-cyan-300)" : "var(--jv-text-muted)",
                background: icon === ic ? "var(--grad-cyan-soft)" : "var(--jv-void)",
                border: `1px solid ${icon === ic ? "var(--jv-border-cyan)" : "var(--jv-border)"}`,
              }}
            >
              <Icon name={ic} size={17} />
            </button>
          ))}
        </div>
      </Field>

      <Field label="Reasoning model" hint="Comes from the providers you connected in AI Core.">
        {models.length ? (
          <select value={model} onChange={(e) => setModel(e.target.value)} style={{ ...inputStyle, appearance: "none", cursor: "pointer", maxWidth: 360 }}>
            {models.map((m) => {
              const p = providers.find((pr) => pr.model === m);
              return (
                <option key={m} value={m}>
                  {m}{p ? ` · ${p.name}` : ""}{p?.active ? " (active)" : ""}
                </option>
              );
            })}
          </select>
        ) : (
          <div style={{ ...inputStyle, maxWidth: 360, display: "flex", alignItems: "center", gap: 7, color: "var(--jv-text-muted)", font: "var(--fw-regular) 12px var(--font-body)" }}>
            <Icon name="plug" size={13} /> No model connected — add one in AI Core
          </div>
        )}
      </Field>

      <Field label="Tools & skills" hint={`${tools.length} selected — what this agent is allowed to call.`}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TOOL_CHOICES.map((t) => (
            <Chip key={t} active={tools.includes(t)} onClick={() => toggle(tools, setTools, t)}>
              {t}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Collaborates with" hint={roster.length ? "Teammates this agent may hand off to in a multi-agent run." : "Hire teammates first to enable hand-offs."}>
        {roster.length ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {roster.map((t) => (
              <Chip key={t} active={collabs.includes(t)} onClick={() => toggle(collabs, setCollabs, t)}>
                {t}
              </Chip>
            ))}
          </div>
        ) : (
          <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-faint)" }}>No other agents yet.</div>
        )}
      </Field>

      <Field label="Autonomy">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {AUTONOMY_CHOICES.map((a) => (
            <Chip key={a} active={autonomy === a} onClick={() => setAutonomy(a)}>
              {a}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="System instructions">
        <textarea
          value={instr}
          onChange={(e) => setInstr(e.target.value)}
          placeholder="Describe how this teammate should think and behave…"
          style={{ ...inputStyle, height: 80, padding: "10px 14px", resize: "vertical", font: "var(--fw-regular) 13px/1.5 var(--font-body)" }}
        />
      </Field>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 4 }}>
        <span style={{ font: "11px var(--font-mono)", color: "var(--jv-text-faint)" }}>{ready ? "Ready to deploy" : "Name and role required"}</span>
        <div style={{ display: "flex", gap: 10 }}>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button variant="primary" icon={<Icon name="rocket" size={14} />} disabled={!ready} onClick={submit}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
