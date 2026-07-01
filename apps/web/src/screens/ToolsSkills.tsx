// ToolsSkills — the tool & skill registry: connected MCP servers, built-in
// skills, and integrations, each with a status and toggle. 18 total.
import { useState } from "react";
import { Panel, Badge, Icon, Switch } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { ToolItem } from "@jarvis/shared";

// Seed transcribed verbatim from the original GROUPS 5-tuples
// [icon, name, desc, enabled, statusTone], flattened with group + slug id.
const SEED: ToolItem[] = [
  { id: "github", group: "MCP Servers", icon: "github", name: "GitHub", desc: "Repos, PRs, issues", enabled: true, statusTone: "optimal" },
  { id: "whatsapp", group: "MCP Servers", icon: "message-circle", name: "WhatsApp", desc: "Messaging bridge", enabled: true, statusTone: "warn" },
  { id: "filesystem", group: "MCP Servers", icon: "hard-drive", name: "Filesystem", desc: "Local file access", enabled: true, statusTone: "optimal" },
  { id: "web-search", group: "MCP Servers", icon: "globe", name: "Web Search", desc: "Live web + fetch", enabled: true, statusTone: "optimal" },
  { id: "google-calendar", group: "MCP Servers", icon: "calendar", name: "Google Calendar", desc: "Events & reminders", enabled: false, statusTone: "neutral" },
  { id: "gmail", group: "MCP Servers", icon: "mail", name: "Gmail", desc: "Read & draft mail", enabled: false, statusTone: "neutral" },
  { id: "code-interpreter", group: "Built-in Skills", icon: "code", name: "Code Interpreter", desc: "Run & test code", enabled: true, statusTone: "optimal" },
  { id: "document-reader", group: "Built-in Skills", icon: "file-text", name: "Document Reader", desc: "PDF / DOCX / PPTX", enabled: true, statusTone: "optimal" },
  { id: "vision", group: "Built-in Skills", icon: "image", name: "Vision", desc: "Screenshot analysis", enabled: true, statusTone: "optimal" },
  { id: "voice-io", group: "Built-in Skills", icon: "mic", name: "Voice I/O", desc: "STT + cascading TTS", enabled: true, statusTone: "optimal" },
  { id: "memory-recall", group: "Built-in Skills", icon: "database", name: "Memory Recall", desc: "Vector retrieval", enabled: true, statusTone: "optimal" },
  { id: "shell", group: "Built-in Skills", icon: "terminal", name: "Shell", desc: "System commands", enabled: true, statusTone: "warn" },
  { id: "hubstaff", group: "Integrations", icon: "clock", name: "Hubstaff", desc: "Time tracking", enabled: true, statusTone: "optimal" },
  { id: "jira", group: "Integrations", icon: "trello", name: "Jira", desc: "Issue sync", enabled: false, statusTone: "neutral" },
  { id: "figma", group: "Integrations", icon: "figma", name: "Figma", desc: "Design handoff", enabled: false, statusTone: "neutral" },
  { id: "slack", group: "Integrations", icon: "slack", name: "Slack", desc: "Team notifications", enabled: true, statusTone: "optimal" },
  { id: "stripe", group: "Integrations", icon: "credit-card", name: "Stripe", desc: "Billing events", enabled: false, statusTone: "neutral" },
  { id: "notifications", group: "Integrations", icon: "bell", name: "Notifications", desc: "Desktop alerts", enabled: true, statusTone: "optimal" },
];

const GROUP_ORDER = ["MCP Servers", "Built-in Skills", "Integrations"];

function ToolCard({ item }: { item: ToolItem }) {
  const [enabled, setEnabled] = useState(item.enabled);
  const c = item.statusTone === "optimal" ? "var(--jv-green)" : item.statusTone === "warn" ? "var(--jv-amber)" : "var(--jv-text-faint)";
  const toggle = (next: boolean) => {
    setEnabled(next);
    api.patch(`/api/tools/${item.id}`, { enabled: next }).catch(() => {});
  };
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
      <Switch checked={enabled} onChange={toggle} />
    </div>
  );
}

export default function ToolsSkills() {
  const { data } = useApi<{ items: ToolItem[]; hermes: any }>("/api/tools");
  const items = data?.items ?? SEED;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {GROUP_ORDER.map((label) => {
        const groupItems = items.filter((i) => i.group === label);
        if (groupItems.length === 0) return null;
        const enabledCount = groupItems.filter((i) => i.enabled).length;
        return (
          <Panel key={label} title={label} eyebrow action={<Badge status="info" dot={false}>{enabledCount} active</Badge>}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {groupItems.map((t) => <ToolCard key={t.id} item={t} />)}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
