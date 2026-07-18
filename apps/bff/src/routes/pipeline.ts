import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import { getSetting, setSetting } from "../lib/settingsStore.js";
import { agentInOrg } from "../lib/tenancy.js";

// ============================================================
// Clone pipeline — the whole preparation flow, unattended.
// Paste links → ready-for-review with zero human input: verify
// sources, learn the rep's style, clone the voice, watch the
// screen share, rebuild the demo flow from what the recording
// really shows, rehearse against the real customers, report.
// Runs as a fire-and-forget async loop inside the bff process,
// narrating plain-language progress into settings
// `pipeline:<agentId>` (the UI polls GET /api/pipeline/:agentId).
// Every stage is an ENSURE, not a DO — it checks whether its
// work already happened before doing it, so a restarted bff can
// re-POST /start and resume idempotently. All behavior goes
// through the SAME public endpoints the UI uses — never raw
// writes (persona extraction, voice clone, observe, enrich,
// playbook PUT, fidelity runs), matching fidelity.ts's pattern.
// ============================================================

const PORT = process.env.PORT || 8787;
const KEY = process.env.BFF_API_KEY || "";

async function api<T = any>(method: string, path: string, body?: unknown, timeoutMs = 120_000): Promise<{ status: number; json: T }> {
  // Content-Type only when a body rides along (Fastify 400s a bodyless POST
  // that claims application/json — same lesson fidelity.ts learned).
  const r = await fetch(`http://localhost:${PORT}${path}`, {
    method,
    headers: { "X-API-Key": KEY, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await r.json().catch(() => ({}))) as T;
  return { status: r.status, json };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type EventKind = "info" | "done" | "error";
type Stage = "ingest" | "voice" | "ground" | "blueprint" | "rehearse" | "done";
type PipelineEvent = { t: string; text: string; kind: EventKind };
type PipelineDoc = {
  state: "running" | "done" | "stuck" | "idle";
  stage: Stage;
  startedAt: string;
  updatedAt: string;
  events: PipelineEvent[];
};

const SETTINGS_KEY = (agentId: string) => `pipeline:${agentId}`;

async function loadDoc(org: string, agentId: string): Promise<PipelineDoc | null> {
  return getSetting<PipelineDoc>(org, SETTINGS_KEY(agentId));
}
async function saveDoc(org: string, agentId: string, doc: PipelineDoc): Promise<void> {
  await setSetting(org, SETTINGS_KEY(agentId), doc);
}

// One runner per agent per PROCESS. A doc that says "running" with no entry
// here is an orphan from a restart — /start may adopt and resume it.
const active = new Set<string>();

/** Thrown by a stage to halt the pipeline with state "stuck". */
class StuckError extends Error {}

class Runner {
  doc: PipelineDoc;
  private fails = new Map<string, number>(); // consecutive failures per step name

  constructor(private agentId: string, readonly org: string, resumed: PipelineDoc | null) {
    const now = new Date().toISOString();
    this.doc = resumed
      ? { ...resumed, state: "running", updatedAt: now }
      : { state: "running", stage: "ingest", startedAt: now, updatedAt: now, events: [] };
  }

  async event(text: string, kind: EventKind = "info"): Promise<void> {
    this.doc.events.push({ t: new Date().toISOString(), text, kind });
    if (this.doc.events.length > 100) this.doc.events = this.doc.events.slice(-100); // cap: oldest dropped
    this.doc.updatedAt = new Date().toISOString();
    await saveDoc(this.org, this.agentId, this.doc);
  }

  async setStage(stage: Stage): Promise<void> {
    this.doc.stage = stage;
    this.doc.updatedAt = new Date().toISOString();
    await saveDoc(this.org, this.agentId, this.doc);
  }

  async stuck(reason: string): Promise<never> {
    await this.event(reason, "error");
    this.doc.state = "stuck";
    this.doc.updatedAt = new Date().toISOString();
    await saveDoc(this.org, this.agentId, this.doc);
    throw new StuckError(reason);
  }

  /** Watchdog: run a step; on failure narrate the honest reason and retry once;
   *  two consecutive failures of the same step → stuck. NEVER a silent stall. */
  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        const out = await fn();
        this.fails.delete(name);
        return out;
      } catch (e) {
        if (e instanceof StuckError) throw e;
        const n = (this.fails.get(name) ?? 0) + 1;
        this.fails.set(name, n);
        const reason = (e as Error).message?.slice(0, 300) || "unknown error";
        if (n >= 2) await this.stuck(`Hit the same problem twice (${name}): ${reason}. Stopping here so you can take a look.`);
        await this.event(`Hit a snag (${name}): ${reason} — trying once more.`, "error");
        await sleep(15_000);
      }
    }
  }
}

