import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import { agentInOrg } from "../lib/tenancy.js";
import { getActiveProvider, completeProviderChat, cheapModel } from "../lib/providers.js";
import { pushPersonaReload, pushGuideNudge } from "./live.js";
import { agentRow, currentPersona, playbookOf, saveVersion, recompileGolden } from "./studio.js";
import type { PersonaSpec, CallPlaybook, ConditionalDirective } from "@jarvis/shared";

// COACHING ALTITUDE — one plain-language instruction, routed by an LLM
// classifier to the right persistence layer(s): persona rule · style slider
// delta · few-shot (when a moment is anchored) · beat edit · NEW conditional
// directive (playbook.directives — compiled as SITUATIONAL DIRECTIVES; the
// compiler states they never override honesty/verify rules). Everything lands
// as the usual machinery: persona changes = ONE new version; playbook changes
// = graphVersion++ + golden recompile; a running session gets a hot persona
// reload AND an immediate guide nudge.

type CoachAction =
  | { type: "rule"; text: string }
  | { type: "style"; changes: Record<string, number> }
  | { type: "few_shot"; situation: string; human_response: string }
  | { type: "beat_edit"; beatIndex: number; voiceObjective?: string; addExampleLine?: string; screenActions?: string[]; waitBehavior?: string }
  | { type: "directive"; when: string; do: string; screen?: string };

function extractJson<T>(text: string): T | null {
  let t = (text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)) as T; } catch { return null; }
}

