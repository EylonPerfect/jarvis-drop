// Memory — the vector store status, session cost breakdown, recent conversations,
// and the Personal Intelligence profile (core facts + style profiles).
import { useState } from "react";
import { Panel, Icon, EmptyState, Button, Input, IconButton, ConfirmDialog } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
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
  const { data: facts, reload: reloadFacts } = useApi<FactsResponse>("/api/memory/facts");

  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [confidence, setConfidence] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const submitAdd = async () => {
    const l = label.trim(), v = value.trim();
    if (!l || !v || saving) return;
    setSaving(true);
    try {
      const conf = confidence.trim() === "" ? undefined : Number(confidence);
      await api.post("/api/memory/facts", { label: l, value: v, confidence: conf });
      setLabel("");
      setValue("");
      setConfidence("");
      setAdding(false);
      reloadFacts();
    } catch {
      /* gateway may be offline — leave the form open */
    } finally {
      setSaving(false);
    }
  };

  const removeFact = async (id: string) => {
    try {
      await api.del(`/api/memory/facts/${id}`);
      reloadFacts();
    } catch {
      /* ignore */
    }
  };

  const clearFacts = async () => {
    setClearing(true);
    try {
      await api.del("/api/memory/facts");
      reloadFacts();
    } catch {
      /* ignore */
    } finally {
      setClearing(false);
      setClearOpen(false);
    }
  };

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
      <Panel
        title="Personal Intelligence"
        eyebrow
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />} onClick={() => setAdding((v) => !v)}>Add memory</Button>
            {coreFacts.length > 0 && (
              <Button size="sm" variant="danger" icon={<Icon name="trash-2" size={13} />} onClick={() => setClearOpen(true)}>Clear all</Button>
            )}
            <Icon name="sparkles" size={16} color="var(--jv-violet)" />
          </div>
        }
      >
        {piEmpty && !adding ? (
          <EmptyState
            icon="sparkles"
            title="No profile yet"
            hint="Your Personal Intelligence profile — core facts and style — builds as you use JARVIS."
            action={<Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />} onClick={() => setAdding(true)}>Add memory</Button>}
          />
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
                  {adding && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)" }}>
                      <div style={{ flex: "1 1 120px" }}>
                        <Input placeholder="Label (e.g. Role)" value={label} autoFocus onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAdd()} />
                      </div>
                      <div style={{ flex: "2 1 160px" }}>
                        <Input placeholder="Fact (e.g. Founder)" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAdd()} />
                      </div>
                      <div style={{ flex: "0 0 80px" }}>
                        <Input placeholder="Conf %" value={confidence} onChange={(e) => setConfidence(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAdd()} />
                      </div>
                      <div style={{ display: "flex", gap: 8, flex: "1 1 auto", justifyContent: "flex-end" }}>
                        <Button size="sm" variant="primary" disabled={!label.trim() || !value.trim() || saving} onClick={submitAdd}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                  {coreFacts.map((f, i) => (
                    <div key={f.id ?? i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{f.label}</div>
                        <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{f.value}</div>
                      </div>
                      <Ring pct={f.confidence} />
                      <IconButton icon="trash-2" tone="danger" title="Delete" onClick={() => removeFact(f.id)} />
                    </div>
                  ))}
                  {coreFacts.length === 0 && !adding && (
                    <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)" }}>No core facts yet.</div>
                  )}
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

      <ConfirmDialog
        open={clearOpen}
        danger
        title="Clear all memory facts?"
        message="This permanently removes every core fact from your Personal Intelligence profile. This cannot be undone."
        confirmLabel="Clear all"
        busy={clearing}
        onConfirm={clearFacts}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}