// unwrap an api() call or throw the endpoint's honest error message
function expectOk<T>(r: { status: number; json: any }, what: string): T {
  if (r.status < 200 || r.status >= 300) throw new Error(`${what} failed (${r.status}): ${r.json?.error ?? "?"}`);
  return r.json as T;
}

type SourceRow = { id: string; title: string | null; url: string | null; chars: number };
type ObservedEntry = { sourceId: string; title: string; segments: number; turns: number };

async function runPipeline(app: FastifyInstance, agentId: string, org: string, run: Runner): Promise<void> {
  const label = (s: SourceRow) => `"${(s.title || s.id).slice(0, 70)}"`;

  // ---------------- ingest ----------------
  await run.setStage("ingest");
  const agent = await one<{ id: string; name: string; persona: any }>(`SELECT id, name, persona FROM agents WHERE id=$1 AND org_id=$2`, [agentId, org]);
  if (!agent) await run.stuck("This clone no longer exists — it may have been deleted.");
  const sources = await query<SourceRow>(
    `SELECT id, title, url, length(transcript) AS chars FROM clone_sources WHERE agent_id=$1 AND org_id=$2 AND kind='fathom_transcript' ORDER BY length(transcript) DESC`,
    [agentId, org],
  );
  if (!sources.length) {
    await run.stuck(`There are no calls to learn from yet — paste ${agent!.name}'s Fathom share links first, then start again.`);
  }
  await run.event(`Found ${sources.length} of ${agent!.name}'s calls to learn from.`);
  if (agent!.persona?.identity) {
    await run.event(`Already knows how ${agent!.name} talks — moving on.`, "done");
  } else {
    await run.event(`Reading the calls to learn how ${agent!.name} talks…`);
    const v = await run.step("learn-style", async () =>
      expectOk<{ version: { number: number } }>(await api("POST", `/api/clones/${agentId}/persona/extract`, {}, 15 * 60_000), "learning the style"),
    );
    await run.event(`Learned ${agent!.name}'s way of talking from the calls (take ${v.version?.number ?? 1}).`, "done");
  }

  // ---------------- voice ----------------
  await run.setStage("voice");
  const urlSources = sources.filter((s) => (s.url ?? "").trim());
  const realVoiceName = `${agent!.name} — real voice`;
  if (!urlSources.length) {
    await run.event("No recording link for the voice — using the picked library voice.", "done");
  } else {
    const opts = await api<{ voices?: { voice_id?: string; name?: string }[] }>("GET", "/api/voice/options");
    const existing = (opts.json?.voices ?? []).find((v) => (v.name || "") === realVoiceName);
    if (existing) {
      await run.event(`${agent!.name}'s real voice is already cloned — keeping it.`, "done");
    } else {
      await run.event("Cloning the voice from the call recording…");
      const vc = await run.step("clone-voice", async () =>
        expectOk<{ sampleSeconds?: number; warning?: string }>(await api("POST", "/api/fathom/clone-voice", { agentId }, 4 * 60_000), "cloning the voice"),
      );
      await run.event(`Voice cloned from ${vc.sampleSeconds ?? "~75"}s of ${agent!.name}'s real speech${vc.warning ? ` (note: ${vc.warning})` : ""}. Pick it in the voice list when you review.`, "done");
    }
  }

  // ---------------- ground ----------------
  await run.setStage("ground");
  const observedOf = async (): Promise<ObservedEntry[]> =>
    (await api<{ observed: ObservedEntry[] }>("GET", `/api/fathom/observed?agentId=${encodeURIComponent(agentId)}`)).json?.observed ?? [];
  if (!urlSources.length) {
    await run.event("No recording links to watch — skipping the screen-share step.", "done");
  } else {
    let seen = new Set((await observedOf()).map((o) => o.sourceId));
    for (const s of urlSources) {
      if (seen.has(s.id)) {
        await run.event(`Already watched the screen share from ${label(s)}.`, "done");
        continue;
      }
      await run.event(`Watching the screen share from ${label(s)} — this takes about 20 minutes…`);
      const obs = await run.step(`watch-${s.id}`, async () =>
        expectOk<{ segments: unknown[]; frames: number }>(
          await api("POST", "/api/fathom/observe-screens", { agentId, sourceId: s.id, shareUrl: s.url, maxFrames: 80 }, 45 * 60_000),
          "watching the screen share",
        ),
      );
      await run.event(`Finished watching ${label(s)} — ${obs.segments?.length ?? 0} screen moments mapped.`, "done");
      seen = new Set((await observedOf()).map((o) => o.sourceId));
    }
  }

  // ---------------- blueprint ----------------
  await run.setStage("blueprint");
  let pb = (await api<{ playbook: any }>("GET", `/api/clones/${agentId}/playbook`)).json?.playbook;
  if (!pb?.stages?.length) {
    // extraction auto-builds the storyboard in the background — give it a
    // moment, then build it ourselves from the longest call if it never lands.
    for (let w = 0; w < 12 && !pb?.stages?.length; w++) {
      await sleep(15_000);
      pb = (await api<{ playbook: any }>("GET", `/api/clones/${agentId}/playbook`)).json?.playbook;
    }
    if (!pb?.stages?.length) {
      await run.event("Building the demo flow from the longest call…");
      const drafted = await run.step("build-flow", async () =>
        expectOk<{ playbook: any }>(await api("POST", `/api/clones/${agentId}/playbook/from-transcript`, { sourceId: sources[0].id }, 10 * 60_000), "building the demo flow"),
      );
      drafted.playbook.graphVersion = 1;
      await run.step("save-flow", async () =>
        expectOk(await api("PUT", `/api/clones/${agentId}/playbook`, { playbook: drafted.playbook }), "saving the demo flow"),
      );
    }
    pb = (await api<{ playbook: any }>("GET", `/api/clones/${agentId}/playbook`)).json?.playbook;
    await run.event(`Demo flow ready — ${pb?.stages?.length ?? 0} steps drafted from the calls.`, "done");
  }
  const graphVersion = Number(pb?.graphVersion) || 1;
  const grounded = (await observedOf()).filter((o) => o.segments > 0);
  if (graphVersion > 1) {
    await run.event("Left your edited demo flow untouched — the recording's corrections are waiting in review.", "done");
  } else if (!grounded.length) {
    await run.event("No watched recording to check the demo flow against — keeping it as drafted.", "done");
  } else {
    const g = grounded.sort((a, b) => b.segments - a.segments)[0];
    await run.event("Rebuilding the demo flow around what the recording really shows…");
    const enriched = await run.step("reground-flow", async () =>
      expectOk<{ draft: any; corrections: unknown[] }>(await api("POST", "/api/fathom/enrich-playbook", { agentId, sourceId: g.sourceId }, 10 * 60_000), "checking the demo flow against the recording"),
    );
    enriched.draft.graphVersion = graphVersion + 1;
    await run.step("apply-flow", async () =>
      expectOk(await api("PUT", `/api/clones/${agentId}/playbook`, { playbook: enriched.draft }), "applying the corrected demo flow"),
    );
    await run.event(`Demo flow rebuilt from the recording — ${enriched.corrections?.length ?? 0} corrections applied.`, "done");
  }

  // ---------------- rehearse ----------------
  await run.setStage("rehearse");
  const rehearsable = (await observedOf()).filter((o) => o.turns > 1).sort((a, b) => b.turns - a.turns);
  let lastReport: any = null;
  if (!rehearsable.length) {
    await run.event("Nothing to rehearse against — no watched recording carries the customer's words.", "done");
  } else {
    const src = rehearsable[0];
    for (let round = 1; round <= 2; round++) {
      await run.event(`Rehearsing against their real customers (round ${round})…`);
      // A 409 means the room is busy (a real call, or another run). Real calls
      // always win: back off 5 minutes at a time, up to 12 hours, then stop.
      const t0 = Date.now();
      // undici gives up waiting for response headers after 5 minutes, but a
      // long rehearsal legitimately outlives that and keeps running server-side.
      // A socket that died AFTER surviving a while therefore means "stop
      // waiting on the wire, watch the saved report instead" (status 0);
      // an instant connection failure stays an error (status -1).
      const fire = async () => {
        const sent = Date.now();
        try {
          return await api("POST", "/api/fidelity/run", { agentId, sourceId: src.sourceId }, 90 * 60_000);
        } catch {
          return { status: Date.now() - sent > 60_000 ? 0 : -1, json: {} as any };
        }
      };
      let r = await fire();
      let toldWaiting = 0;
      while (r.status === 409) {
        if (Date.now() - t0 > 12 * 60 * 60_000) {
          await run.stuck("The room stayed busy for 12 hours — the rehearsal never got a turn. Start the pipeline again when the line is free.");
        }
        if (Date.now() - toldWaiting > 30 * 60_000) {
          await run.event("Waiting for the room to be free…");
          toldWaiting = Date.now();
        }
        await sleep(5 * 60_000);
        r = await fire();
      }
      const report = await run.step(`rehearse-${round}`, async () => {
        if (r.status !== 0) return expectOk<any>(r, "the rehearsal");
        const deadline = t0 + 90 * 60_000;
        while (Date.now() < deadline) {
          const rep = await getSetting<any>(org, `fidelity_report:${agentId}`);
          if (rep?.runAt && new Date(rep.runAt).getTime() >= t0) return rep;
          await sleep(15_000);
        }
        throw new Error("the rehearsal never wrote its report");
      });
      lastReport = report;
      const pct = Math.round((Number(report.avg) || 0) * 100);
      const fixes = Array.isArray(report.autoFixes) ? report.autoFixes.length : 0;
      if (report.aborted) {
        await run.event(`Rehearsal round ${round} was cut short: ${String(report.aborted).slice(0, 200)}.`, "error");
      } else {
        await run.event(`Rehearsal round ${round} done — sounded like the real ${agent!.name} ${pct}% of the time; ${fixes} automatic tweak${fixes === 1 ? "" : "s"} applied.`, "done");
      }
      if (round === 1 && !report.aborted && fixes === 0 && (Number(report.avg) || 0) >= 0.7) {
        await run.event("Close enough after one round — skipping the second rehearsal.", "done");
        break;
      }
    }
  }

  // ---------------- done ----------------
  await run.setStage("done");
  let summary = "Ready for review.";
  const readiness = await api<any>("GET", `/api/readiness/${agentId}`).catch(() => null);
  const score = readiness && readiness.status === 200 ? readiness.json?.score ?? readiness.json?.readiness : null;
  if (score != null) {
    summary = `Ready for review — Readiness score ${score}.`;
  } else {
    if (!lastReport) {
      lastReport = await getSetting<any>(org, `fidelity_report:${agentId}`);
    }
    if (lastReport?.avg != null) {
      summary = `Ready for review — sounded like the real ${agent!.name} ${Math.round(Number(lastReport.avg) * 100)}% of the time in rehearsal.`;
    }
  }
  await run.event(summary, "done");
  run.doc.state = "done";
  run.doc.updatedAt = new Date().toISOString();
  await saveDoc(org, agentId, run.doc);
  app.log.info({ agentId }, "pipeline: complete");
}

