// Memory — the vector store status, session cost breakdown, recent conversations,
// and the Personal Intelligence profile (core facts + style profiles).
import { Panel, Icon } from "../ds";
import { useApi } from "../api/hooks";
import type {
  VectorStoreStatus,
  SessionCost,
  MemoryFact,
  StyleProfile,
  Conversation,
} from "@jarvis/shared";

const VECTOR_STORE_SEED: VectorStoreStatus = {
  status: "Ready",
  online: true,
  items: 3380,
  detail: "pgvector · 768-dim · 3,380 memories across 42 conversations",
};

const COST_SEED: SessionCost = {
  total: "$0.7421",
  entries: [
    { provider: "anthropic", cost: "$0.6112", tokens: "22,140 tok" },
    { provider: "groq", cost: "$0.0934", tokens: "12,880 tok" },
    { provider: "openai", cost: "$0.0375", tokens: "3,430 tok" },
  ],
};

const CONVOS_SEED: Conversation[] = [
  { id: "1", title: "Command Center V1 design pass", date: "13 Jun" },
  { id: "2", title: "Voice pipeline latency debugging", date: "13 Jun" },
  { id: "3", title: "MSIX Store submission checklist", date: "12 Jun" },
  { id: "4", title: "Refactor loop.py god object", date: "12 Jun" },
  { id: "5", title: "pgvector migration plan", date: "11 Jun" },
  { id: "6", title: "Q3 roadmap brainstorm", date: "11 Jun" },
  { id: "7", title: "Hubstaff integration spec", date: "10 Jun" },
  { id: "8", title: "Onboarding wizard copy review", date: "10 Jun" },
  { id: "9", title: "Accessibility audit of the HUD", date: "09 Jun" },
  { id: "10", title: "Email verification failover chain", date: "09 Jun" },
];

interface MemoryProfile {
  prose: string;
  interactions: number;
  chunks: number;
  tokens: number;
  coreFactsCount: number;
  styleCount: number;
}

interface FactsResponse {
  facts: MemoryFact[];
  styles: StyleProfile[];
  profile: MemoryProfile;
}

const FACTS_SEED: FactsResponse = {
  facts: [
    { id: "1", label: "Role", value: "Founder-engineer building the Jarvis assistant", confidence: 98 },
    { id: "2", label: "Location", value: "Bhimber, Azad Kashmir, Pakistan", confidence: 96 },
    { id: "3", label: "Timezone", value: "Asia/Karachi (UTC+5)", confidence: 95 },
    { id: "4", label: "Focus", value: "Command Center V1 + cascading voice interface", confidence: 92 },
  ],
  styles: [
    { id: "1", name: "engineering", stats: "formality 0.62 · vocab 0.71 · emoji 0.02", msgs: "684 msgs" },
    { id: "2", name: "design", stats: "formality 0.48 · vocab 0.66 · emoji 0.04", msgs: "312 msgs" },
    { id: "3", name: "planning", stats: "formality 0.55 · vocab 0.69 · emoji 0.01", msgs: "198 msgs" },
  ],
  profile: {
    prose:
      "You are a hands-on founder-engineer building Jarvis, a local-first AI assistant for Windows. You think like a 30-year senior architect: you value honest, direct recommendations over agreement, and you push for enterprise-grade structure (strict line caps, Alembic migrations, layered modules). Your current focus is the Command Center V1 design pass and the cascading voice interface.",
    interactions: 1342,
    chunks: 287,
    tokens: 41280,
    coreFactsCount: 10,
    styleCount: 5,
  },
};

function Ring({ pct }: { pct: number }) {
  const r = 15, c = 2 * Math.PI * r;
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" style={{ flex: "0 0 38px" }}>
      <circle cx="19" cy="19" r={r} fill="none" stroke="var(--jv-surface-3)" strokeWidth="3" />
      <circle cx="19" cy="19" r={r} fill="none" stroke="var(--jv-green)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${c * pct / 100} ${c}`} transform="rotate(-90 19 19)" style={{ filter: "drop-shadow(0 0 3px var(--jv-glow-green))" }} />
      <text x="19" y="22" textAnchor="middle" style={{ font: "var(--fw-bold) 9px var(--font-mono)", fill: "var(--jv-green)" }}>{pct}%</text>
    </svg>
  );
}

export default function Memory() {
  const vs = useApi<VectorStoreStatus>("/api/memory/vector-store").data ?? VECTOR_STORE_SEED;
  const cost = useApi<SessionCost>("/api/memory/cost").data ?? COST_SEED;
  const convos = useApi<Conversation[]>("/api/memory/conversations").data ?? CONVOS_SEED;
  const facts = useApi<FactsResponse>("/api/memory/facts").data ?? FACTS_SEED;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* top row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Panel title="Vector store" brackets>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ padding: 14, borderRadius: "var(--r-md)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Status</div>
              <div style={{ font: "var(--fw-bold) 22px var(--font-display)", color: "var(--jv-text)", margin: "4px 0 3px" }}>{vs.status}</div>
              {vs.online && <div style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-green)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--jv-green)", boxShadow: "0 0 6px var(--jv-green)" }} />Online</div>}
            </div>
            <div style={{ padding: 14, borderRadius: "var(--r-md)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Items</div>
              <div style={{ font: "var(--fw-bold) 22px var(--font-display)", color: "var(--jv-cyan-300)", marginTop: 4, textShadow: "var(--glow-cyan)" }}>{vs.items.toLocaleString()}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{vs.detail}</div>
        </Panel>

        <Panel title="Session cost" action={<span style={{ font: "var(--fw-bold) 16px var(--font-mono)", color: "var(--jv-cyan-300)" }}>{cost.total}</span>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {cost.entries.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < cost.entries.length - 1 ? "1px solid var(--jv-hairline)" : "none" }}>
                <span style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{r.provider}</span>
                <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{r.cost} · {r.tokens}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* recent conversations */}
      <Panel title="Recent conversations" action={<span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-cyan-300)" }}>{convos.length} total</span>}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {convos.map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 4px", borderBottom: i < convos.length - 1 ? "1px solid var(--jv-hairline)" : "none" }}>
              <span style={{ font: "var(--fw-medium) 13px var(--font-body)", color: "var(--jv-text-soft)" }}>{c.title}</span>
              <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>{c.date}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* personal intelligence */}
      <Panel title="Personal Intelligence" eyebrow action={<Icon name="sparkles" size={16} color="var(--jv-violet)" />}>
        <p style={{ margin: "0 0 12px", font: "var(--fw-regular) 13px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>{facts.profile.prose}</p>
        <div style={{ display: "flex", gap: 18, font: "12px var(--font-mono)", color: "var(--jv-text-muted)", marginBottom: 16 }}>
          <span>{facts.profile.interactions} interactions</span><span>{facts.profile.chunks} chunks</span><span>{facts.profile.tokens} tokens</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 10 }}>Core facts · {facts.profile.coreFactsCount}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {facts.facts.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{f.label}</div>
                    <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{f.value}</div>
                  </div>
                  <Ring pct={f.confidence} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 10 }}>Style profiles · {facts.profile.styleCount}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {facts.styles.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                  <div>
                    <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{s.name}</div>
                    <div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 2 }}>{s.stats}</div>
                  </div>
                  <span style={{ font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>{s.msgs}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
