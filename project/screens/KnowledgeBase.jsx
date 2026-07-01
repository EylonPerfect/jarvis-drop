// KnowledgeBase — indexed sources & collections feeding the vector store, with a
// constellation-style relationship map. Designed to the JARVIS HUD system.
(function () {
const { Panel, Badge, Button, Input, Icon, StatTile } = window.JARVISDesignSystem_547efc;

const SOURCES = [
  ["file-text", "Product spec — Command Center V1", "Markdown", 42, "indexed"],
  ["github", "jarvis-core repository", "Codebase · 1,204 files", 1204, "indexed"],
  ["book-open", "Electron + MSIX packaging docs", "Web · 18 pages", 18, "indexed"],
  ["database", "pgvector operations runbook", "Markdown", 9, "indexed"],
  ["file-text", "Q3 roadmap & OKRs", "Doc", 6, "indexing"],
  ["message-square", "Support transcripts (last 30d)", "Conversations", 214, "indexed"],
];
const COLLECTIONS = [
  ["Engineering", 3, "var(--jv-cyan)"], ["Design", 2, "var(--jv-violet)"],
  ["Operations", 2, "var(--jv-green)"], ["Product", 4, "var(--jv-amber)"],
];

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

function KnowledgeBase() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
      <Panel title="Knowledge Sources" action={<div style={{ display: "flex", gap: 8 }}><div style={{ width: 200 }}><Input icon={<Icon name="search" size={14} />} placeholder="Search sources…" /></div><Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />}>Add source</Button></div>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SOURCES.map((s, i) => {
            const indexing = s[4] === "indexing";
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <span style={{ width: 36, height: 36, flex: "0 0 36px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name={s[0]} size={17} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{s[1]}</div>
                  <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{s[2]}</div>
                </div>
                <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-faint)" }}>{s[3].toLocaleString()} chunks</span>
                <Badge status={indexing ? "warn" : "optimal"}>{indexing ? "Indexing" : "Indexed"}</Badge>
              </div>
            );
          })}
        </div>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel title="Index" eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <StatTile value={6} label="Sources" tone="info" />
            <StatTile value="1.4k" label="Chunks" tone="optimal" />
            <StatTile value={4} label="Collections" tone="standby" />
            <StatTile value={1} label="Indexing" tone="warn" />
          </div>
        </Panel>
        <Panel title="Relationship map" eyebrow>
          <ConstellationMap />
        </Panel>
        <Panel title="Collections" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {COLLECTIONS.map(([n, c, col]) => (
            <div key={n} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9, font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: col, boxShadow: `0 0 6px ${col}` }} />{n}</span>
              <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{c} sources</span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

Object.assign(window, { KnowledgeBase });
})();
