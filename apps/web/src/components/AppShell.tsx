import { type ReactNode, useEffect, useState } from "react";
import { Icon, Logo, Badge, Input, Button, Waveform } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { SessionCost, AiProvider } from "@jarvis/shared";

export type ViewId =
  | "command"
  | "aicore"
  | "agents"
  | "hire"
  | "approvals"
  | "permissions"
  | "spend"
  | "ledger"
  | "integrations"
  | "tasks"
  | "calendar"
  | "memory"
  | "conversations"
  | "knowledge"
  | "tools"
  | "workflows"
  | "monitor";

type Leaf = { id: ViewId; icon: string; label: string };
type NavGroupDef = { group: true; id: ViewId; icon: string; label: string; children: Leaf[] };
type NavEntry = Leaf | NavGroupDef;
type NavSection = { header: string; items: NavEntry[] };

// The Command Center is the home surface, pinned above the two labelled
// sections. Everything agent-related is collapsed under the "Agents" group.
const HOME: Leaf = { id: "command", icon: "layout-grid", label: "Command Center" };

const SECTIONS: NavSection[] = [
  {
    header: "Agents",
    items: [
      {
        group: true,
        id: "agents",
        icon: "bot",
        label: "Agents",
        children: [
          { id: "agents", icon: "users", label: "Roster" },
          { id: "hire", icon: "user-plus", label: "Hire an Agent" },
          { id: "approvals", icon: "inbox", label: "Approvals" },
          { id: "permissions", icon: "shield", label: "Permissions" },
        ],
      },
      { id: "spend", icon: "circle-dollar-sign", label: "Spend" },
      { id: "ledger", icon: "scroll-text", label: "Ledger" },
      { id: "tasks", icon: "list-checks", label: "Tasks" },
      { id: "calendar", icon: "calendar", label: "Calendar" },
    ],
  },
  {
    header: "System",
    items: [
      { id: "aicore", icon: "cpu", label: "AI Core" },
      { id: "integrations", icon: "plug", label: "Integrations" },
      { id: "memory", icon: "database", label: "Memory" },
      { id: "conversations", icon: "message-square", label: "Conversations" },
      { id: "knowledge", icon: "network", label: "Knowledge Base" },
      { id: "tools", icon: "wrench", label: "Tools & Skills" },
      { id: "workflows", icon: "workflow", label: "Workflows" },
      { id: "monitor", icon: "gauge", label: "System Monitor" },
    ],
  },
];

function useClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function Clock() {
  const t = useClock();
  const time = t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  const day = t.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <div style={{ textAlign: "center", lineHeight: 1.1 }}>
      <div style={{ font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-soft)" }}>{day}</div>
      <div style={{ font: "var(--fw-bold) 28px/1 var(--font-display)", color: "var(--jv-cyan-300)", textShadow: "var(--glow-cyan)", letterSpacing: "0.02em" }}>
        {time.toLowerCase()}
      </div>
    </div>
  );
}

function TeamCost() {
  const { data } = useApi<SessionCost>("/api/memory/cost");
  const cost = data ?? { total: "$0.00", entries: [] };
  const title = cost.entries.map((e) => `${e.provider} ${e.cost}`).join(" · ");
  return (
    <div
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 14px",
        borderRadius: "var(--r-sm)",
        border: "1px solid var(--jv-border)",
        clipPath: "var(--clip-chamfer)",
        background: "rgba(4,12,22,0.5)",
      }}
    >
      <Icon name="circle-dollar-sign" size={16} color="var(--jv-cyan)" />
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>
          Team cost · today
        </div>
        <div style={{ font: "var(--fw-bold) 22px/1 var(--font-mono)", color: "var(--jv-cyan-300)", textShadow: "var(--glow-cyan)", marginTop: 3 }}>
          {cost.total}
        </div>
      </div>
    </div>
  );
}

