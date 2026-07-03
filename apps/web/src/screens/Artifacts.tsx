// Artifacts — every agent gets a living "artifact": a department dashboard or
// roadmap derived from the roster by the backend. This screen lists them
// (grouped by department) on the left and shows the selected artifact's full
// dashboard/roadmap on the right. Read-only — artifacts are derived, not created.
import { useEffect, useState } from "react";
import { Panel, Icon, Badge, StatTile, EmptyState } from "../ds";
import { useApi } from "../api/hooks";
import type { Artifact } from "@jarvis/shared";

// Group artifacts by department, preserving first-seen order.
function groupByDepartment(items: Artifact[]): { department: string; items: Artifact[] }[] {
  const order: string[] = [];
  const map = new Map<string, Artifact[]>();
  for (const a of items) {
    const dept = a.department || "Other";
    if (!map.has(dept)) {
      map.set(dept, []);
      order.push(dept);
    }
    map.get(dept)!.push(a);
  }
  return order.map((department) => ({ department, items: map.get(department)! }));
}

// ---------------------------------------------------------------------------
// Left list — one selectable card per artifact, grouped by department.
// ---------------------------------------------------------------------------
function ArtifactCard({ artifact, selected, onSelect }: { artifact: Artifact; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "12px 14px",
        borderRadius: "var(--r-sm)",
        textAlign: "left",
        cursor: "pointer",
        background: selected ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)",
        border: `1px solid ${selected ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`,
        boxShadow: selected ? "inset 0 0 16px rgba(41,211,245,0.08)" : "none",
        transition: "all var(--t-fast)",
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          flex: "0 0 34px",
          display: "grid",
          placeItems: "center",
          borderRadius: "50%",
          color: "var(--jv-cyan)",
          background: "var(--grad-cyan-soft)",
          border: "1px solid var(--jv-border-cyan)",
        }}
      >
        <Icon name={artifact.icon || "layout-dashboard"} size={17} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ font: "var(--fw-semibold) 13.5px var(--font-body)", color: "var(--jv-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {artifact.department}
          </span>
          <Badge status={artifact.kind === "roadmap" ? "standby" : "info"}>{artifact.kind === "roadmap" ? "Roadmap" : "Dashboard"}</Badge>
        </div>
        <div style={{ marginTop: 2, font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {[artifact.agentName, artifact.role].filter(Boolean).join(" · ") || "—"}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// KPI tile — value/target/unit with an optional hint underneath.
// ---------------------------------------------------------------------------
function KpiTile({ kpi }: { kpi: Artifact["kpis"][number] }) {
  const value = kpi.value ? `${kpi.value}${kpi.unit ? ` ${kpi.unit}` : ""}` : "—";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <StatTile value={value} label={kpi.label} />
      {(kpi.target || kpi.hint) && (
        <div style={{ padding: "0 4px", display: "flex", flexDirection: "column", gap: 2 }}>
          {kpi.target && (
            <div style={{ font: "var(--fw-medium) 11px/1 var(--font-hud)", letterSpacing: "0.06em", color: "var(--jv-cyan-300)" }}>
              target: {kpi.target}
              {kpi.unit ? ` ${kpi.unit}` : ""}
            </div>
          )}
          {kpi.hint && <div style={{ font: "var(--fw-regular) 11px/1.45 var(--font-body)", color: "var(--jv-text-muted)" }}>{kpi.hint}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail — dashboard (KPI grid) or roadmap (section columns + KPI strip).
// ---------------------------------------------------------------------------
function ArtifactDetail({ artifact }: { artifact: Artifact }) {
  const isRoadmap = artifact.kind === "roadmap";
  const sections = artifact.sections ?? [];
  const kpis = artifact.kpis ?? [];

  return (
    <Panel
      title={artifact.department}
      brackets
      action={<Badge status={isRoadmap ? "standby" : "info"}>{isRoadmap ? "Roadmap" : "Dashboard"}</Badge>}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span
          style={{
            width: 40,
            height: 40,
            flex: "0 0 40px",
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
            color: "var(--jv-cyan)",
            background: "var(--grad-cyan-soft)",
            border: "1px solid var(--jv-border-cyan)",
          }}
        >
          <Icon name={artifact.icon || "layout-dashboard"} size={20} />
        </span>
        <div>
          <div style={{ font: "var(--fw-semibold) 14px var(--font-body)", color: "var(--jv-text)" }}>{artifact.agentName}</div>
          <div style={{ marginTop: 2, font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>{artifact.role}</div>
        </div>
      </div>

      {artifact.summary && (
        <p style={{ margin: "0 0 18px", font: "var(--fw-regular) 13px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>{artifact.summary}</p>
      )}

      {isRoadmap ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {kpis.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
              {kpis.map((kpi, i) => (
                <KpiTile key={i} kpi={kpi} />
              ))}
            </div>
          )}
          {sections.length === 0 ? (
            <EmptyState compact icon="flag" title="No roadmap items yet" hint="This roadmap fills in as the agent plans and works." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
              {sections.map((section, i) => (
                <div
                  key={i}
                  style={{
                    padding: 14,
                    borderRadius: "var(--r-sm)",
                    background: "var(--jv-surface-3)",
                    border: "1px solid var(--jv-border-soft)",
                  }}
                >
                  <div style={{ font: "var(--fw-semibold) 11px/1 var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 12 }}>
                    {section.title}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {section.items.length === 0 ? (
                      <span style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>—</span>
                    ) : (
                      section.items.map((item, j) => (
                        <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <Icon name="check-circle" size={14} color="var(--jv-cyan)" />
                          <span style={{ font: "var(--fw-regular) 12.5px/1.45 var(--font-body)", color: "var(--jv-text-soft)" }}>{item}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : kpis.length === 0 ? (
        <EmptyState compact icon="gauge" title="No KPIs yet" hint="This dashboard fills in as the agent works." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
          {kpis.map((kpi, i) => (
            <KpiTile key={i} kpi={kpi} />
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
export default function Artifacts() {
  const { data } = useApi<Artifact[]>("/api/artifacts");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const artifacts = data ?? [];

  // Default the selection to the first artifact once data arrives.
  useEffect(() => {
    if (artifacts.length > 0 && (selectedId === null || !artifacts.some((a) => a.id === selectedId))) {
      setSelectedId(artifacts[0].id);
    }
  }, [artifacts, selectedId]);

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;
  const groups = groupByDepartment(artifacts);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ margin: 0, font: "var(--fw-regular) 13px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>
        Each agent gets a living artifact — a department dashboard with the KPIs that matter for its role. It fills in as the agent works.
      </p>

      {data === null ? (
        <Panel>
          <div style={{ font: "var(--fw-regular) 12.5px var(--font-body)", color: "var(--jv-text-muted)" }}>Loading artifacts…</div>
        </Panel>
      ) : artifacts.length === 0 ? (
        <Panel>
          <EmptyState icon="layout-dashboard" title="No artifacts yet" hint="Hire an agent and its department artifact appears here." />
        </Panel>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
          <Panel title="Artifacts" eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {groups.map((g) => (
                <div key={g.department} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-text-muted)", padding: "0 2px" }}>
                    {g.department}
                  </div>
                  {g.items.map((a) => (
                    <ArtifactCard key={a.id} artifact={a} selected={a.id === selectedId} onSelect={() => setSelectedId(a.id)} />
                  ))}
                </div>
              ))}
            </div>
          </Panel>

          {selected && <ArtifactDetail artifact={selected} />}
        </div>
      )}
    </div>
  );
}
