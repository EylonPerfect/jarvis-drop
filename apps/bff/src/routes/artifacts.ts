import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import type { Artifact, ArtifactKPI, ArtifactSection, AgentGoal } from "@jarvis/shared";

// ============================================================
// Artifacts — every agent gets a living "artifact": a department dashboard (or
// roadmap for R&D) with the KPIs that matter for its role. Derived from the
// roster, so a new agent automatically gets its artifact. Values fill in as the
// agent works; the agent's own goals are folded in as extra KPIs.
// ============================================================

interface Template {
  department: string;
  icon: string;
  kind: "dashboard" | "roadmap";
  summary: string;
  kpis: ArtifactKPI[];
  sections?: ArtifactSection[];
}

const T: Record<string, Template> = {
  cs: {
    department: "Customer Success",
    icon: "heart-handshake",
    kind: "dashboard",
    summary: "Post-sale health, adoption, retention and expansion.",
    kpis: [
      { label: "Net revenue retention", target: "≥ 110", unit: "%" },
      { label: "Gross churn", target: "< 5", unit: "%" },
      { label: "Customer health score", target: "≥ 80", unit: "/100" },
      { label: "QBR completion", target: "100", unit: "%" },
      { label: "Time to value", target: "< 14", unit: "days" },
      { label: "Adoption / active usage", target: "≥ 70", unit: "%" },
      { label: "CSAT / NPS", target: "≥ 50", unit: "NPS" },
      { label: "Expansion pipeline", target: "grow", unit: "$" },
    ],
  },
  sdr: {
    department: "Sales Development",
    icon: "phone",
    kind: "dashboard",
    summary: "Top-of-funnel: outreach, replies and qualified pipeline.",
    kpis: [
      { label: "Meetings booked", target: "≥ 20 / mo", unit: "" },
      { label: "Reply rate", target: "≥ 8", unit: "%" },
      { label: "Qualified opportunities", target: "≥ 10 / mo", unit: "" },
      { label: "Pipeline generated", target: "grow", unit: "$" },
      { label: "Activities / day", target: "≥ 60", unit: "" },
    ],
  },
  ae: {
    department: "Sales",
    icon: "briefcase",
    kind: "dashboard",
    summary: "Pipeline, win rate and quota attainment.",
    kpis: [
      { label: "Pipeline coverage", target: "≥ 3x", unit: "" },
      { label: "Win rate", target: "≥ 25", unit: "%" },
      { label: "Average contract value", target: "grow", unit: "$" },
      { label: "Quota attainment", target: "≥ 100", unit: "%" },
      { label: "Sales cycle", target: "shorten", unit: "days" },
      { label: "New logos", target: "≥ 4 / mo", unit: "" },
    ],
  },
  eng: {
    department: "Engineering (R&D)",
    icon: "code",
    kind: "roadmap",
    summary: "Delivery roadmap plus engineering health.",
    kpis: [
      { label: "Velocity", target: "stable", unit: "pts/sprint" },
      { label: "Cycle time", target: "< 3", unit: "days" },
      { label: "PRs merged", target: "trend up", unit: "/wk" },
      { label: "Deploy frequency", target: "daily", unit: "" },
      { label: "Bug escape rate", target: "< 5", unit: "%" },
      { label: "Incident MTTR", target: "< 1", unit: "hr" },
    ],
    sections: [
      { title: "Now", items: ["Active sprint work", "In-flight PRs", "Live incidents"] },
      { title: "Next", items: ["Committed next sprint", "Tech-debt paydown"] },
      { title: "Later", items: ["Roadmap bets", "Exploration / spikes"] },
    ],
  },
  recruiter: {
    department: "Recruiting",
    icon: "user-search",
    kind: "dashboard",
    summary: "Sourcing throughput and hiring velocity.",
    kpis: [
      { label: "Open roles", target: "on track", unit: "" },
      { label: "Candidates sourced", target: "≥ 50 / role", unit: "" },
      { label: "Screen → interview rate", target: "≥ 30", unit: "%" },
      { label: "Time to fill", target: "< 30", unit: "days" },
      { label: "Offer accept rate", target: "≥ 80", unit: "%" },
    ],
  },
  support: {
    department: "Support",
    icon: "life-buoy",
    kind: "dashboard",
    summary: "Resolution speed and customer satisfaction.",
    kpis: [
      { label: "Tickets resolved", target: "trend up", unit: "/day" },
      { label: "First response time", target: "< 1", unit: "hr" },
      { label: "CSAT", target: "≥ 90", unit: "%" },
      { label: "Backlog", target: "< 20", unit: "" },
      { label: "Escalation rate", target: "< 10", unit: "%" },
    ],
  },
  ops: {
    department: "Operations",
    icon: "settings-2",
    kind: "dashboard",
    summary: "Reporting cadence and data quality.",
    kpis: [
      { label: "Reports delivered on time", target: "100", unit: "%" },
      { label: "Data accuracy", target: "≥ 99", unit: "%" },
      { label: "Process cycle time", target: "shorten", unit: "" },
      { label: "Exceptions flagged", target: "0 missed", unit: "" },
    ],
  },
  generic: {
    department: "Team",
    icon: "bot",
    kind: "dashboard",
    summary: "Core delivery and quality signals.",
    kpis: [
      { label: "Tasks completed", target: "trend up", unit: "/wk" },
      { label: "Quality / rework rate", target: "< 5", unit: "%" },
      { label: "Response time", target: "fast", unit: "" },
      { label: "Goals hit", target: "≥ 90", unit: "%" },
    ],
  },
};

function categorize(role: string): Template {
  const r = (role || "").toLowerCase();
  if (/(customer success|csm|success manager)/.test(r)) return T.cs;
  if (/(account executive|\bae\b|sales rep|closer|quota)/.test(r)) return T.ae;
  if (/(sdr|sales development|bdr|outbound|prospect)/.test(r)) return T.sdr;
  if (/(engineer|developer|full[\s-]?stack|swe|coding|software|r&d)/.test(r)) return T.eng;
  if (/(recruit|sourcer|talent|hiring)/.test(r)) return T.recruiter;
  if (/(support|helpdesk|customer service)/.test(r)) return T.support;
  if (/(operations|ops|revops|analyst)/.test(r)) return T.ops;
  return T.generic;
}

export default async function artifactsRoutes(app: FastifyInstance) {
  app.get("/api/artifacts", async (req): Promise<Artifact[]> => {
    const rows = await query<{ id: string; name: string; role: string; icon: string; goals: unknown }>(
      `SELECT id, name, role, icon, goals FROM agents WHERE org_id = $1 ORDER BY sort, created_at`,
      [orgId(req)],
    );
    return rows.map((a) => {
      const t = categorize(a.role);
      const goals = Array.isArray(a.goals) ? (a.goals as AgentGoal[]) : [];
      const goalKpis: ArtifactKPI[] = goals
        .filter((g) => g?.objective?.trim())
        .map((g) => ({ label: g.objective.trim(), target: g.metric?.trim() || undefined, hint: "From this agent's goals" }));
      return {
        id: a.id,
        agentId: a.id,
        agentName: a.name,
        role: a.role,
        department: t.department,
        kind: t.kind,
        icon: a.icon || t.icon,
        summary: t.summary,
        kpis: [...t.kpis, ...goalKpis],
        sections: t.sections,
      };
    });
  });
}
