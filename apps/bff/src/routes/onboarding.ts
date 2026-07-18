import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import { getSetting } from "../lib/settingsStore.js";

// FIRST-RUN ONBOARDING CHECKLIST — the guided path a new self-serve user walks
// after signup: create org -> clone a rep -> rehearse -> hit 70 -> go live.
// Every step's done-state is DERIVED FROM REAL DATA (never a stored flag), so
// the checklist can't drift from reality: it reads the same tables the rest of
// the platform writes. Mounted on the roster/home surface for a fresh account.

const PORT = process.env.PORT || 8787;
const KEY = process.env.BFF_API_KEY || "";

// Reuse the authoritative readiness score (fused 0-100 + promoteUnlocked) rather
// than re-deriving the >=70 rule here — one source of truth for "hit 70".
async function readiness(agentId: string): Promise<{ score: number; promoteUnlocked: boolean } | null> {
  try {
    const r = await fetch(`http://localhost:${PORT}/api/readiness/${agentId}`, {
      headers: KEY ? { "X-API-Key": KEY } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { score?: number; promoteUnlocked?: boolean };
    return { score: typeof j.score === "number" ? j.score : 0, promoteUnlocked: !!j.promoteUnlocked };
  } catch {
    return null;
  }
}

type Step = {
  key: "org" | "clone" | "rehearse" | "score" | "live";
  label: string;
  detail: string;
  done: boolean;
  view: string; // pds view id the CTA navigates to
};

export default async function onboardingRoutes(app: FastifyInstance) {
  // GET /api/onboarding/checklist — the fresh-account guided checklist.
  app.get("/api/onboarding/checklist", async (req) => {
    const org = orgId(req);
    // --- 1. create org: THIS caller's own org exists (not "any org exists"),
    // else the company profile in this org's settings. ---
    let orgDone = false;
    const orgsReg = await one<{ reg: string | null }>(`SELECT to_regclass('orgs') AS reg`);
    if (orgsReg?.reg) {
      const ownOrg = await one<{ id: string }>(`SELECT id FROM orgs WHERE id = $1`, [org]);
      orgDone = !!ownOrg;
    }
    if (!orgDone) {
      const company = await getSetting<any>(org, "company");
      const name = company?.name ?? company?.company ?? "";
      orgDone = typeof name === "string" && name.trim().length > 0;
    }

    // --- clone corpus: agents + which have sources / a voice (this org only) ---
    const agents = await query<{ id: string; name: string; voice_id: string | null; golden_persona_id: string | null }>(
      `SELECT id, name, voice_id, golden_persona_id FROM agents WHERE org_id = $1`,
      [org],
    );
    const withSources = new Set(
      (await query<{ agent_id: string }>(`SELECT DISTINCT agent_id FROM clone_sources WHERE org_id = $1`, [org])).map((r) => r.agent_id),
    );

    // --- 2. clone a rep: at least one agent with real call sources AND a voice
    // (the wizard makes voice a required creation step). ---
    const clonedAgents = agents.filter((a) => withSources.has(a.id));
    const cloneDone = clonedAgents.some((a) => !!a.voice_id);

    // --- 3. rehearse: a calibration session, a rehearsal call, or a graded
    // rehearsal turn exists. ---
    const calib = await one<{ n: string }>(`SELECT count(*)::text AS n FROM calibration_sessions WHERE org_id = $1`, [org]);
    const rehCall = await one<{ n: string }>(`SELECT count(*)::text AS n FROM live_calls WHERE org_id = $1 AND mode = 'rehearsal'`, [org]);
    const grades = await one<{ n: string }>(`SELECT count(*)::text AS n FROM rehearsal_grades WHERE org_id = $1`, [org]);
    const rehearseDone =
      Number(calib?.n ?? 0) > 0 || Number(rehCall?.n ?? 0) > 0 || Number(grades?.n ?? 0) > 0;

    // --- 4. hit 70: any clone's fused readiness score >= 70 ---
    let bestScore = 0;
    let anyUnlocked = false;
    for (const a of clonedAgents.length ? clonedAgents : agents) {
      const r = await readiness(a.id);
      if (r) {
        if (r.score > bestScore) bestScore = r.score;
        if (r.promoteUnlocked) anyUnlocked = true;
      }
    }
    const scoreDone = bestScore >= 70;

    // --- 5. go live: a clone is promoted (golden pinned) OR a real (non-
    // rehearsal) live call has run. ---
    const promoted = agents.some((a) => !!a.golden_persona_id);
    const liveCall = await one<{ n: string }>(`SELECT count(*)::text AS n FROM live_calls WHERE org_id = $1 AND mode <> 'rehearsal'`, [org]);
    const liveDone = promoted || Number(liveCall?.n ?? 0) > 0;

    const steps: Step[] = [
      {
        key: "org",
        label: "Set up your workspace",
        detail: "Name your company so your clone knows who it represents.",
        done: orgDone,
        view: "company",
      },
      {
        key: "clone",
        label: "Clone a rep",
        detail: "Add a top performer's recorded calls, pick a voice, point it at your demo system.",
        done: cloneDone,
        view: "clonerep",
      },
      {
        key: "rehearse",
        label: "Rehearse",
        detail: "Run the clone against a real call in the Calibration Room and coach it.",
        done: rehearseDone,
        view: "rehearsal",
      },
      {
        key: "score",
        label: "Reach 70 readiness",
        detail:
          bestScore > 0 && !scoreDone
            ? `Best clone is ${bestScore}% ready — 70 unlocks live calls.`
            : "Score the clone against the real call until it clears 70.",
        done: scoreDone,
        view: "readiness",
      },
      {
        key: "live",
        label: "Go live",
        detail: anyUnlocked && !liveDone
          ? "You're cleared — promote and run your first real call."
          : "Promote the clone and let it take a real call.",
        done: liveDone,
        view: "precall",
      },
    ];

    const doneCount = steps.filter((s) => s.done).length;
    const next = steps.find((s) => !s.done) ?? null;

    return {
      fresh: agents.length === 0,
      complete: doneCount === steps.length,
      doneCount,
      total: steps.length,
      nextKey: next?.key ?? null,
      steps,
    };
  });
}
