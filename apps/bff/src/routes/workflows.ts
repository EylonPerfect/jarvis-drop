import type { FastifyInstance } from "fastify";
import { one } from "../db/pool.js";
import { hermes } from "../hermes.js";
import type { Workflow, WorkflowRun } from "@jarvis/shared";

// Workflows map to hermes scheduled jobs (/api/jobs). When the gateway is
// reachable we surface live jobs; otherwise the seeded flows render.
export default async function workflowsRoutes(app: FastifyInstance) {
  app.get("/api/workflows", async () => {
    const live = await hermes.get<any>("/api/jobs");
    const jobs = Array.isArray(live.data) ? live.data : live.data?.jobs;
    if (live.ok && Array.isArray(jobs) && jobs.length) {
      const flows: Workflow[] = jobs.map((j: any, i: number) => ({
        id: j.id ?? `wf_${i}`,
        jobId: j.id,
        name: j.name ?? j.title ?? "Job",
        trigger: j.schedule ?? j.cron ?? j.trigger ?? "",
        status: j.paused || j.enabled === false ? "Paused" : "Enabled",
        steps: Array.isArray(j.steps)
          ? j.steps.map((s: any) => ({ icon: s.icon ?? "workflow", label: s.label ?? s.name ?? "step" }))
          : [{ icon: "workflow", label: j.prompt ? String(j.prompt).slice(0, 40) : "run" }],
      }));
      return flows;
    }
    const seeded = (await one<{ value: Workflow[] }>(`SELECT value FROM settings WHERE key = 'workflows'`))?.value ?? [];
    return seeded;
  });

  app.get("/api/workflows/runs", async (): Promise<WorkflowRun[]> => {
    const seeded = (await one<{ value: WorkflowRun[] }>(`SELECT value FROM settings WHERE key = 'workflow_runs'`))?.value ?? [];
    return seeded;
  });

  app.get("/api/workflows/stats", async () => {
    const flows = (await one<{ value: Workflow[] }>(`SELECT value FROM settings WHERE key = 'workflows'`))?.value ?? [];
    const enabled = flows.filter((f) => f.status === "Enabled").length;
    return { workflows: flows.length, enabled, paused: flows.length - enabled, runsPerWeek: 28 };
  });

  // Control a hermes job. No-op-friendly when the gateway is offline.
  app.post("/api/workflows/:id/:action", async (req, reply) => {
    const { id, action } = req.params as { id: string; action: string };
    if (!["run", "pause", "resume"].includes(action)) {
      return reply.code(400).send({ error: "invalid action" });
    }
    // Reject path-traversal / encoded-slash ids before interpolating into the
    // internal hermes URL (defense against SSRF-shaped path escapes).
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const r = await hermes.post(`/api/jobs/${encodeURIComponent(id)}/${action}`);
    if (!r.ok) return reply.code(502).send({ error: r.error ?? "hermes unreachable", action });
    return { ok: true, action, data: r.data };
  });
}
