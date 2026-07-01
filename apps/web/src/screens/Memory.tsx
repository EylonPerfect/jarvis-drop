// Memory — the vector store status, session cost breakdown, recent conversations,
// and the Personal Intelligence profile (core facts + style profiles).
import { Panel, Icon, EmptyState } from "../ds";
import { useApi } from "../api/hooks";
import type {
  VectorStoreStatus,
  SessionCost,
  MemoryFact,
  StyleProfile,
  Conversation,
} from "@jarvis/shared";

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
  const vs = useApi<VectorStoreStatus>("/api/memory/vector-store").data;
  const cost = useApi<SessionCost>("/api/memory/cost").data;
  const convos = useApi<Conversation[]>("/api/memory/conversations").data ?? [];
  const facts = useApi<FactsResponse>("/api/memory/facts").data;

  const vsEmpty = !vs || vs.items === 0;
  const costTotal = cost?.total ?? "$0";
  const costEntries = cost?.entries ?? [];

  const profile = facts?.profile ?? null;
  const coreFacts = facts?.facts ?? [];
  const styles = facts?.styles ?? [];
  const piEmpty = !profile?.prose && coreFacts.length === 0 && styles.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* top row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Panel title="Vector store" brackets>
          {vsEmpty ? (
            <EmptyState
              compact
              icon="database"
              title="0 memories"
              hint="Your vector store is empty. Memory builds as you use JARVIS."
            />
          ) : (
            <>
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
            </>
          )}
        </Panel>

        <Panel title="Session cost" action={<span style={{ font: "var(--fw-bold) 16px var(--font-mono)", color: "var(--jv-cyan-300)" }}>{costTotal}</span>}>
          {costEntries.length === 0 ? (
            <EmptyState compact icon="dollar-sign" title="No cost yet" hint="Provider spend appears here once JARVIS starts making calls." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {costEntries.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < costEntries.length - 1 ? "1px solid var(--jv-hairline)" : "none" }}>
                  <span style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{r.provider}</span>
                  <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{r.cost} · {r.tokens}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* recent conversations */}
      <Panel title="Recent conversations" action={<span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-cyan-300)" }}>{convos.length} total</span>}>
        {convos.length === 0 ? (
          <EmptyState compact icon="message-square" title="No conversations yet" hint="Your recent conversations with JARVIS will show up here." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {convos.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 4px", borderBottom: i < convos.length - 1 ? "1px solid var(--jv-hairline)" : "none" }}>
                <span style={{ font: "var(--fw-medium) 13px var(--font-body)", color: "var(--jv-text-soft)" }}>{c.title}</span>
                <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>{c.date}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* personal intelligence */}
      <Panel title="Personal Intelligence" eyebrow action={<Icon name="sparkles" size={16} color="var(--jv-violet)" />}>
        {piEmpty ? (
          <EmptyState icon="sparkles" title="No profile yet" hint="Your Personal Intelligence profile — core facts and style — builds as you use JARVIS." />
        ) : (
          <>
            {profile?.prose && <p style={{ margin: "0 0 12px", font: "var(--fw-regular) 13px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>{profile.prose}</p>}
            <div style={{ display: "flex", gap: 18, font: "12px var(--font-mono)", color: "var(--jv-text-muted)", marginBottom: 16 }}>
              <span>{profile?.interactions ?? 0} interactions</span><span>{profile?.chunks ?? 0} chunks</span><span>{profile?.tokens ?? 0} tokens</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 10 }}>Core facts · {profile?.coreFactsCount ?? coreFacts.length}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {coreFacts.map((f, i) => (
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
                <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 10 }}>Style profiles · {profile?.styleCount ?? styles.length}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {styles.map((s, i) => (
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
          </>
        )}
      </Panel>
    </div>
  );
}
