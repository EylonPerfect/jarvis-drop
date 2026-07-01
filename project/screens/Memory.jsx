// Memory — the vector store status, session cost breakdown, recent conversations,
// and the Personal Intelligence profile (core facts + style profiles).
(function () {
const { Panel, Icon } = window.JARVISDesignSystem_547efc;

const CONVOS = [
  ["Command Center V1 design pass", "13 Jun"], ["Voice pipeline latency debugging", "13 Jun"],
  ["MSIX Store submission checklist", "12 Jun"], ["Refactor loop.py god object", "12 Jun"],
  ["pgvector migration plan", "11 Jun"], ["Q3 roadmap brainstorm", "11 Jun"],
  ["Hubstaff integration spec", "10 Jun"], ["Onboarding wizard copy review", "10 Jun"],
  ["Accessibility audit of the HUD", "09 Jun"], ["Email verification failover chain", "09 Jun"],
];

const FACTS = [
  ["Role", "Founder-engineer building the Jarvis assistant", 98],
  ["Location", "Bhimber, Azad Kashmir, Pakistan", 96],
  ["Timezone", "Asia/Karachi (UTC+5)", 95],
  ["Focus", "Command Center V1 + cascading voice interface", 92],
];
const STYLES = [
  ["engineering", "formality 0.62 · vocab 0.71 · emoji 0.02", "684 msgs"],
  ["design", "formality 0.48 · vocab 0.66 · emoji 0.04", "312 msgs"],
  ["planning", "formality 0.55 · vocab 0.69 · emoji 0.01", "198 msgs"],
];

function Ring({ pct }) {
  const r = 15, c = 2 * Math.PI * r;
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" style={{ flex: "0 0 38px" }}>
      <circle cx="19" cy="19" r={r} fill="none" stroke="var(--jv-surface-3)" strokeWidth="3" />
      <circle cx="19" cy="19" r={r} fill="none" stroke="var(--jv-green)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${c * pct / 100} ${c}`} transform="rotate(-90 19 19)" style={{ filter: "drop-shadow(0 0 3px var(--jv-glow-green))" }} />
      <text x="19" y="22" textAnchor="middle" style={{ font: "var(--fw-bold) 9px var(--font-mono)", fill: "var(--jv-green)" }}>{pct}%</text>
    </svg>
  );
}

function Memory() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* top row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Panel title="Vector store" brackets>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ padding: 14, borderRadius: "var(--r-md)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Status</div>
              <div style={{ font: "var(--fw-bold) 22px var(--font-display)", color: "var(--jv-text)", margin: "4px 0 3px" }}>Ready</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-green)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--jv-green)", boxShadow: "0 0 6px var(--jv-green)" }} />Online</div>
            </div>
            <div style={{ padding: 14, borderRadius: "var(--r-md)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Items</div>
              <div style={{ font: "var(--fw-bold) 22px var(--font-display)", color: "var(--jv-cyan-300)", marginTop: 4, textShadow: "var(--glow-cyan)" }}>3,380</div>
            </div>
          </div>
          <div style={{ marginTop: 12, font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>pgvector · 768-dim · 3,380 memories across 42 conversations</div>
        </Panel>

        <Panel title="Session cost" action={<span style={{ font: "var(--fw-bold) 16px var(--font-mono)", color: "var(--jv-cyan-300)" }}>$0.7421</span>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {[["anthropic", "$0.6112", "22,140 tok"], ["groq", "$0.0934", "12,880 tok"], ["openai", "$0.0375", "3,430 tok"]].map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < 2 ? "1px solid var(--jv-hairline)" : "none" }}>
                <span style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{r[0]}</span>
                <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{r[1]} · {r[2]}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* recent conversations */}
      <Panel title="Recent conversations" action={<span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-cyan-300)" }}>12 total</span>}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {CONVOS.map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 4px", borderBottom: i < CONVOS.length - 1 ? "1px solid var(--jv-hairline)" : "none" }}>
              <span style={{ font: "var(--fw-medium) 13px var(--font-body)", color: "var(--jv-text-soft)" }}>{c[0]}</span>
              <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>{c[1]}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* personal intelligence */}
      <Panel title="Personal Intelligence" eyebrow action={<Icon name="sparkles" size={16} color="var(--jv-violet)" />}>
        <p style={{ margin: "0 0 12px", font: "var(--fw-regular) 13px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>You are a hands-on founder-engineer building Jarvis, a local-first AI assistant for Windows. You think like a 30-year senior architect: you value honest, direct recommendations over agreement, and you push for enterprise-grade structure (strict line caps, Alembic migrations, layered modules). Your current focus is the Command Center V1 design pass and the cascading voice interface.</p>
        <div style={{ display: "flex", gap: 18, font: "12px var(--font-mono)", color: "var(--jv-text-muted)", marginBottom: 16 }}>
          <span>1342 interactions</span><span>287 chunks</span><span>41280 tokens</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 10 }}>Core facts · 10</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {FACTS.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{f[0]}</div>
                    <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{f[1]}</div>
                  </div>
                  <Ring pct={f[2]} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 10 }}>Style profiles · 5</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {STYLES.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                  <div>
                    <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{s[0]}</div>
                    <div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 2 }}>{s[1]}</div>
                  </div>
                  <span style={{ font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>{s[2]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

Object.assign(window, { Memory });
})();