function Rail({ active, onNav }: { active: ViewId; onNav: (id: ViewId) => void }) {
  return (
    <aside
      style={{
        width: 260,
        flex: "0 0 260px",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(180deg, #0a1626, #070f1c)",
        borderRight: "1px solid var(--jv-border)",
        padding: "0 14px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", height: 80, padding: "0 4px", borderBottom: "1px solid var(--jv-hairline)", marginBottom: 14 }}>
        <Logo size={44} wordmark />
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 3, overflowY: "auto", flex: 1, margin: "0 -4px", padding: "0 4px" }}>
        <NavLeafRow leaf={HOME} active={active === HOME.id} onNav={onNav} />
        {SECTIONS.map((section) => (
          <div key={section.header} style={{ marginTop: 14 }}>
            <div
              style={{
                font: "var(--fw-semibold) 10px var(--font-hud)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--jv-text-muted)",
                padding: "0 12px",
                marginBottom: 6,
              }}
            >
              {section.header}
            </div>
            {section.items.map((item) =>
              "group" in item ? (
                <NavGroupRow key={item.id} group={item} active={active} onNav={onNav} />
              ) : (
                <NavLeafRow key={item.id} leaf={item} active={active === item.id} onNav={onNav} />
              ),
            )}
          </div>
        ))}
      </nav>
      <div style={{ flex: "0 0 8px" }} />
      <button
        style={{
          marginTop: 10,
          height: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderRadius: "var(--r-sm)",
          border: "1px solid var(--jv-border)",
          background: "rgba(41,211,245,0.05)",
          color: "var(--jv-text-soft)",
          font: "var(--fw-semibold) 12px var(--font-hud)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        <Icon name="zap" size={15} color="var(--jv-cyan)" /> Focus Mode
      </button>
    </aside>
  );
}

// Nav rows (mirror DS NavItem but keep the Icon composition inline).
import { NavItem } from "../ds";

function NavLeafRow({ leaf, active, onNav, indent = false }: { leaf: Leaf; active: boolean; onNav: (id: ViewId) => void; indent?: boolean }) {
  return (
    <div style={indent ? { paddingLeft: 14 } : undefined}>
      <NavItem icon={<Icon name={leaf.icon} size={indent ? 16 : 18} />} label={leaf.label} active={active} onClick={() => onNav(leaf.id)} />
    </div>
  );
}

// Collapsible group: the parent row toggles expansion (and stays open while one
// of its children is the active view); children navigate.
function NavGroupRow({ group, active, onNav }: { group: NavGroupDef; active: ViewId; onNav: (id: ViewId) => void }) {
  const childIds = group.children.map((c) => c.id);
  const hasActiveChild = childIds.includes(active);
  const [open, setOpen] = useState(hasActiveChild);
  useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);

  return (
    <>
      <NavItem
        icon={<Icon name={group.icon} size={18} />}
        active={!open && hasActiveChild}
        onClick={() => setOpen((o) => !o)}
        label={
          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            {group.label}
            <Icon name={open ? "chevron-down" : "chevron-right"} size={15} />
          </span>
        }
      />
      {open && group.children.map((c) => <NavLeafRow key={c.id} leaf={c} active={active === c.id} onNav={onNav} indent />)}
    </>
  );
}

// Top-bar model picker — lists only the models connected in AI Core. Choosing
// one makes that provider active (what the Command Center chat routes through).
function ModelSelect() {
  const { data, reload } = useApi<AiProvider[]>("/api/aicore/providers");
  const providers = data ?? [];
  const active = providers.find((p) => p.active);
  const boxStyle = {
    height: 36,
    padding: "0 10px",
    borderRadius: "var(--r-sm)",
    background: "rgba(4,12,22,0.6)",
    border: "1px solid var(--jv-border)",
    color: "var(--jv-text-soft)",
    font: "var(--fw-medium) 12px var(--font-mono)",
  } as const;

  if (!providers.length) {
    return (
      <div style={{ ...boxStyle, display: "flex", alignItems: "center", gap: 6, color: "var(--jv-text-muted)" }} title="Connect a provider in AI Core">
        <Icon name="plug" size={13} /> No model
      </div>
    );
  }
  const onPick = async (id: string) => {
    const p = providers.find((pr) => pr.id === id);
    if (p && !p.active) {
      await api.patch(`/api/aicore/providers/${id}`, { active: true }).catch(() => {});
      reload();
    }
  };
  return (
    <select value={active?.id ?? providers[0].id} onChange={(e) => onPick(e.target.value)} style={boxStyle} title="Active model (from AI Core)">
      {providers.map((p) => (
        <option key={p.id} value={p.id}>{p.model} · {p.name}</option>
      ))}
    </select>
  );
}

