// HireAgent — the template gallery is the main surface; "Build your own agent"
// is a button that opens the full builder in a modal (same one as the Roster's
// "New Agent"). Both paths POST /api/agents; the new hire appears in Your Team.
import { useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../api/client";
import { useApi } from "../api/hooks";
import { Panel, Badge, Button, Icon } from "../ds";
import { AgentBuilder } from "./Agents";
import type { AiProvider, NewAgent } from "@jarvis/shared";

type Role = { ic: string; name: string; dept: string; blurb: string; budget: string; tools: string[]; grants: string };

const ROLES: Role[] = [
  { ic: "credit-card", name: "AR Clerk", dept: "Finance", blurb: "Reconciles invoices, chases receivables, drafts payments for approval.", budget: "$2,000/mo", tools: ["Bank", "Email", "Sheets"], grants: "Finance read · draft pay · no send" },
  { ic: "send", name: "SDR", dept: "Sales", blurb: "Sources leads, personalizes outreach, books qualified meetings.", budget: "$500/mo", tools: ["CRM", "Email", "Calendar"], grants: "Draft only · no send · CRM read" },
  { ic: "users", name: "Recruiting Sourcer", dept: "People", blurb: "Finds and shortlists candidates, drafts first-touch messages.", budget: "$300/mo", tools: ["LinkedIn", "Email", "Sheets"], grants: "Candidate read · no comp data" },
  { ic: "table", name: "Data-Entry Clerk", dept: "Ops", blurb: "Cleans, dedupes and enters records with a safety snapshot on delete.", budget: "$100/mo", tools: ["Sheets", "CRM"], grants: "Sheet write · backup on delete" },
  { ic: "clipboard-check", name: "QA Tester", dept: "Engineering", blurb: "Reproduces bugs, runs regression suites, files issues with repro steps.", budget: "$150/mo", tools: ["GitHub", "Sandbox"], grants: "Sandbox only · never prod" },
  { ic: "headphones", name: "Support Agent", dept: "Customer", blurb: "Triages tickets, drafts replies, escalates anything it cannot resolve.", budget: "$400/mo", tools: ["Helpdesk", "Email", "Docs"], grants: "Reply draft · no refunds" },
];

const inputStyle: CSSProperties = { width: "100%", height: 40, padding: "0 14px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-text)", font: "var(--fw-medium) 13px var(--font-body)", outline: "none", boxSizing: "border-box" };

function HireFlow({ role, onClose, onHire }: { role: Role; onClose: () => void; onHire: (name: string) => void }) {
  const [name, setName] = useState(role.name + " 01");
  const steps: [string, string, string][] = [["user", "Role", role.name], ["shield", "Permissions", role.grants], ["circle-dollar-sign", "Budget", role.budget], ["plug", "Tools", role.tools.join(" · ")]];
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 55, display: "grid", placeItems: "center", background: "rgba(3,8,16,0.65)", backdropFilter: "blur(6px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 540, maxWidth: "92%", borderRadius: "var(--r-lg)", background: "var(--grad-panel)", border: "1px solid var(--jv-border-cyan)", boxShadow: "var(--panel-shadow-active)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--jv-hairline)" }}>
          <span style={{ width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}><Icon name={role.ic} size={20} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Hire · {role.dept}</div>
            <div style={{ font: "var(--fw-bold) 17px var(--font-body)", color: "var(--jv-text)", marginTop: 2 }}>{role.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name="x" size={18} /></button>
        </div>
        <div style={{ padding: "20px" }}>
          <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>Name this teammate</div>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, marginBottom: 18 }} />
          <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 10 }}>Pre-configured from the {role.name} template</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {steps.map(([ic, k, v], i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <Icon name={ic} size={15} color="var(--jv-cyan)" />
                <span style={{ flex: "0 0 100px", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{k}</span>
                <span style={{ flex: 1, font: "12.5px var(--font-mono)", color: "var(--jv-text-soft)" }}>{v}</span>
                <Icon name="check-circle" size={15} color="var(--jv-green)" />
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 20px", borderTop: "1px solid var(--jv-hairline)" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Icon name="rocket" size={14} />} onClick={() => onHire(name)}>Hire &amp; deploy</Button>
        </div>
      </div>
    </div>
  );
}

export default function HireAgent() {
  const { data: provData } = useApi<AiProvider[]>("/api/aicore/providers");
  const activeModel = (provData ?? []).find((p) => p.active)?.model;
  const [picked, setPicked] = useState<Role | null>(null);
  const [building, setBuilding] = useState(false);
  const [, setHired] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const build = (a: NewAgent) => {
    api.post("/api/agents", a).catch(() => {});
    setBuilding(false);
    setHired((h) => [...h, a.name]);
    notify("✓ " + a.name + " created — now in Your Team, on standby.");
  };

  const hire = (name: string) => {
    if (picked) api.post("/api/agents", { name, role: picked.blurb, icon: picked.ic, model: activeModel }).catch(() => {});
    setHired((h) => [...h, name]);
    setPicked(null);
    notify("✓ " + name + " hired — now in Your Team, on standby.");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* CTA header — build your own opens the full builder in a modal */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", borderRadius: "var(--r-md)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", boxShadow: "var(--panel-shadow-active)" }}>
        <span style={{ width: 44, height: 44, flex: "0 0 44px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--jv-void)", border: "1px solid var(--jv-border-cyan)" }}><Icon name="sparkles" size={22} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--fw-bold) 16px var(--font-body)", color: "var(--jv-text)" }}>Build your own agent</div>
          <div style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-soft)", marginTop: 2 }}>Tailor an agent to exactly your workflow — model, tools, plan, routine and guardrails. Or start from a template below.</div>
        </div>
        <Button variant="primary" size="lg" icon={<Icon name="plus" size={16} />} onClick={() => setBuilding(true)}>Build your own agent</Button>
      </div>

      {/* templates — the main surface */}
      <Panel title="Agent templates" eyebrow action={<Badge status="info" dot={false}>{ROLES.length} templates</Badge>}>
        <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
          Start from a ready-made role — permissions, budget and tools come pre-set. Name it and deploy, then fine-tune anytime from the Roster.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {ROLES.map((r) => (
            <div key={r.name} style={{ display: "flex", flexDirection: "column", padding: 16, borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)", border: "1px solid var(--jv-border-soft)" }}><Icon name={r.ic} size={19} /></span>
                <div>
                  <div style={{ font: "var(--fw-bold) 14px var(--font-body)", color: "var(--jv-text)" }}>{r.name}</div>
                  <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>{r.dept}</div>
                </div>
              </div>
              <p style={{ margin: "0 0 12px", flex: 1, font: "var(--fw-regular) 12px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>{r.blurb}</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {r.tools.map((t) => <span key={t} style={{ padding: "3px 8px", borderRadius: 3, font: "var(--fw-medium) 10px var(--font-mono)", color: "var(--jv-text-soft)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)" }}>{t}</span>)}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-faint)" }}>{r.budget}</span>
                <Button size="sm" variant="secondary" icon={<Icon name="user-plus" size={13} />} onClick={() => setPicked(r)}>Hire</Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {building && <AgentBuilder onClose={() => setBuilding(false)} onCreate={build} />}
      {picked && <HireFlow role={picked} onClose={() => setPicked(null)} onHire={hire} />}
      {toast && (
        <div style={{ position: "absolute", bottom: 90, left: "50%", transform: "translateX(-50%)", zIndex: 40, display: "flex", alignItems: "center", gap: 9, padding: "11px 18px", borderRadius: "var(--r-pill)", background: "var(--grad-panel)", border: "1px solid var(--jv-border-cyan)", boxShadow: "var(--panel-shadow-active)", font: "var(--fw-medium) 13px var(--font-body)", color: "var(--jv-text)" }}>
          <Icon name="check-circle" size={15} color="var(--jv-green)" />{toast}
        </div>
      )}
    </div>
  );
}
