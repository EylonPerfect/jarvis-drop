import type { FastifyInstance } from "fastify";
import { orgId } from "../lib/auth.js";
import { getActiveProvider, completeProviderChat } from "../lib/providers.js";

// ── PITCH-ME-NOW: live mock sales call ───────────────────────────────────────
// The no-notetaker path to a clone. The user (the rep being cloned) PITCHES; the
// AI plays a realistic, skeptical PROSPECT. The front-end accumulates the turns
// into a transcript and, on finish, feeds it to the existing clone-from-calls
// extraction (POST /api/clones/:id/sources + /persona/extract) to draft a clone.
// This endpoint only produces the prospect's next line — it is stateless (the
// client resends the full history each turn), mirroring /api/agents/discover.

function parseJson<T = any>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { /* fall through */ }
  const a = text.indexOf("{"); const b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)) as T; } catch { /* nope */ } }
  return null;
}

// Scripted skeptical-buyer fallback when no AI provider is configured.
const FALLBACK: string[] = [
  "Hi — I run the team here, so you've got my attention for a few minutes. What are you pitching me?",
  "Okay, but honestly — how is that different from what we already use?",
  "What does it actually cost? I'll tell you straight, budget is tight this year.",
  "My team already has too many tools they don't log into. Why would they adopt this one?",
  "What proof do you have that it works? Any real results I could point my boss to?",
  "Alright, you've got me curious. If I wanted to try it, what's the concrete next step?",
];

export default async function mockcallRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/mockcall/reply — the prospect's next line.
  // body: { history?: {role:"user"|"assistant", content:string}[], repName?, product? }
  //   role "user"      = the rep (the person being cloned)
  //   role "assistant" = the prospect (this endpoint's prior replies)
  // returns: { reply: string, done: boolean, turns: number }
  app.post("/api/mockcall/reply", async (req) => {
    const b = (req.body ?? {}) as { history?: Array<{ role: string; content: string }>; repName?: string; product?: string };
    const history = Array.isArray(b?.history) ? b.history.filter((m) => m && typeof m.content === "string" && m.content.trim()) : [];
    const repName = (b?.repName ?? "").trim();
    const product = (b?.product ?? "").trim();
    const turns = history.filter((m) => m.role === "user").length; // how many times the rep has spoken

    const sys =
      `You are a realistic B2B buyer on a LIVE sales call — a busy, sharp VP-level decision-maker evaluating a real purchase. ` +
      `A sales rep${repName ? ` named ${repName}` : ""} is pitching you${product ? ` on ${product}` : ""}. ` +
      `Stay 100% in character as the PROSPECT at all times: never coach the rep, never break character, never say or imply you are an AI, never narrate. ` +
      `Be skeptical but fair. Let the REP drive the conversation. Each turn, react like a real buyer: ask ONE pointed question OR raise ONE realistic objection — pricing/budget, "we already use X", team adoption/change-management, ROI/proof, timing, or integration. One thing at a time; do not pile on. ` +
      `If the rep handles it well, acknowledge briefly and either move on or surface the next natural concern. Keep every reply SHORT and human — 1–3 sentences, contractions, no bullet points. ` +
      `After roughly 5–8 exchanges — or as soon as the rep proposes a concrete next step (pilot, follow-up, demo) — accept a next step and wrap the call warmly. ` +
      `Return ONLY minified JSON, no markdown: {"reply":<your next spoken line as the prospect>,"done":<true once the call has naturally concluded (a next step is agreed or you've covered enough), else false>}. ` +
      `If there is no rep message yet, "reply" is a brief in-character opener that invites the pitch (e.g. greet, say you have a few minutes, ask what they've got).`;

    const convo = history.length
      ? history.map((m) => `${m.role === "assistant" ? "PROSPECT" : "REP"}: ${m.content}`).join("\n")
      : "(the call just connected — no rep message yet)";

    const active = await getActiveProvider(orgId(req));
    if (active) {
      try {
        const r = await completeProviderChat(active, [
          { role: "system", content: sys },
          { role: "user", content: `Conversation so far:\n${convo}\n\nThe rep has spoken ${turns} time(s). Give the prospect's next line now.` },
        ], { kind: "mockcall" });
        const j = r.ok && r.content ? parseJson<{ reply?: string; done?: boolean }>(r.content) : null;
        if (j && typeof j.reply === "string" && j.reply.trim()) {
          return { reply: j.reply.trim(), done: !!j.done || turns >= 12, turns };
        }
      } catch { /* fall through to scripted buyer */ }
    }

    const idx = Math.min(turns, FALLBACK.length - 1);
    return { reply: FALLBACK[idx], done: turns >= FALLBACK.length - 1, turns };
  });

  // POST /api/mockcall/generate — no recordings? Ava DRAFTS a realistic sample
  // call transcript from the rep's role + company, to seed the clone. body:
  // { name?, role?, company? } → { transcript }. The FE then runs the existing
  // create-agent → sources → persona/extract path on it.
  app.post("/api/mockcall/generate", async (req, reply) => {
    const b = (req.body ?? {}) as { name?: string; role?: string; company?: string; product?: string };
    const name = (b.name ?? "").trim() || "The rep";
    const role = (b.role ?? "").trim() || "Account Executive";
    const company = (b.company ?? b.product ?? "").trim();
    const active = await getActiveProvider(orgId(req));
    if (!active) return reply.code(502).send({ error: "no AI provider configured" });
    const sys = "You write realistic B2B sales-call transcripts used as training data to clone a rep's talk track and style. Output ONLY the transcript text as labelled turns — no preamble, no markdown, no headings.";
    const user =
      `Write a realistic ~5-minute discovery-and-demo sales call transcript for a strong ${role}` +
      (company ? ` selling ${company}` : "") + `. The rep is ${name}. ` +
      `Structure the call: (1) a warm discovery open with 2-3 real questions BEFORE pitching, (2) a crisp value pitch tied to what the buyer said, (3) the rep handling 2-3 realistic objections (pricing/budget, an incumbent competitor, and team-adoption or ROI/proof), (4) a concrete next-step close. ` +
      `Label EVERY turn exactly like "${name}: <line>" for the rep and "Prospect: <line>" for the buyer. ` +
      `Make the rep's lines rich, specific, and human — natural signature phrases, genuine objection-handling, a distinct voice — because a clone will learn their style from this. 2000-3000 characters.`;
    try {
      const r = await completeProviderChat(active, [{ role: "system", content: sys }, { role: "user", content: user }], { kind: "mockcall_gen" });
      const transcript = ((r.ok && r.content) || "").trim();
      if (transcript.length < 200) return reply.code(502).send({ error: "generation produced too little — try again" });
      return { transcript };
    } catch (e) {
      return reply.code(502).send({ error: "generation failed: " + (e instanceof Error ? e.message : String(e)) });
    }
  });
}