function TopBar({ onAbout }: { onAbout: () => void }) {
  return (
    <header
      style={{
        height: 64,
        flex: "0 0 64px",
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "0 22px",
        borderBottom: "1px solid var(--jv-border)",
        background: "linear-gradient(180deg, rgba(12,26,46,0.6), transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 14px",
          borderRadius: "var(--r-sm)",
          border: "1px solid var(--jv-border)",
          clipPath: "var(--clip-chamfer)",
          background: "rgba(4,12,22,0.5)",
        }}
      >
        <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", color: "var(--jv-text-muted)" }}>SYSTEM STATUS</span>
        <Badge status="optimal">Optimal</Badge>
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 18 }}>
        <Clock />
        <TeamCost />
      </div>
      <Input icon={<Icon name="search" size={16} />} placeholder="Search…" wrapStyle={{ width: 240, height: 36 }} />
      <ModelSelect />
      {["layout-grid", "bell", "info", "settings"].map((n) => (
        <button
          key={n}
          onClick={n === "info" ? onAbout : undefined}
          title={n === "info" ? "About J.A.R.V.I.S." : undefined}
          style={{
            width: 36,
            height: 36,
            display: "grid",
            placeItems: "center",
            borderRadius: "var(--r-sm)",
            border: "1px solid var(--jv-border)",
            background: "transparent",
            color: "var(--jv-text-muted)",
            cursor: "pointer",
          }}
        >
          <Icon name={n} size={17} />
        </button>
      ))}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 8px 5px 14px",
          borderRadius: "var(--r-pill)",
          border: "1px solid var(--jv-border-cyan)",
          background: "var(--grad-cyan-soft)",
        }}
      >
        <div style={{ textAlign: "right", lineHeight: 1.2 }}>
          <div style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)" }}>Operator</div>
          <div style={{ font: "var(--fw-medium) 9px var(--font-hud)", letterSpacing: "0.1em", color: "var(--jv-cyan-300)" }}>Commander</div>
        </div>
        <span style={{ width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)" }}>
          <Icon name="user" size={16} color="var(--jv-cyan)" />
        </span>
      </div>
    </header>
  );
}

function Dock() {
  return (
    <footer
      style={{
        height: 72,
        flex: "0 0 72px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 22px",
        borderTop: "1px solid var(--jv-border)",
        background: "linear-gradient(0deg, rgba(12,26,46,0.7), transparent)",
      }}
    >
      <div style={{ display: "flex", gap: 18 }}>
        {([["map-pin", "Location", "Bhimber, Paki…"], ["sun", "Weather", "28°C Overcast"], ["wifi", "Network", "Excellent"]] as const).map(([ic, k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name={ic} size={16} color="var(--jv-cyan)" />
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ font: "var(--fw-medium) 9px var(--font-hud)", letterSpacing: "0.08em", color: "var(--jv-text-muted)", textTransform: "uppercase" }}>{k}</div>
              <div style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text-soft)" }}>{v}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 26px",
            borderRadius: "var(--r-pill)",
            border: "1px solid var(--jv-border-cyan)",
            background: "var(--grad-cyan-soft)",
            boxShadow: "var(--glow-cyan)",
          }}
        >
          <Waveform height={20} bars={10} active color="var(--jv-cyan-300)" />
          <div style={{ textAlign: "center" }}>
            <div style={{ font: "var(--fw-bold) 14px var(--font-hud)", letterSpacing: "0.18em", color: "var(--jv-cyan-300)" }}>TALK TO JARVIS</div>
            <div style={{ font: "var(--fw-medium) 10px var(--font-body)", color: "var(--jv-text-soft)" }}>I am listening…</div>
          </div>
          <Waveform height={20} bars={10} active color="var(--jv-cyan-300)" />
        </div>
      </div>
      <Button variant="secondary" icon={<Icon name="play" size={14} />}>Executive Briefing</Button>
    </footer>
  );
}

export function AppShell({
  active,
  onNav,
  showDock = true,
  onAbout,
  children,
}: {
  active: ViewId;
  onNav: (id: ViewId) => void;
  showDock?: boolean;
  onAbout: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "var(--grad-app)", overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Rail active={active} onNav={onNav} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <TopBar onAbout={onAbout} />
          <main style={{ flex: 1, overflowY: "auto", padding: 18 }}>{children}</main>
        </div>
      </div>
      {showDock && <Dock />}
    </div>
  );
}
