// Agents — multi-agent runtime: the agent roster (status) and the recent
// multi-agent executions log with per-run step counts and outcomes.
(function () {
const { Panel, Badge, Button, Icon, StatTile } = window.JARVISDesignSystem_547efc;

const ROSTER = [
  ["code", "Coding Agent", "Writing code", "optimal", "Active"],
  ["search", "Research Agent", "Deep analysis", "optimal", "Active"],
  ["database", "Memory Agent", "Idle", "standby", "Standby"],
  ["globe", "Browser Agent", "Idle", "standby", "Standby"],
  ["list-checks", "Task Agent", "Idle", "standby", "Standby"],
  ["shield-check", "System Agent", "Monitoring", "optimal", "Active"],
];

const RUNS = [
  ["Research the top 3 STT engines and benchmark latency on my hardware", "13 jun, 1:42 pm", 3, 0],
  ["Draft and validate the Alembic migration to add a due_date column to jarvis_tasks", "12 jun, 8:20 pm", 2, 1],
  ["Summarize this week's admin error reports and propose the top fix", "12 jun, 12:05 am", 2, 0],
  ["Generate release notes for the 2026.6 desktop build and check the MSIX version", "10 jun, 4:48 pm", 2, 0],
];

function AgentCard({ ic, name, role, tone, label }) {
  const c = tone === "optimal" ? "var(--jv-green)" : "var(--jv-violet)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
      <span style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: "var(--r-sm)", display: "grid", placeItems: "center", color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 32%, transparent)` }}><Icon name={ic} size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{name}</div>
        <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 1 }}>{role}</div>
      </div>
      <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: c }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />{label}
      </span>
    </div>
  );
}

function RunRow({ q, ts, ok, err }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", overflow: "hidden" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={15} color="var(--jv-cyan-300)" />
        <span style={{ flex: 1, font: "var(--fw-medium) 13px var(--font-mono)", color: "var(--jv-text-soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{q}</span>
        <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{ts}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, font: "12px var(--font-mono)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--jv-green)" }}><Icon name="check-circle" size={13} />{ok}</span>
          {err > 0 && <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--jv-red)" }}><Icon name="x-circle" size={13} />{err}</span>}
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 14px 43px", display: "flex", flexDirection: "column", gap: 6 }}>
          {[["Research Agent", "web_search · 4 results", "green"], ["Coding Agent", "wrote migration.py · 62 lines", "green"], err > 0 ? ["System Agent", "verification failed · retrying", "red"] : ["Task Agent", "created follow-up task", "green"]].map(([a, d, tone], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, font: "12px/1.5 var(--font-mono)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--jv-${tone})`, boxShadow: `0 0 6px var(--jv-${tone})` }} />
              <span style={{ color: "var(--jv-cyan-300)" }}>{a}</span>
              <span style={{ color: "var(--jv-text-muted)" }}>{d}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ICON_CHOICES = ["bot", "code", "search", "database", "globe", "list-checks", "shield-check", "mail", "calendar", "pen-tool", "bar-chart-3", "terminal"];
