import type { CallPlaybook, CallStage } from "./index";

// Compiles a CallPlaybook (distilled from >=4 real call transcripts) into the
// live-call instruction text for the voice session. Output mirrors the proven
// "Maya" playbook shape: identity -> delivery -> absolute rules -> THE FLOW
// (numbered stages, each with voice + screen behavior) -> facts -> objections
// -> pricing -> closes -> hygiene.
//
// NOTE: apps/bff/src/routes/call.ts appends its own screen-share mechanics
// (show_on_screen tool usage, turn-taking) after this text — keep rules here
// consistent with that block and never contradict it.

const MAX_FACTS = 15;
const MAX_EXAMPLE_LINES = 2;
const MAX_OBJECTIONS = 10;

function stageBlock(s: CallStage, n: number): string {
  const lines: string[] = [];
  const screenNote =
    s.wireframe.archetype === "talk-only"
      ? "no screen change — conversation only"
      : `screen shows: ${s.wireframe.screenTitle}`;
  lines.push(`${n}. ${s.name.toUpperCase()} — ${s.goal} (${screenNote})`);
  if (s.voice.objective) lines.push(`   Voice: ${s.voice.objective}`);
  if (s.voice.moves.length) lines.push(`   Moves: ${s.voice.moves.join(" · ")}`);
  const ex = s.voice.exampleLines.slice(0, MAX_EXAMPLE_LINES).filter(Boolean);
  if (ex.length) lines.push(`   Say things like: ${ex.map((l) => `"${l}"`).join(" / ")}`);
  if (s.voice.listenFor.length) lines.push(`   Listen for: ${s.voice.listenFor.join(", ")}`);
  if (s.screen.actions.length) lines.push(`   Screen: ${s.screen.actions.join(" -> ")}`);
  if (s.screen.waitBehavior) lines.push(`   While the screen works: ${s.screen.waitBehavior}`);
  if (s.exitCriteria) lines.push(`   Move on when: ${s.exitCriteria}`);
  return lines.join("\n");
}

export function playbookToInstructions(
  pb: CallPlaybook,
  agentName: string,
  companyName: string
): string {
  const parts: string[] = [];

  parts.push(
    `You are ${agentName} — an AI teammate at ${companyName} on a LIVE call with a customer, running the call exactly the way the team's best rep runs it. This playbook was distilled from ${pb.sources.length} of their real recorded calls; follow the FLOW, never a canned script.`
  );

  parts.push(
    `VOICE & DELIVERY — a warm, upbeat human colleague, never a machine: natural contractions, varied pace, brief thinking pauses, small reactions ("oh nice", "mm-hm"), a smile in the voice. 1-2 short sentences, then stop and listen. Stop instantly if they speak. Engage genuinely with small talk when offered (~30 seconds).`
  );

  parts.push(
    `ABSOLUTE RULES:
- YOU control the screen. NEVER ask the customer to click or do anything on screen; never say you lack control.
- Never claim something happened on screen unless it is confirmed there.
- PROCESSING WAITS ARE NORMAL — when the product works for a while (loaders, building, searching), that is NOT a glitch: narrate what it's doing, teach something useful, or ask one discovery question. Never repeat an action because the screen looks busy.
- Only state facts from the FACTS list. Anything you don't know: "let me double-check with the team — I don't want to tell you something I'm not sure of."
- Be radically honest about fit and limitations — it builds trust and closes deals.`
  );

  const flow = pb.stages.map((s, i) => stageBlock(s, i + 1)).join("\n");
  parts.push(`THE FLOW (adapt to the conversation — stages can compress or reorder if the customer drives):\n${flow}`);

  if (pb.facts.length) {
    parts.push(`FACTS (the ONLY claims you may state as fact):\n${pb.facts.slice(0, MAX_FACTS).map((f) => `- ${f}`).join("\n")}`);
  }

  if (pb.objections.length) {
    parts.push(
      `OBJECTIONS:\n${pb.objections
        .slice(0, MAX_OBJECTIONS)
        .map((o) => `- If you hear "${o.objection}" -> ${o.response}`)
        .join("\n")}`
    );
  }

  if (pb.pricing) parts.push(`PRICING — tell it as a story, never read a rate card: ${pb.pricing}`);

  if (pb.closes.length) {
    parts.push(
      `CLOSE BY CUSTOMER TYPE (always end with a concrete next step and thank them by name):\n${pb.closes
        .map((c) => `- ${c.buyerType}: ${c.close}`)
        .join("\n")}`
    );
  }

  const dirs = (pb.directives ?? []).filter((d) => d && d.when && d.do && d.active !== false);
  if (dirs.length) {
    parts.push(
      `SITUATIONAL DIRECTIVES (operator coaching — act on these when the situation matches. They NEVER override your honesty, verify-before-claim, or tool rules: if a directive points at a screen, navigate and VERIFY it before describing it, exactly as always):\n${dirs
        .slice(0, 12)
        .map((d) => `- When ${d.when} -> ${d.do}${d.screen ? ` (bring up "${d.screen}" — goto('${d.screen}') if it is a mapped destination, else show_screen)` : ""}`)
        .join("\n")}`
    );
  }

  parts.push(
    `SPEAKING HYGIENE: default English; switch language only if clearly asked and keep replies extra short there. If you hear background media or side conversations not addressed to you — stay completely silent.`
  );

  return parts.join("\n\n");
}
