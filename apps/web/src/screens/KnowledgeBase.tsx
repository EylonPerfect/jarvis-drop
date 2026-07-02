// KnowledgeBase — indexed sources & collections feeding the vector store.
// Designed to the JARVIS HUD system. All data comes from the backend; the
// screen renders empty states on a clean database and never fabricates records.
import { useRef, useState } from "react";
import { Panel, Badge, Button, Input, Icon, StatTile, EmptyState, IconButton, ConfirmDialog } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { KnowledgeSource, Collection } from "@jarvis/shared";

interface KnowledgeStats { sources: number; chunks: number | string; collections: number; indexing: number; }
const ZERO_STATS: KnowledgeStats = { sources: 0, chunks: 0, collections: 0, indexing: 0 };

export default function KnowledgeBase() {
  const { data: sourcesData, reload: reloadSources } = useApi<KnowledgeSource[]>("/api/knowledge/sources");
  const { data: collectionsData, reload: reloadCollections } = useApi<Collection[]>("/api/knowledge/collections");
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

  // Notion import.
  const [notionOpen, setNotionOpen] = useState(false);
  const [notionToken, setNotionToken] = useState("");
  const [notionUrl, setNotionUrl] = useState("");
  const [notionBusy, setNotionBusy] = useState(false);
  const [notionError, setNotionError] = useState("");

  // Collections.
  const [addingCollection, setAddingCollection] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [savingCollection, setSavingCollection] = useState(false);

  // File upload.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const MAX_TEXT = 200_000;

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || uploading) return;
    const kind = (file.name.split(".").pop() || "FILE").toUpperCase();
    setUploading(true);
    try {
      let text: string;
      try {
        text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error ?? new Error("read failed"));
          reader.readAsText(file);
        });
      } catch {
        // Binary or unreadable — still register the source without content.
        await api.post("/api/knowledge/sources", { title: file.name, kind, icon: "file-text" });
        reloadSources();
        return;
      }
      if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n\n[content truncated]";
      await api.post("/api/knowledge/sources", { title: file.name, kind, icon: "file-text", content: text });
      reloadSources();
    } catch {
      /* gateway may be offline */
    } finally {
      setUploading(false);
    }
  };

  const connectNotion = async () => {
    const token = notionToken.trim();
    const pageUrl = notionUrl.trim();
    if (!token || !pageUrl || notionBusy) return;
    setNotionBusy(true);
    setNotionError("");
    try {
      await api.post("/api/knowledge/notion", { token, pageUrl });
      setNotionToken("");
      setNotionUrl("");
      setNotionOpen(false);
      reloadSources();
    } catch {
      setNotionError("Could not connect to that Notion page. Check the token and URL.");
    } finally {
      setNotionBusy(false);
    }
  };

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

  const submitCollection = async () => {
    const name = collectionName.trim();
    if (!name || savingCollection) return;
    setSavingCollection(true);
    try {
      await api.post("/api/knowledge/collections", { name });
      setCollectionName("");
      setAddingCollection(false);
      reloadCollections();
    } catch {
      /* gateway may be offline — leave the form open */
    } finally {
      setSavingCollection(false);
    }
  };

  const removeCollection = async (id: string) => {
    try {
      await api.del(`/api/knowledge/collections/${id}`);
      reloadCollections();
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
      <Button size="sm" variant="secondary" icon={<Icon name="upload" size={13} />} disabled={uploading} onClick={() => fileInputRef.current?.click()}>Upload file</Button>
      <Button size="sm" variant="secondary" icon={<Icon name="book-open" size={13} />} onClick={() => { setNotionOpen((v) => !v); setNotionError(""); }}>Connect Notion</Button>
      <Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />} onClick={() => setAdding((v) => !v)}>Add source</Button>
      {sources.length > 0 && (
        <Button size="sm" variant="danger" icon={<Icon name="trash-2" size={13} />} onClick={() => setClearOpen(true)}>Clear all</Button>
      )}
      <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFilePicked} />
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

          {notionOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Input type="password" placeholder="Notion integration token (secret_…)" value={notionToken} onChange={(e) => setNotionToken(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <Input placeholder="Notion page URL" value={notionUrl} onChange={(e) => setNotionUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && connectNotion()} />
                </div>
                <Button size="sm" variant="primary" disabled={!notionToken.trim() || !notionUrl.trim() || notionBusy} onClick={connectNotion}>Connect</Button>
                <Button size="sm" variant="ghost" onClick={() => { setNotionOpen(false); setNotionError(""); }}>Cancel</Button>
              </div>
              {notionError && <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-red)" }}>{notionError}</div>}
            </div>
          )}

          {sources.length === 0 && !adding && !notionOpen ? (
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
        <Panel title="Indexed sources" eyebrow>
          {sources.length === 0 ? (
            <EmptyState icon="database" compact title="Nothing indexed yet" hint="Add a source to start building your knowledge base." />
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <span style={{ width: 40, height: 40, flex: "0 0 40px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name="database" size={19} /></span>
              <div>
                <div style={{ font: "var(--fw-bold) 20px var(--font-display)", color: "var(--jv-cyan)" }}>{sources.length}</div>
                <div style={{ font: "var(--fw-medium) 11px var(--font-hud)", letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginTop: 2 }}>Sources in the index</div>
              </div>
            </div>
          )}
        </Panel>
        <Panel
          title="Collections"
          eyebrow
          action={<IconButton icon="plus" title="New collection" onClick={() => setAddingCollection((v) => !v)} />}
          bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {addingCollection && (
            <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)" }}>
              <div style={{ flex: 1 }}>
                <Input placeholder="Collection name" value={collectionName} autoFocus onChange={(e) => setCollectionName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitCollection()} />
              </div>
              <Button size="sm" variant="primary" disabled={!collectionName.trim() || savingCollection} onClick={submitCollection}>Add</Button>
            </div>
          )}
          {collections.length === 0 && !addingCollection ? (
            <EmptyState icon="folder" compact title="No collections" hint="Group indexed sources into collections. Add your first collection to get started." />
          ) : (
            collections.map((col) => (
              <div key={col.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}><span style={{ width: 8, height: 8, flex: "0 0 8px", borderRadius: 2, background: col.color, boxShadow: `0 0 6px ${col.color}` }} />{col.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{col.count} sources</span>
                  <IconButton icon="trash-2" tone="danger" title="Delete" onClick={() => removeCollection(col.id)} />
                </span>
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