const TOOL_CHOICES = ["web_search", "code_interpreter", "filesystem", "github", "memory.query", "calendar", "gmail", "whatsapp", "shell", "vision"];
const MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "groq/llama-3.3-70b", "gemini-2.0-flash"];
const TEAMMATES = ["Coding Agent", "Research Agent", "Memory Agent", "Browser Agent", "Task Agent", "System Agent"];

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>{label}</div>
      {children}
      {hint && <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ padding: "6px 12px", borderRadius: "var(--r-pill)", border: `1px solid ${active ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, background: active ? "var(--grad-cyan-soft)" : "var(--jv-void)", color: active ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", font: `${active ? "var(--fw-semibold)" : "var(--fw-medium)"} 12px var(--font-mono)`, cursor: "pointer" }}>{children}</button>
  );
}

function AgentBuilder({ onClose, onCreate }) {
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [icon, setIcon] = React.useState("bot");
  const [model, setModel] = React.useState(MODELS[0]);
  const [tools, setTools] = React.useState(["web_search"]);
  const [collabs, setCollabs] = React.useState([]);
  const [autonomy, setAutonomy] = React.useState("Ask before acting");
  const [instr, setInstr] = React.useState("");
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const ready = name.trim() && role.trim();
  const inputStyle = { width: "100%", height: 40, padding: "0 14px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-text)", font: "var(--fw-medium) 13px var(--font-body)", outline: "none", boxSizing: "border-box" };

  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 50, display: "grid", placeItems: "start center", paddingTop: 40, paddingBottom: 40, overflowY: "auto", background: "rgba(3,8,16,0.6)", backdropFilter: "blur(6px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 620, maxWidth: "92%", borderRadius: "var(--r-lg)", background: "var(--grad-panel)", border: "1px solid var(--jv-border-cyan)", boxShadow: "var(--panel-shadow-active)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--jv-hairline)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}><Icon name={icon} size={20} /></span>
            <div>
              <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Orchestrate a teammate</div>
              <div style={{ font: "var(--fw-bold) 17px var(--font-body)", color: "var(--jv-text)", marginTop: 2 }}>{name.trim() || "New Agent"}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name="x" size={18} /></button>
        </div>
        {/* body */}
        <div style={{ padding: "20px 20px 4px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field label="Agent name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Finance Agent" style={inputStyle} /></Field>
            <Field label="Role"><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Tracks spend & budgets" style={inputStyle} /></Field>
          </div>
          <Field label="Icon">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ICON_CHOICES.map((ic) => (
                <button key={ic} onClick={() => setIcon(ic)} style={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", cursor: "pointer", color: icon === ic ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", background: icon === ic ? "var(--grad-cyan-soft)" : "var(--jv-void)", border: `1px solid ${icon === ic ? "var(--jv-border-cyan)" : "var(--jv-border)"}` }}><Icon name={ic} size={17} /></button>
              ))}
            </div>
          </Field>
          <Field label="Reasoning model">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{MODELS.map((m) => <Chip key={m} active={model === m} onClick={() => setModel(m)}>{m}</Chip>)}</div>
          </Field>
          <Field label="Tools & skills" hint={`${tools.length} selected — what this agent is allowed to call.`}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{TOOL_CHOICES.map((t) => <Chip key={t} active={tools.includes(t)} onClick={() => toggle(tools, setTools, t)}>{t}</Chip>)}</div>
          </Field>
          <Field label="Collaborates with" hint="Teammates this agent may hand off to in a multi-agent run.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{TEAMMATES.map((t) => <Chip key={t} active={collabs.includes(t)} onClick={() => toggle(collabs, setCollabs, t)}>{t}</Chip>)}</div>
          </Field>
          <Field label="Autonomy">
            <div style={{ display: "flex", gap: 8 }}>{["Ask before acting", "Act, then report", "Fully autonomous"].map((a) => <Chip key={a} active={autonomy === a} onClick={() => setAutonomy(a)}>{a}</Chip>)}</div>
          </Field>
          <Field label="System instructions">
            <textarea value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Describe how this teammate should think and behave…" style={{ ...inputStyle, height: 80, padding: "10px 14px", resize: "vertical", font: "var(--fw-regular) 13px/1.5 var(--font-body)" }} />
          </Field>
        </div>
        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", borderTop: "1px solid var(--jv-hairline)" }}>
          <span style={{ font: "11px var(--font-mono)", color: "var(--jv-text-faint)" }}>{ready ? "Ready to deploy" : "Name and role required"}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={<Icon name="rocket" size={14} />} onClick={() => ready && onCreate({ icon, name: name.trim(), role: role.trim() })}>Deploy Agent</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Agents() {
  const [building, setBuilding] = React.useState(false);
  const [roster, setRoster] = React.useState(ROSTER);
  const create = (a) => { setRoster((r) => [...r, [a.icon, a.name, a.role, "standby", "Standby"]]); setBuilding(false); };
  return (
    <React.Fragment>
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel title="Agent Roster" eyebrow action={<button onClick={() => setBuilding(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border-cyan)", background: "var(--grad-cyan-soft)", color: "var(--jv-cyan-300)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="plus" size={13} />New Agent</button>} bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {roster.map((r, i) => <AgentCard key={i} ic={r[0]} name={r[1]} role={r[2]} tone={r[3]} label={r[4]} />)}
        </Panel>
        <Panel title="Runtime" eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <StatTile value={3} label="Active" tone="optimal" />
            <StatTile value={4} label="Recent runs" tone="info" />
            <StatTile value={11} label="Steps today" tone="info" />
            <StatTile value={1} label="Errors" tone="critical" />
          </div>
        </Panel>
      </div>

      <Panel title="Multi-agent Executions" action={<span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>4 recent</span>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {RUNS.map((r, i) => <RunRow key={i} q={r[0]} ts={r[1]} ok={r[2]} err={r[3]} />)}
        </div>
      </Panel>
    </div>
    {building && <AgentBuilder onClose={() => setBuilding(false)} onCreate={create} />}
    </React.Fragment>
  );
}

Object.assign(window, { Agents });
})();
