// ToolsSkills — the tool & skill registry: connected MCP servers, built-in
// skills, and integrations, each with a status and toggle. All items come from
// the backend; toggles persist via PATCH and reflect server state after reload.
import { useState } from "react";
import { Panel, Badge, Button, Input, Icon, Switch, EmptyState, IconButton, ConfirmDialog } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { ToolItem } from "@jarvis/shared";

const GROUP_ORDER = ["MCP Servers", "Built-in Skills", "Integrations"];

function ToolCard({ item, onToggle, onDelete }: { item: ToolItem; onToggle: (next: boolean) => void; onDelete: () => void }) {
  const enabled = item.enabled;
  const c = item.statusTone === "optimal" ? "var(--jv-green)" : item.statusTone === "warn" ? "var(--jv-amber)" : "var(--jv-text-faint)";
  return (
    <div style={{ padding: "13px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: `1px solid ${enabled ? "var(--jv-border)" : "var(--jv-border-soft)"}`, opacity: enabled ? 1 : 0.72, display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 38, height: 38, flex: "0 0 38px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: enabled ? "var(--jv-cyan)" : "var(--jv-text-muted)", background: enabled ? "rgba(41,211,245,0.08)" : "rgba(120,160,190,0.06)" }}><Icon name={item.icon} size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{item.name}</span>
          {enabled && <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />}
        </div>
        <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{item.desc}</div>
      </div>
      <Switch checked={enabled} onChange={onToggle} />
      <IconButton icon="trash-2" tone="danger" title="Delete" onClick={onDelete} />
    </div>
  );
}

export default function ToolsSkills() {
  const { data, reload } = useApi<{ items: ToolItem[]; hermes: unknown }>("/api/tools");
  const items = data?.items ?? [];

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [grp, setGrp] = useState("Built-in Skills");
  const [descr, setDescr] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const toggle = async (id: string, next: boolean) => {
    try {
      await api.patch(`/api/tools/${id}`, { enabled: next });
      reload();
    } catch {
      /* gateway may be offline — leave state unchanged */
    }
  };

  const submitAdd = async () => {
    const n = name.trim();
    if (!n || saving) return;
    setSaving(true);
    try {
      await api.post("/api/tools", { name: n, grp, descr: descr.trim() });
      setName("");
      setDescr("");
      setGrp("Built-in Skills");
      setAdding(false);
      reload();
    } catch {
      /* gateway may be offline — leave the form open */
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.del(`/api/tools/${id}`);
      reload();
    } catch {
      /* ignore */
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await api.del("/api/tools");
      reload();
    } catch {
      /* ignore */
    } finally {
      setClearing(false);
      setClearOpen(false);
    }
  };

  const headerAction = (
    <div style={{ display: "flex", gap: 8 }}>
      <Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />} onClick={() => setAdding((v) => !v)}>Add tool/skill</Button>
      {items.length > 0 && (
        <Button size="sm" variant="danger" icon={<Icon name="trash-2" size={13} />} onClick={() => setClearOpen(true)}>Clear all</Button>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel title="Tools & Skills" eyebrow action={headerAction}>
        {adding ? (
          <div style={{ display: "flex", gap: 8, padding: "12px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)" }}>
            <div style={{ flex: 1 }}>
              <Input placeholder="Tool or skill name" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAdd()} />
            </div>
            <select
              value={grp}
              onChange={(e) => setGrp(e.target.value)}
              style={{ width: 160, height: 40, padding: "0 12px", borderRadius: "var(--r-sm)", background: "rgba(4, 12, 22, 0.6)", border: "1px solid var(--jv-border)", color: "var(--jv-text)", font: "var(--fw-regular) 13px var(--font-body)" }}
            >
              {GROUP_ORDER.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <div style={{ width: 220 }}>
              <Input placeholder="Description (optional)" value={descr} onChange={(e) => setDescr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAdd()} />
            </div>
            <Button size="sm" variant="primary" disabled={!name.trim() || saving} onClick={submitAdd}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="puzzle"
            title="No tools connected yet"
            hint="Tools and skills appear here once MCP servers, built-in skills, or integrations are configured and connected."
            action={<Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />} onClick={() => setAdding(true)}>Add tool/skill</Button>}
          />
        ) : null}
      </Panel>

      {GROUP_ORDER.map((label) => {
        const groupItems = items.filter((i) => i.group === label);
        if (groupItems.length === 0) return null;
        const enabledCount = groupItems.filter((i) => i.enabled).length;
        return (
          <Panel key={label} title={label} eyebrow action={<Badge status="info" dot={false}>{enabledCount} active</Badge>}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {groupItems.map((t) => <ToolCard key={t.id} item={t} onToggle={(next) => toggle(t.id, next)} onDelete={() => remove(t.id)} />)}
            </div>
          </Panel>
        );
      })}

      <ConfirmDialog
        open={clearOpen}
        danger
        title="Clear all tools & skills?"
        message="This permanently removes every tool and skill from the registry. This cannot be undone."
        confirmLabel="Clear all"
        busy={clearing}
        onConfirm={clearAll}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}
