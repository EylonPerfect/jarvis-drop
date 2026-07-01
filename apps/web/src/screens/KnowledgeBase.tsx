// KnowledgeBase — indexed sources & collections feeding the vector store.
// Designed to the JARVIS HUD system. All data comes from the backend; the
// screen renders empty states on a clean database and never fabricates records.
import { useState } from "react";
import { Panel, Badge, Button, Input, Icon, StatTile, EmptyState, IconButton, ConfirmDialog } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { KnowledgeSource, Collection } from "@jarvis/shared";

interface KnowledgeStats { sources: number; chunks: number | string; collections: number; indexing: number; }
const ZERO_STATS: KnowledgeStats = { sources: 0, chunks: 0, collections: 0, indexing: 0 };

export default function KnowledgeBase() {
  const { data: sourcesData, reload: reloadSources } = useApi<KnowledgeSource[]>("/api/knowledge/sources");
  const { data: collectionsData } = useApi<Collection[]>("/api/knowledge/collections");
  const { data: statsData } = useApi<KnowledgeStats>("/api/knowledge/stats");

  const sources = sourcesData ?? [];
  const collections = collectionsData ?? [];
  const stats = statsData ?? ZERO_STATS;

  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = q ? sources.filter((s) => s.title.toLowerCase().includes(q) || s.kind.toLowerCase().includes(q)) : sources;

  const submitAdd = async () => {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      await api.post("/api/knowledge/sources", { title: t, kind: kind.trim() || "Document", icon: "file-text" });
      setTitle("");
      setKind("");
      setAdding(false);
      reloadSources();
    } catch {
      /* gateway may be offline — leave the form open */
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.del(`/api/knowledge/sources/${id}`);
      reloadSources();
    } catch {
      /* ignore */
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await api.del("/api/knowledge/sources");
      reloadSources();
    } catch {
      /* ignore */
    } finally {
      setClearing(false);
      setClearOpen(false);
    }
  };

  const headerAction = (
    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ width: 200 }}>
        <Input icon={<Icon name="search" size={14} />} placeholder="Search sources…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />} onClick={() => setAdding((v) => !v)}>Add source</Button>
      {sources.length > 0 && (
        <Button size="sm" variant="danger" icon={<Icon name="trash-2" size={13} />} onClick={() => setClearOpen(true)}>Clear all</Button>
      )}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
      <Panel title="Knowledge Sources" action={headerAction}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {adding && (
            <div style={{ display: "flex", gap: 8, padding: "12px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)" }}>
              <div style={{ flex: 1 }}>
                <Input placeholder="Source title" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAdd()} />
              </div>
              <div style={{ width: 160 }}>
                <Input placeholder="Kind (e.g. Markdown)" value={kind} onChange={(e) => setKind(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAdd()} />
              </div>
              <Button size="sm" variant="primary" disabled={!title.trim() || saving} onClick={submitAdd}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          )}

          {sources.length === 0 && !adding ? (
            <EmptyState
              icon="database"
              title="No knowledge sources yet"
              hint="Index documents, repositories, or conversations to power retrieval. Add your first source to get started."
              action={<Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />} onClick={() => setAdding(true)}>Add source</Button>}
            />
          ) : filtered.length === 0 && sources.length > 0 ? (
            <EmptyState icon="search" compact title="No matching sources" hint="No sources match your search." />
          ) : (
            filtered.map((s) => {
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
                  <IconButton icon="trash-2" tone="danger" title="Delete" onClick={() => remove(s.id)} />
                </div>
              );
            })
          )}
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
          {sources.length === 0 ? (
            <EmptyState icon="git-branch" compact title="No relationships yet" hint="Connections between sources appear here once your knowledge base has indexed content." />
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <span style={{ width: 40, height: 40, flex: "0 0 40px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name="git-branch" size={19} /></span>
              <div>
                <div style={{ font: "var(--fw-bold) 20px var(--font-display)", color: "var(--jv-cyan)" }}>{sources.length}</div>
                <div style={{ font: "var(--fw-medium) 11px var(--font-hud)", letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginTop: 2 }}>Linked sources</div>
              </div>
            </div>
          )}
        </Panel>
        <Panel title="Collections" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {collections.length === 0 ? (
            <EmptyState icon="folder" compact title="No collections" hint="Group related sources into collections to organize your knowledge base." />
          ) : (
            collections.map((col) => (
              <div key={col.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 9, font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: col.color, boxShadow: `0 0 6px ${col.color}` }} />{col.name}</span>
                <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{col.count} sources</span>
              </div>
            ))
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={clearOpen}
        danger
        title="Clear all sources?"
        message="This permanently removes every knowledge source and its indexed chunks. This cannot be undone."
        confirmLabel="Clear all"
        busy={clearing}
        onConfirm={clearAll}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}
