// ToolsSkills — the tool & skill registry: connected MCP servers, built-in
// skills, and integrations, each with a status and toggle. All items come from
// the backend; toggles persist via PATCH and reflect server state after reload.
import { Panel, Badge, Icon, Switch, EmptyState } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { ToolItem } from "@jarvis/shared";

const GROUP_ORDER = ["MCP Servers", "Built-in Skills", "Integrations"];

function ToolCard({ item, onToggle }: { item: ToolItem; onToggle: (next: boolean) => void }) {
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
    </div>
  );
}

export default function ToolsSkills() {
  const { data, reload } = useApi<{ items: ToolItem[]; hermes: unknown }>("/api/tools");
  const items = data?.items ?? [];

  const toggle = async (id: string, next: boolean) => {
    try {
      await api.patch(`/api/tools/${id}`, { enabled: next });
      reload();
    } catch {
      /* gateway may be offline — leave state unchanged */
    }
  };

  if (items.length === 0) {
    return (
      <Panel title="Tools & Skills" eyebrow>
        <EmptyState
          icon="puzzle"
          title="No tools connected yet"
          hint="Tools and skills appear here once MCP servers, built-in skills, or integrations are configured and connected."
        />
      </Panel>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {GROUP_ORDER.map((label) => {
        const groupItems = items.filter((i) => i.group === label);
        if (groupItems.length === 0) return null;
        const enabledCount = groupItems.filter((i) => i.enabled).length;
        return (
          <Panel key={label} title={label} eyebrow action={<Badge status="info" dot={false}>{enabledCount} active</Badge>}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {groupItems.map((t) => <ToolCard key={t.id} item={t} onToggle={(next) => toggle(t.id, next)} />)}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