export default async function coachRoutes(app: FastifyInstance) {
  app.post("/api/coach", async (req, reply) => {
    const b = (req.body ?? {}) as { agentId?: string; text?: string; moment?: { guest?: string; maya?: string } };
    const text = (b.text ?? "").trim();
    if (!b.agentId || !text) return reply.code(400).send({ error: "agentId and text required" });
    const org = orgId(req);
    // Ownership gate: once the agent is confirmed in this org, the agentId-keyed
    // studio helpers (agentRow/saveVersion/recompileGolden) act on the org's own agent.
    if (!(await agentInOrg(b.agentId, org))) return reply.code(404).send({ error: "agent not found" });
    const agent = await agentRow(b.agentId);
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    const provider = await getActiveProvider(org);
    if (!provider) return reply.code(400).send({ error: "no AI provider connected — set one in AI Core" });

    const spec = await currentPersona(org, agent);
    const pb = playbookOf(agent);
    const beats = (pb?.stages ?? []).map((s, i) => `${i + 1}. ${s.name}`).join(" · ") || "(no beat sheet)";
    // screens the classifier may reference: mapped goto keys + show_screen names
    let screenKeys: string[] = ["home", "position", "outreach"];
    try {
      const sm = await one<any>(`SELECT value FROM settings WHERE org_id=$1 AND key='site_map'`, [org]);
      if (Array.isArray(sm?.value?.destinations)) screenKeys = [...new Set([...sm.value.destinations.map((d: any) => String(d.key)), ...screenKeys])];
    } catch { /* defaults */ }

    const sys =
      `You route ONE operator coaching instruction for an AI sales rep into concrete, persistent changes. Choose the SMALLEST set of actions (usually one). Return ONLY JSON: ` +
      `{"summary":str,"actions":[` +
      `{"type":"rule","text":str} | ` +
      `{"type":"style","changes":{"formality"?:0..1,"verbosity"?:0..1,"assertiveness"?:0..1,"warmth"?:0..1,"humor"?:0..1,"proactivity"?:0..1}} | ` +
      `{"type":"few_shot","situation":str,"human_response":str} | ` +
      `{"type":"beat_edit","beatIndex":int(1-based),"voiceObjective"?:str,"addExampleLine"?:str,"screenActions"?:[str],"waitBehavior"?:str} | ` +
      `{"type":"directive","when":str,"do":str,"screen"?:str}` +
      `]}. ` +
      `ROUTING: permanent behavior/tone -> rule. Tone dials -> style (small deltas from CURRENT). "In this situation say/do X" WITH an anchored moment -> few_shot (situation = the guest line). Changes to a SPECIFIC beat's talk track or screen steps -> beat_edit. Conditional "when X happens, do Y" (especially involving showing a screen) -> directive; set screen ONLY from this list: ${screenKeys.join(", ")}. Directives must never weaken honesty or verification.`;
    const user =
      `CURRENT STYLE: ${JSON.stringify(spec.style)}\nBEATS: ${beats}\n` +
      (b.moment?.guest || b.moment?.maya ? `ANCHORED MOMENT — guest: ${b.moment?.guest ?? ""} | rep said: ${b.moment?.maya ?? ""}\n` : "") +
      `COACHING INSTRUCTION: ${text}`;

    let parsed: { summary?: string; actions?: CoachAction[] } | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await completeProviderChat(provider, [{ role: "system", content: sys }, { role: "user", content: user }], { model: cheapModel(provider), kind: "coach" });
      parsed = r.ok ? extractJson<{ summary?: string; actions?: CoachAction[] }>(r.content) : null;
      if (parsed && Array.isArray(parsed.actions) && parsed.actions.length) break;
      parsed = null;
      if (attempt < 3) await new Promise((res) => setTimeout(res, attempt === 1 ? 800 : 2500));
    }
    if (!parsed) return reply.code(502).send({ error: "could not classify the instruction — try rephrasing it" });

    // ---- apply: persona actions batch into ONE version; playbook actions into ONE update ----
    const appliedAs: string[] = [];
    const next: PersonaSpec = JSON.parse(JSON.stringify(spec));
    let personaTouched = false;
    let pbNext: CallPlaybook | null = pb ? (JSON.parse(JSON.stringify(pb)) as CallPlaybook) : null;
    let pbTouched = false;

    for (const a of parsed.actions ?? []) {
      if (a.type === "rule" && a.text) {
        next.behaviors.rules.push({ id: `r${next.behaviors.rules.length + 1}`, text: String(a.text), source: "coach", active: true });
        appliedAs.push("behavior rule"); personaTouched = true;
      } else if (a.type === "style" && a.changes && typeof a.changes === "object") {
        for (const [k, v] of Object.entries(a.changes)) {
          if (typeof v === "number" && k in next.style) (next.style as unknown as Record<string, number>)[k] = Math.max(0, Math.min(1, v));
        }
        appliedAs.push("style sliders"); personaTouched = true;
      } else if (a.type === "few_shot" && a.situation && a.human_response) {
        next.few_shots.push({ id: `f${next.few_shots.length + 1}`, situation: String(a.situation), human_response: String(a.human_response), source: "coach", active: true });
        appliedAs.push("few-shot"); personaTouched = true;
      } else if (a.type === "beat_edit" && pbNext && Number.isFinite(a.beatIndex)) {
        const i = Math.min(Math.max(1, a.beatIndex), pbNext.stages.length) - 1;
        const st = pbNext.stages[i] as any;
        if (a.voiceObjective) st.voice.objective = String(a.voiceObjective);
        if (a.addExampleLine) st.voice.exampleLines = [...(st.voice.exampleLines ?? []), String(a.addExampleLine)];
        if (Array.isArray(a.screenActions)) st.screen.actions = a.screenActions.map(String).filter(Boolean);
        if (a.waitBehavior) st.screen.waitBehavior = String(a.waitBehavior);
        appliedAs.push(`beat ${i + 1} edit`); pbTouched = true;
      } else if (a.type === "directive" && a.when && a.do && pbNext) {
        const dirs: ConditionalDirective[] = Array.isArray(pbNext.directives) ? pbNext.directives : [];
        const screen = a.screen && screenKeys.includes(String(a.screen)) ? String(a.screen) : undefined;
        dirs.push({ id: `dir${dirs.length + 1}`, when: String(a.when), do: String(a.do), ...(screen ? { screen } : {}), source: "coach", active: true });
        pbNext.directives = dirs;
        appliedAs.push(`directive${screen ? ` (→ ${screen})` : ""}`); pbTouched = true;
      }
    }
    if (!appliedAs.length) return reply.code(502).send({ error: "the classifier produced no applicable change — try being more specific" });

    let personaVersion: number | undefined;
    if (personaTouched) {
      const v = await saveVersion(b.agentId, next, `Coach: ${parsed.summary || text.slice(0, 60)}`, "coach");
      personaVersion = v.number;
    }
    let graphVersion: number | undefined;
    if (pbTouched && pbNext) {
      graphVersion = (Number((pbNext as unknown as Record<string, unknown>).graphVersion) || 1) + 1;
      (pbNext as unknown as Record<string, unknown>).graphVersion = graphVersion;
      (pbNext as unknown as Record<string, unknown>).lastFix = { summary: parsed.summary ?? text, at: new Date().toISOString(), source: "coach" };
      await query(`UPDATE agents SET playbook = $2 WHERE id = $1 AND org_id = $3`, [b.agentId, JSON.stringify({ kind: "calls", callPlaybook: pbNext }), org]);
      await recompileGolden(org, b.agentId);
    }
    void pushPersonaReload(org, b.agentId); // hot-reload a running session
    const nudged = await pushGuideNudge(org, b.agentId, `COACHING (applies right now): ${parsed.summary || text}`).catch(() => false);

    app.log.info({ agentId: b.agentId, appliedAs, personaVersion, graphVersion }, "coach instruction applied");
    return {
      appliedAs,
      summary: parsed.summary || text.slice(0, 80),
      ...(personaVersion !== undefined ? { personaVersion } : {}),
      ...(graphVersion !== undefined ? { graphVersion } : {}),
      toldLive: !!nudged,
    };
  });
}
