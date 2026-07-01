// Conversations — the chat surface: searchable conversation list, an empty
// "How can I assist you?" state with mode cards, a live thread, and a composer.
(function () {
const { Icon, Input } = window.JARVISDesignSystem_547efc;

const LIST = [
  "Command Center V1 design pass", "Voice pipeline latency debugging", "MSIX Store submission checklist",
  "Refactor loop.py god object", "pgvector migration plan", "Q3 roadmap brainstorm",
  "Hubstaff integration spec", "Onboarding wizard copy review", "Accessibility audit of the HUD",
  "Email verification failover chain", "Trial + license enforcement design", "Architecture audit follow-ups",
];

const MODES = [
  ["code", "Compose", "Write and create", "var(--jv-cyan)"],
  ["search", "Research", "Deep analysis", "var(--jv-violet)"],
  ["workflow", "Execute", "Run and automate", "var(--jv-green)"],
  ["bug", "Debug", "Fix and optimize", "var(--jv-amber)"],
  ["sparkles", "Brainstorm", "Ideas and strategy", "var(--jv-magenta)"],
];

const REPLIES = {
  Compose: "Drafting now — I'll structure it in three sections and surface it in the Compose panel.",
  Research: "Running a deep pass across your sources. I'll cite the top findings with latency notes.",
  Execute: "Queuing the workflow. I'll report each tool call in the Live Action Ledger as it runs.",
  Debug: "Reproducing the issue against the last known-good build. Isolating the failing module now.",
  Brainstorm: "Here are three angles to explore — I'll rank them by effort vs. impact.",
  default: "Understood, Commander. Working on it — I'll keep the reasoning visible as I go.",
};

function ModeCard({ ic, name, sub, color, active, onClick }) {
  return (
    <button onClick={onClick} style={{ flex: 1, minWidth: 130, textAlign: "left", padding: "14px 15px", borderRadius: "var(--r-md)", background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : "var(--jv-surface-2)", border: `1px solid ${active ? color : "var(--jv-border-soft)"}`, cursor: "pointer", boxShadow: active ? `0 0 18px color-mix(in srgb, ${color} 40%, transparent)` : "none", transition: "all .15s" }}>
      <span style={{ color, display: "inline-flex", marginBottom: 10 }}><Icon name={ic} size={20} /></span>
      <div style={{ font: "var(--fw-bold) 14px var(--font-body)", color: "var(--jv-text)" }}>{name}</div>
      <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{sub}</div>
    </button>
  );
}

function Conversations() {
  const [sel, setSel] = React.useState(null);
  const [mode, setMode] = React.useState(null);
  const [draft, setDraft] = React.useState("");
  const [thread, setThread] = React.useState([]);
  const endRef = React.useRef(null);
  React.useEffect(() => { if (endRef.current) endRef.current.parentNode.scrollTop = endRef.current.parentNode.scrollHeight; }, [thread]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const reply = REPLIES[mode] || REPLIES.default;
    setThread((t) => [...t, { who: "you", text }, { who: "jarvis", text: reply }]);
    setDraft("");
  };

  const hasThread = thread.length > 0 || sel !== null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, height: "100%", minHeight: 0 }}>
      {/* list */}
      <div style={{ display: "flex", flexDirection: "column", background: "var(--grad-panel)", borderRadius: "var(--r-md)", border: "1px solid var(--jv-border)", boxShadow: "var(--panel-shadow)", overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 8, padding: 12, borderBottom: "1px solid var(--jv-hairline)" }}>
          <div style={{ flex: 1 }}><Input icon={<Icon name="search" size={15} />} placeholder="Search conversations" /></div>
          <button style={{ width: 38, flex: "0 0 38px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", color: "var(--jv-cyan-300)", cursor: "pointer" }} onClick={() => { setSel(null); setThread([]); }}><Icon name="plus" size={17} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {LIST.map((c, i) => (
            <button key={i} onClick={() => { setSel(i); setThread([{ who: "jarvis", text: "Reopened \u201c" + c + "\u201d. Where would you like to pick up?" }]); }} style={{ width: "100%", textAlign: "left", padding: "11px 16px", background: sel === i ? "var(--grad-cyan-soft)" : "none", borderLeft: sel === i ? "2px solid var(--jv-cyan)" : "2px solid transparent", border: "none", borderBottom: "1px solid var(--jv-hairline)", cursor: "pointer", font: "var(--fw-medium) 12.5px var(--font-body)", color: sel === i ? "var(--jv-text)" : "var(--jv-text-soft)" }}>{c}</button>
          ))}
        </div>
      </div>

      {/* main */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
        <div style={{ flex: 1, overflowY: "auto", padding: hasThread ? "8px 8px 16px" : 0 }}>
          {!hasThread ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ font: "var(--fw-semibold) 26px var(--font-body)", color: "var(--jv-text)" }}>How can I assist you?</div>
              <div style={{ font: "var(--fw-regular) 13px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 6 }}>Pick a mode or just type your question below.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760, margin: "0 auto" }}>
              {thread.map((m, i) => m.who === "you" ? (
                <div key={i} style={{ alignSelf: "flex-end", maxWidth: "78%", padding: "10px 14px", borderRadius: "12px 12px 3px 12px", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", font: "var(--fw-medium) 13px/1.5 var(--font-body)", color: "var(--jv-text)" }}>{m.text}</div>
              ) : (
                <div key={i} style={{ alignSelf: "flex-start", maxWidth: "84%", display: "flex", gap: 10 }}>
                  <span style={{ flex: "0 0 28px", width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)", color: "var(--jv-cyan)" }}><Icon name="sparkles" size={14} /></span>
                  <div style={{ padding: "10px 14px", borderRadius: "12px 12px 12px 3px", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", font: "var(--fw-regular) 13px/1.55 var(--font-body)", color: "var(--jv-text-soft)" }}>{m.text}</div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {/* modes + composer */}
        <div style={{ paddingTop: 12 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 12, justifyContent: hasThread ? "flex-start" : "center", flexWrap: "wrap" }}>
            {MODES.map((m) => <ModeCard key={m[1]} ic={m[0]} name={m[1]} sub={m[2]} color={m[3]} active={mode === m[1]} onClick={() => setMode((v) => v === m[1] ? null : m[1])} />)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 8px 16px", borderRadius: "var(--r-md)", background: "var(--jv-void)", border: "1px solid var(--jv-border-cyan)", boxShadow: "0 0 20px rgba(41,211,245,0.08)" }}>
            {mode && <span style={{ padding: "4px 9px", borderRadius: "var(--r-pill)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-cyan-300)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", whiteSpace: "nowrap" }}>{mode}</span>}
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Type / for commands, or ask anything…" style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--jv-text)", font: "var(--fw-medium) 13.5px var(--font-body)" }} />
            <button onClick={send} style={{ width: 38, height: 38, flex: "0 0 38px", display: "grid", placeItems: "center", borderRadius: "50%", background: draft.trim() ? "var(--jv-cyan)" : "var(--jv-surface-3)", border: "none", color: draft.trim() ? "var(--accent-contrast)" : "var(--jv-text-muted)", cursor: "pointer", boxShadow: draft.trim() ? "var(--glow-cyan)" : "none" }}><Icon name="arrow-up" size={18} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Conversations });
})();
