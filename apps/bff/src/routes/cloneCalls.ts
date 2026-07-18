import type { FastifyInstance } from "fastify";
import { orgId } from "../lib/auth.js";
import { getCompany } from "./company.js";
import { startJob, getJob } from "../lib/callplaybookJobs.js";
import { playbookToInstructions } from "@jarvis/shared";
import type { CallPlaybook, CallSource } from "@jarvis/shared";

// Clone-from-calls: turn >=4 pasted call transcripts into a CallPlaybook, and
// compile an approved playbook into live-call instructions.
export default async function cloneCallsRoutes(app: FastifyInstance) {
  // Start analysis. Returns a jobId; poll the GET below.
  app.post("/api/agents/clone-calls/analyze", async (req, reply) => {
    const b = (req.body ?? {}) as { sources?: CallSource[]; role?: string; agentName?: string };
    const sources = Array.isArray(b.sources) ? b.sources : [];
    const ready = sources.filter((s) => (s?.transcript ?? "").trim().length > 500);
    if (ready.length < 4) {
      return reply.code(400).send({ error: "Provide at least 4 call transcripts (each over 500 characters)." });
    }
    const company = await getCompany(orgId(req));
    const jobId = startJob(ready, {
      org: orgId(req),
      role: (b.role ?? "").trim() || "Account Executive",
      agentName: (b.agentName ?? "").trim() || "the agent",
      companyName: company.name || "the company",
    });
    return reply.code(202).send({ jobId });
  });

  // Poll job status (phase/pct/perSource/error/playbook).
  app.get("/api/agents/clone-calls/analyze/:jobId", async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const status = await getJob(orgId(req), jobId);
    if (!status) return reply.code(404).send({ error: "job not found" });
    return status;
  });

  // Preview the compiled instructions for a playbook (used for testing and for
  // showing the operator what will be deployed).
  app.post("/api/agents/clone-calls/compile", async (req, reply) => {
    const b = (req.body ?? {}) as { playbook?: CallPlaybook; agentName?: string };
    if (!b.playbook || !Array.isArray(b.playbook.stages)) {
      return reply.code(400).send({ error: "playbook is required" });
    }
    const company = await getCompany(orgId(req));
    const instructions = playbookToInstructions(b.playbook, (b.agentName ?? "").trim() || "the agent", company.name || "the company");
    return { instructions };
  });
}
