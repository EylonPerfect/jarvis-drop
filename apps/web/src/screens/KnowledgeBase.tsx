// KnowledgeBase — indexed sources & collections feeding the vector store, with a
// constellation-style relationship map. Designed to the JARVIS HUD system.
import { Panel, Badge, Button, Input, Icon, StatTile } from "../ds";
import { useApi } from "../api/hooks";
import type { KnowledgeSource, Collection } from "@jarvis/shared";

const SOURCES: KnowledgeSource[] = [
  { id: "s1", icon: "file-text", title: "Product spec — Command Center V1", kind: "Markdown", chunks: 42, status: "indexed" },
  { id: "s2", icon: "github", title: "jarvis-core repository", kind: "Codebase · 1,204 files", chunks: 1204, status: "indexed" },
  { id: "s3", icon: "book-open", title: "Electron + MSIX packaging docs", kind: "Web · 18 pages", chunks: 18, status: "indexed" },
  { id: "s4", icon: "database", title: "pgvector operations runbook", kind: "Markdown", chunks: 9, status: "indexed" },
  { id: "s5", icon: "file-text", title: "Q3 roadmap & OKRs", kind: "Doc", chunks: 6, status: "indexing" },
  { id: "s6", icon: "message-square", title: "Support transcripts (last 30d)", kind: "Conversations", chunks: 214, status: "indexed" },
];
const COLLECTIONS: Collection[] = [
  { id: "c1", name: "Engineering", count: 3, color: "var(--jv-cyan)" },
  { id: "c2", name: "Design", count: 2, color: "var(--jv-violet)" },
  { id: "c3", name: "Operations", count: 2, color: "var(--jv-green)" },
  { id: "c4", name: "Product", count: 4, color: "var(--jv-amber)" },
];
const STATS = { sources: 6, chunks: "1.4k", collections: 4, indexing: 1 };

function ConstellationMap() {
  const nodes = [[60, 40], [140, 70], [110, 130], [200, 45], [250, 110], [190, 150], [300, 70], [330, 140], [70, 150]];
  const edges = [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [3, 6], [6, 7], [4, 7], [2, 8], [5, 4]];
  return (
    <svg viewBox="0 0 380 190" style={{ width: "100%", height: 190 }}>
      {edges.map(([a, b], i) => <line key={i} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke="var(--jv-cyan)" strokeOpacity="0.25" strokeWidth="1" />)}
      {nodes.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={i % 3 === 0 ? 5 : 3.2} fill="var(--jv-cyan)" style={{ filter: "drop-shadow(0 0 5px var(--jv-glow-cyan))" }} />
          <circle cx={x} cy={y} r={i % 3 === 0 ? 10 : 6} fill="none" stroke="var(--jv-cyan)" strokeOpacity="0.2" />
        </g>
      ))}
    </svg>
  );
}

export default function KnowledgeBase() {
  const { data: sourcesData } = useApi<KnowledgeSource[]>("/api/knowledge/sources");
  const { data: collectionsData } = useApi<Collection[]>("/api/knowledge/collections");
  const { data: statsData } = useApi<{ sources: number; chunks: string; collections: number; indexing: number }>("/api/knowledge/stats");

  const sources = sourcesData ?? SOURCES;
  const collections = collectionsData ?? COLLECTIONS;
  const stats = statsData ?? STATS;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
      <Panel title="Knowledge Sources" action={<div style={{ display: "flex", gap: 8 }}><div style={{ width: 200 }}><Input icon={<Icon name="search" size={14} />} placeholder="Search sources…" /></div><Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />}>Add source</Button></div>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sources.map((s) => {
            const indexing = s.status === "indexing";
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <span style={{ width: 36, height: 36, flex: "0 0 36px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name={s.icon} size={17} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{s.title}</div>
                  <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{s.kind}</div>
                </div>
                <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-faint)" }}>{s.chunks.toLocaleString()} chunks</span>
                <Badge status={indexing ? "warn" : "optimal"}>{indexing ? "Indexing" : "Indexed"}</Badge>
              </div>
            );
          })}
        </div>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel title="Index" eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <StatTile value={stats.sources} label="Sources" tone="info" />
            <StatTile value={stats.chunks} label="Chunks" tone="optimal" />
            <StatTile value={stats.collections} label="Collections" tone="standby" />
            <StatTile value={stats.indexing} label="Indexing" tone="warn" />
          </div>
        </Panel>
        <Panel title="Relationship map" eyebrow>
          <ConstellationMap />
        </Panel>
        <Panel title="Collections" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {collections.map((col) => (
            <div key={col.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9, font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: col.color, boxShadow: `0 0 6px ${col.color}` }} />{col.name}</span>
              <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{col.count} sources</span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
