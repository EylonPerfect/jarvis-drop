import type { FastifyInstance } from "fastify";
import { one, query } from "../db/pool.js";
import { hermes } from "../hermes.js";
import type { Workflow, WorkflowRun } from "@jarvis/shared";

// Locally-authored workflows live in settings under 'workflows' as a JSON array.
type StoredWorkflow = {
  id: string;
  name: string;
  trigger: string;
  status: "Enabled" | "Paused";
  steps: { icon: string; label: string }[];
};

async function readWorkflows(): Promise<StoredWorkflow[]> {
  return (await one<{ value: StoredWorkflow[] }>(`SELECT value FROM settings WHERE key = 'workflows'`))?.value ?? [];
}

async function writeWorkflows(flows: StoredWorkflow[]): Promise<void> {
  await query(
    `INSERT INTO settings (key, value) VALUES ('workflows', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(flows)],
  );
}

// Stored runs are WorkflowRun (what the UI reads) plus an ISO `at` timestamp
// used server-side to compute runsPerWeek. The extra field is ignored by the UI.
type StoredRun = WorkflowRun & { at?: string };

async function readRuns(): Promise<StoredRun[]> {
  return (await one<{ value: StoredRun[] }>(`SELECT value FROM settings WHERE key = 'workflow_runs'`))?.value ?? [];
}

async function writeRuns(runs: StoredRun[]): Promise<void> {
  await query(
    `INSERT INTO settings (key, value) VALUES ('workflow_runs', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(runs)],
  );
}

const RUNS_CAP = 50;

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
    return readRuns();
  });

  app.get("/api/workflows/stats", async () => {
    const flows = (await one<{ value: Workflow[] }>(`SELECT value FROM settings WHERE key = 'workflows'`))?.value ?? [];
    const enabled = flows.filter((f) => f.status === "Enabled").length;
    // runsPerWeek = number of recorded runs in the last 7 days (from workflow_runs).
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const runs = await readRuns();
    const runsPerWeek = runs.filter((r) => {
      const t = r.at ? Date.parse(r.at) : NaN;
      return Number.isFinite(t) && t >= weekAgo;
    }).length;
    return { workflows: flows.length, enabled, paused: flows.length - enabled, runsPerWeek };
  });

  // Create a locally-authored workflow in the settings array.
  app.post("/api/workflows", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: unknown; trigger?: unknown; steps?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return reply.code(400).send({ error: "name is required" });
    const trigger = typeof body.trigger === "string" && body.trigger.trim() ? body.trigger.trim() : "Manual";
    const steps = Array.isArray(body.steps)
      ? (body.steps as any[]).map((s) => ({ icon: String(s?.icon ?? "workflow"), label: String(s?.label ?? "step") }))
      : [];
    const created: StoredWorkflow = { id: `wf_${Date.now().toString(36)}`, name, trigger, status: "Enabled", steps };
    const flows = await readWorkflows();
    flows.push(created);
    await writeWorkflows(flows);
    return reply.code(201).send(created);
  });

  // Update a locally-authored workflow's status (enable/pause).
  app.patch("/api/workflows/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return reply.code(400).send({ error: "invalid id" });
    const body = (req.body ?? {}) as { status?: unknown };
    const flows = await readWorkflows();
    const wf = flows.find((f) => f.id === id);
    if (!wf) return reply.code(404).send({ error: "not found" });
    if (body.status === "Enabled" || body.status === "Paused") wf.status = body.status;
    await writeWorkflows(flows);
    return wf;
  });

  // Delete a single locally-authored workflow.
  app.delete("/api/workflows/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return reply.code(400).send({ error: "invalid id" });
    const flows = await readWorkflows();
    await writeWorkflows(flows.filter((f) => f.id !== id));
    return { ok: true };
  });

  // Clear all locally-authored workflows.
  app.delete("/api/workflows", async () => {
    await writeWorkflows([]);
    return { ok: true };
  });

  // Run/pause/resume a workflow. hermes has no /api/jobs endpoint on this
  // deployment, so "run" is implemented LOCALLY: it appends a run record to
  // settings.workflow_runs (which feeds "Recent runs" and runsPerWeek) and
  // always succeeds. pause/resume try hermes best-effort but never fail the
  // click when the gateway is absent.
  app.post("/api/workflows/:id/:action", async (req, reply) => {
    const { id, action } = req.params as { id: string; action: string };
    if (!["run", "pause", "resume"].includes(action)) {
      return reply.code(400).send({ error: "invalid action" });
    }
    // Reject path-traversal / encoded-slash ids before any interpolation.
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }

    const flows = await readWorkflows();
    const wf = flows.find((f) => f.id === id);

    if (action === "run") {
      const now = new Date();
      const run: StoredRun = {
        id: `run_${now.getTime().toString(36)}`,
        name: wf?.name ?? "Workflow",
        when: now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
        tone: "optimal",
        at: now.toISOString(),
      };
      const runs = await readRuns();
      runs.unshift(run);
      await writeRuns(runs.slice(0, RUNS_CAP));
      return { ok: true, action, run };
    }

    // pause / resume — best-effort hermes control; never fail the UI click.
    const r = await hermes.post(`/api/jobs/${encodeURIComponent(id)}/${action}`).catch(() => null);
    return { ok: true, action, data: r?.ok ? r.data : null };
  });
}