export default async function pipelineRoutes(app: FastifyInstance) {
  // Kick off (or resume) the clone-preparation pipeline for one agent.
  app.post("/api/pipeline/start", async (req, reply) => {
    const b = (req.body ?? {}) as { agentId?: string };
    const agentId = (b.agentId ?? "").trim();
    if (!agentId) return reply.code(400).send({ error: "agentId required" });
    if (active.has(agentId)) return reply.code(409).send({ error: "a pipeline is already running for this agent" });
    const org = orgId(req);
    if (!(await agentInOrg(agentId, org))) return reply.code(404).send({ error: "not found" });
    const agent = await one(`SELECT id FROM agents WHERE id=$1 AND org_id=$2`, [agentId, org]);
    if (!agent) return reply.code(404).send({ error: "agent not found" });

    // Adopt an orphaned "running" doc (bff restarted mid-run): keep its story,
    // note the resume, and let the ensure-stages fast-forward past done work.
    const prior = await loadDoc(org, agentId);
    const resumed = prior?.state === "running" ? prior : null;
    const run = new Runner(agentId, org, resumed);
    active.add(agentId);
    await saveDoc(org, agentId, run.doc);
    if (resumed) await run.event("Picking up where it left off after a restart.");
    else await run.event("Starting the clone preparation.");

    void (async () => {
      try {
        await runPipeline(app, agentId, org, run);
      } catch (e) {
        if (!(e instanceof StuckError)) {
          // truly unexpected — narrate honestly and mark stuck, never stall
          try {
            await run.event(`Something unexpected stopped the pipeline: ${(e as Error).message?.slice(0, 300)}`, "error");
            run.doc.state = "stuck";
            run.doc.updatedAt = new Date().toISOString();
            await saveDoc(org, agentId, run.doc);
          } catch { /* settings write failed too — nothing left to report to */ }
          app.log.error({ agentId, err: (e as Error).message }, "pipeline: unexpected failure");
        } else {
          app.log.warn({ agentId, reason: (e as Error).message }, "pipeline: stuck");
        }
      } finally {
        active.delete(agentId);
      }
    })();

    return reply.code(202).send({ ok: true });
  });

  // Current pipeline state for one agent ({state:"idle"} if none yet).
  app.get("/api/pipeline/:agentId", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const org = orgId(req);
    if (!(await agentInOrg(agentId, org))) return reply.code(404).send({ error: "not found" });
    const doc = await loadDoc(org, agentId);
    if (!doc) return { state: "idle" };
    // A run whose process died (deploy, crash) can never flip its own state —
    // present a long-silent "running" as stuck so the UI never lies. The
    // quietest legitimate stretch is the ~20-minute screen watch, so 45
    // minutes of silence means the loop is gone.
    if (doc.state === "running" && Date.now() - new Date(doc.updatedAt ?? 0).getTime() > 45 * 60_000) {
      return {
        ...doc,
        state: "stuck",
        events: [
          ...(doc.events ?? []),
          { t: new Date().toISOString(), kind: "error", text: "No heartbeat for 45 minutes — the run's process likely died (a restart mid-flight does this). Start it again; finished stages are kept and skipped." },
        ],
      };
    }
    return doc;
  });
}
