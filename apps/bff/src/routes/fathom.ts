import type { FastifyInstance } from "fastify";
import { mkdtempSync, openSync, writeSync, closeSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getIntegrationValues, getIntegrationSource } from "./integrations.js";
import { bustVoiceCache } from "./voice.js";
import { getCompany } from "./company.js";
import { query, one } from "../db/pool.js";
import { orgId, newId } from "../lib/auth.js";
import { agentInOrg } from "../lib/tenancy.js";
import { observeScreens, providerChatJson, type ObservedSegment } from "../lib/callVision.js";

const execF = promisify(execFile);

// Fathom note-taker calls as first-class clone sources. Uses the official
// Fathom API (developers.fathom.ai, X-Api-Key header) through the existing
// "notetaker" integration slot (provider fathom + apiKey). The clone wizard
// lists the account's calls and ingests full transcripts server-side — no
// manual pasting. Field names are normalized defensively because the API
// payload has shifted across versions.
const BASE = "https://api.fathom.ai/external/v1";

type FMeeting = Record<string, unknown>;

async function fathomKey(org: string): Promise<string | null> {
  const v = await getIntegrationValues(org, "notetaker");
  const key = v?.apiKey?.trim();
  if (!key) return null;
  const provider = (v?.provider || "fathom").toLowerCase();
  return provider.includes("fathom") ? key : null;
}

function str(m: FMeeting, ...keys: string[]): string {
  for (const k of keys) {
    const v = m[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

function normalize(m: FMeeting) {
  const id = str(m, "recording_id", "id", "url", "share_url");
  const title = str(m, "meeting_title", "title", "name") || "Fathom call";
  const when = str(m, "recording_start_time", "scheduled_start_time", "created_at", "date");
  const startMs = Date.parse(str(m, "recording_start_time", "scheduled_start_time"));
  const endMs = Date.parse(str(m, "recording_end_time", "scheduled_end_time"));
  const durationMins = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? Math.round((endMs - startMs) / 60000) : null;
  return { id, title, when, durationMins };
}

function transcriptText(m: FMeeting): string {
  const t = (m as { transcript?: unknown }).transcript;
  if (typeof t === "string") return t;
  const segs = Array.isArray(t) ? t : t && typeof t === "object" && Array.isArray((t as { segments?: unknown[] }).segments) ? (t as { segments: unknown[] }).segments : null;
  if (!segs) return "";
  return segs.map((s) => {
    const seg = s as Record<string, unknown>;
    const sp = seg.speaker as Record<string, unknown> | string | undefined;
    const who = (typeof sp === "object" && sp ? (sp.display_name as string) : typeof sp === "string" ? sp : "") || (seg.speaker_name as string) || "Speaker";
    const text = (seg.text as string) ?? (seg.transcript as string) ?? "";
    return `${who}: ${text}`;
  }).filter((l) => l.trim().length > 2).join("\n");
}

async function listPage(key: string, cursor?: string, includeTranscript = false): Promise<{ items: FMeeting[]; nextCursor: string | null }> {
  const u = new URL(`${BASE}/meetings`);
  if (includeTranscript) u.searchParams.set("include_transcript", "true");
  if (cursor) u.searchParams.set("cursor", cursor);
  const r = await fetch(u, { headers: { "X-Api-Key": key } });
  if (!r.ok) throw new Error(`Fathom API ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j = (await r.json()) as Record<string, unknown>;
  const items = (Array.isArray(j.items) ? j.items : Array.isArray(j.meetings) ? j.meetings : Array.isArray(j.data) ? j.data : []) as FMeeting[];
  const nextCursor = ((j.next_cursor ?? j.nextCursor ?? null) as string | null) || null;
  return { items, nextCursor };
}

// ---- share-link ingestion (no API key): read the public share page ----

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
}

// Recursively hunt any JSON value for an array of transcript segments —
// objects that carry both a speaker-ish and a text-ish field.
function huntSegments(v: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 8 || v == null) return null;
  if (Array.isArray(v)) {
    const objs = v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
    if (objs.length >= 5) {
      const looks = objs.filter((o) => {
        const hasText = typeof o.text === "string" || typeof o.transcript === "string" || typeof o.words === "string";
        const hasWho = "speaker" in o || "speaker_name" in o || "display_name" in o || "speaker_display_name" in o;
        return hasText && hasWho;
      });
      if (looks.length >= Math.max(3, objs.length * 0.5)) return looks;
    }
    for (const x of v) { const r = huntSegments(x, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof v === "object") {
    for (const val of Object.values(v as Record<string, unknown>)) { const r = huntSegments(val, depth + 1); if (r) return r; }
  }
  return null;
}

function segsToText(segs: Record<string, unknown>[]): string {
  return segs.map((seg) => {
    const sp = seg.speaker as Record<string, unknown> | string | undefined;
    const who = (typeof sp === "object" && sp ? (sp.display_name as string) : typeof sp === "string" ? sp : "")
      || (seg.speaker_display_name as string) || (seg.speaker_name as string) || (seg.display_name as string) || "Speaker";
    const text = (seg.text as string) ?? (seg.transcript as string) ?? (seg.words as string) ?? "";
    return `${who}: ${text}`;
  }).filter((l) => l.trim().length > 2).join("\n");
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Fathom share pages are Inertia apps: the data-page attribute carries the call
// props, including copyTranscriptUrl — an anonymous transcript endpoint keyed
// by the share token (what the page's own "Copy transcript" button calls).
async function inertiaTranscript(html: string): Promise<{ title: string; transcript: string } | null> {
  const m = html.match(/data-page="([^"]*)"/);
  if (!m) return null;
  let props: Record<string, any>;
  try { props = JSON.parse(decodeEntities(m[1]))?.props ?? {}; } catch { return null; }
  const title = String(props.head?.title || props.call?.title || "Fathom call");
  const cturl = props.copyTranscriptUrl as string | undefined;
  if (!cturl) return null;
  const r = await fetch(cturl, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!r.ok) return null;
  const j = (await r.json().catch(() => null)) as { html?: string } | null;
  if (!j?.html) return null;
  // html = <h1>title</h1> … then pairs of <p><a>@0:00</a> - <b>Speaker (domain)</b></p><p>what they said</p>
  const paras = [...j.html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((x) => decodeEntities(x[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()));
  const lines: string[] = [];
  let speaker = "Speaker";
  for (const p of paras) {
    if (!p) continue;
    const sp = p.match(/^@[\d:.]+\s*-\s*(.+)$/);
    if (sp) { speaker = sp[1].replace(/\s*\([^)]*\)\s*$/, "").trim() || "Speaker"; continue; }
    lines.push(`${speaker}: ${p}`);
  }
  const transcript = lines.join("\n");
  return transcript.length > 100 ? { title, transcript } : null;
}

async function scrapeShareLink(url: string): Promise<{ title: string; transcript: string }> {
  const u = new URL(url);
  if (!/(^|\.)fathom\.video$/.test(u.hostname)) throw new Error("not a fathom.video link");
  if (u.pathname.startsWith("/calls/")) throw new Error("that is an internal Fathom link — use Share → Copy link on the call instead");
  const r = await fetch(u, {
    redirect: "follow",
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
  });
  if (!r.ok) throw new Error(`share page returned ${r.status}`);
  const html = await r.text();

  // 0) Inertia data-page → anonymous copy_transcript endpoint (the real path)
  const viaInertia = await inertiaTranscript(html);
  if (viaInertia) return viaInertia;
  const title = decodeEntities((html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "Fathom call").replace(/\s*[|·-]\s*Fathom.*$/i, "").trim());

  // 1) any application/json script blobs (Nuxt data, bootstrap payloads)
  const jsonBlobs = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  // 2) window.__NUXT__ / __DATA__ style assignments
  const assign = html.match(/window\.__(?:NUXT|DATA|INITIAL_STATE)__\s*=\s*(\{[\s\S]*?\})\s*(?:;|<\/script>)/);
  if (assign) jsonBlobs.push(assign[1]);
  for (const blob of jsonBlobs) {
    try {
      const segs = huntSegments(JSON.parse(blob));
      if (segs) { const t = segsToText(segs); if (t.length > 200) return { title, transcript: t }; }
    } catch { /* not parseable, keep going */ }
  }
  // 3) the share page usually bootstraps from an anonymous JSON endpoint next to the page
  const tries = [`${u.origin}${u.pathname.replace(/\/$/, "")}/transcript`, `${u.origin}${u.pathname.replace(/\/$/, "")}.json`, `${u.origin}/api${u.pathname}/transcript`];
  for (const t of tries) {
    try {
      const rr = await fetch(t, { headers: { Accept: "application/json" } });
      if (!rr.ok) continue;
      const segs = huntSegments(await rr.json());
      if (segs) { const txt = segsToText(segs); if (txt.length > 200) return { title, transcript: txt }; }
    } catch { /* try next */ }
  }
  throw new Error("could not find a transcript on the share page (is the call still processing, or transcript disabled?)");
}

// ---- "Clone their real voice": share page → HLS audio → ElevenLabs clone ----
// Mechanics proven by the /root/voiceprobe feasibility run (see notes.md there):
// props.call.video_url is the anonymous HLS playlist; props.call.audio_url is a
// 404 TRAP for normal video calls; segment paths must come from the playlist
// (they embed the RECORDING id, not the call id) and 302-redirect to signed GCS
// URLs that expire in 6h — so the whole pipeline runs in ONE pass.

type TimedTurn = { speaker: string; domain: string; start: number };

// Timestamp-KEEPING transcript parser variant. The copy_transcript html carries
// per-turn anchors (?timestamp=SS.ss) + <b>Speaker (domain)</b>. The existing
// plain parser (inertiaTranscript) stays untouched for persona extraction.
async function timedTurnsFromProps(props: Record<string, any>): Promise<TimedTurn[]> {
  const cturl = props.copyTranscriptUrl as string | undefined;
  if (!cturl) return [];
  const r = await fetch(cturl, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!r.ok) return [];
  const j = (await r.json().catch(() => null)) as { html?: string } | null;
  if (!j?.html) return [];
  const turns: TimedTurn[] = [];
  for (const m of j.html.matchAll(/\?timestamp=([\d.]+)[^>]*>[\s\S]*?<\/a>\s*-\s*<b>([^<]*)<\/b>/g)) {
    const start = parseFloat(m[1]);
    if (!Number.isFinite(start)) continue;
    const who = decodeEntities(m[2]).trim();
    const dm = who.match(/\(([^)]*)\)\s*$/);
    turns.push({
      speaker: who.replace(/\s*\([^)]*\)\s*$/, "").trim() || "Speaker",
      domain: (dm?.[1] || "").toLowerCase().trim(),
      start,
    });
  }
  return turns.sort((a, b) => a.start - b.start);
}

// Media resolver: share URL → Inertia props → HLS playlist + timestamped turns.
async function resolveShareMedia(url: string): Promise<{ title: string; videoUrl: string | null; turns: TimedTurn[] }> {
  const u = new URL(url);
  if (!/(^|\.)fathom\.video$/.test(u.hostname)) throw new Error("not a fathom.video link");
  const r = await fetch(u, { redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
  if (!r.ok) throw new Error(`the Fathom share page returned ${r.status} — is the link still valid?`);
  const html = await r.text();
  const m = html.match(/data-page="([^"]*)"/);
  if (!m) throw new Error("the share page carries no call data (password-protected or expired share?)");
  let props: Record<string, any>;
  try { props = JSON.parse(decodeEntities(m[1]))?.props ?? {}; } catch { throw new Error("could not parse the share page data"); }
  const title = String(props.head?.title || props.call?.title || "Fathom call");
  const videoUrl = (typeof props.call?.video_url === "string" && props.call.video_url) || null;
  const turns = await timedTurnsFromProps(props);
  return { title, videoUrl, turns };
}

// ---- video-grounded storyboard: observe what the rep actually showed ----

// Timestamp+TEXT transcript parser. The copy_transcript html alternates header
// paragraphs (<a ?timestamp=SS.ss>@m:ss</a> - <b>Speaker (domain)</b>) with the
// paragraphs of what that speaker said. timedTurnsFromProps (above) keeps only
// the headers for the voice-clone windows; the fidelity loop needs the words.
export type TimedUtterance = { start: number; speaker: string; domain: string; text: string };

async function timedUtterancesFromProps(props: Record<string, any>): Promise<TimedUtterance[]> {
  const cturl = props.copyTranscriptUrl as string | undefined;
  if (!cturl) return [];
  const r = await fetch(cturl, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!r.ok) return [];
  const j = (await r.json().catch(() => null)) as { html?: string } | null;
  if (!j?.html) return [];
  const utterances: TimedUtterance[] = [];
  let cur: TimedUtterance | null = null;
  for (const m of j.html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const raw = m[1];
    const hd = raw.match(/\?timestamp=([\d.]+)[\s\S]*?<b>([^<]*)<\/b>/);
    if (hd) {
      if (cur && cur.text) utterances.push(cur);
      const who = decodeEntities(hd[2]).trim();
      const dm = who.match(/\(([^)]*)\)\s*$/);
      cur = {
        start: parseFloat(hd[1]) || 0,
        speaker: who.replace(/\s*\([^)]*\)\s*$/, "").trim() || "Speaker",
        domain: (dm?.[1] || "").toLowerCase().trim(),
        text: "",
      };
      continue;
    }
    const text = decodeEntities(raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (cur && text) cur.text = cur.text ? `${cur.text} ${text}` : text;
  }
  if (cur && cur.text) utterances.push(cur);
  return utterances.sort((a, b) => a.start - b.start);
}

// Full media resolver: playlist + timed utterances WITH text (one page fetch).
async function resolveShareMediaFull(url: string): Promise<{ title: string; videoUrl: string | null; utterances: TimedUtterance[] }> {
  const u = new URL(url);
  if (!/(^|\.)fathom\.video$/.test(u.hostname)) throw new Error("not a fathom.video link");
  const r = await fetch(u, { redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
  if (!r.ok) throw new Error(`the Fathom share page returned ${r.status} — is the link still valid?`);
  const html = await r.text();
  const m = html.match(/data-page="([^"]*)"/);
  if (!m) throw new Error("the share page carries no call data (password-protected or expired share?)");
  let props: Record<string, any>;
  try { props = JSON.parse(decodeEntities(m[1]))?.props ?? {}; } catch { throw new Error("could not parse the share page data"); }
  const title = String(props.head?.title || props.call?.title || "Fathom call");
  const videoUrl = (typeof props.call?.video_url === "string" && props.call.video_url) || null;
  const utterances = await timedUtterancesFromProps(props);
  return { title, videoUrl, utterances };
}

// The observed timeline stored on clone_sources.observed (JSONB).
export type ObservedRecord = {
  shareUrl: string;
  title: string;
  generatedAt: string;
  durationSec: number;
  intervalSec: number;
  frameCount: number;
  segments: ObservedSegment[];
  turns: TimedUtterance[];
};

// clone_sources.observed lives outside schema.sql (that file belongs to the
// main track) — ensure it lazily, once per process, before first use.
let observedColumnReady = false;
async function ensureObservedColumn(): Promise<void> {
  if (observedColumnReady) return;
  await query(`ALTER TABLE clone_sources ADD COLUMN IF NOT EXISTS observed JSONB`);
  observedColumnReady = true;
}

export default async function fathomRoutes(app: FastifyInstance) {
  // Build "<agent name> — real voice" in the ElevenLabs account from the rep's
  // actual speech on a Fathom call. Does NOT touch agents.voice_id — choosing
  // the voice stays a human act in the wizard's picker.
  app.post("/api/fathom/clone-voice", async (req, reply) => {
    const b = (req.body ?? {}) as { agentId?: string; shareUrl?: string };
    if (!b.agentId) return reply.code(400).send({ error: "agentId required" });
    const agent = await one<{ id: string; name: string }>(`SELECT id, name FROM agents WHERE id=$1 AND org_id=$2`, [b.agentId, orgId(req)]);
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    const elSrc = await getIntegrationSource(orgId(req), "elevenlabs");
    const elKey = elSrc?.values?.apiKey?.trim();
    if (!elKey) return reply.code(400).send({ error: "ElevenLabs is not connected — add the API key in Integrations" });

    // Tier guard FIRST — surface plan problems verbatim before any heavy work.
    const subR = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": elKey } });
    if (!subR.ok) return reply.code(502).send({ error: `ElevenLabs subscription check failed (${subR.status}): ${(await subR.text().catch(() => "")).slice(0, 200)}` });
    const sub = (await subR.json()) as { tier?: string; can_use_instant_voice_cloning?: boolean };
    if (!sub.can_use_instant_voice_cloning) {
      return reply.code(400).send({ error: `Your ElevenLabs plan ("${sub.tier ?? "unknown"}") cannot use instant voice cloning — upgrade the plan and retry.` });
    }

    // Share URL: explicit param wins; else the agent's longest stored Fathom source WITH a url.
    let shareUrl = (b.shareUrl ?? "").trim();
    if (!shareUrl) {
      const row = await one<{ url: string }>(
        `SELECT url FROM clone_sources WHERE agent_id=$1 AND org_id=$2 AND kind='fathom_transcript' AND url IS NOT NULL AND url <> '' ORDER BY length(transcript) DESC LIMIT 1`,
        [b.agentId, orgId(req)],
      );
      shareUrl = row?.url ?? "";
    }
    if (!shareUrl) return reply.code(400).send({ error: "re-add this clone's Fathom share links so we can reach the call audio" });

    const t0 = Date.now();
    const budget = () => { if (Date.now() - t0 > 170_000) throw new Error("voice-clone run exceeded its time budget — try again"); };
    const tmp = mkdtempSync(join(tmpdir(), "vclone-"));
    try {
      // 1) share page → playlist + timestamped turns (ONE pass — segment URLs expire)
      const media = await resolveShareMedia(shareUrl);
      if (!media.videoUrl) throw new Error("this share exposes no media stream (audio-only or restricted share)");
      if (media.turns.length < 2) throw new Error("could not read timestamped speaker turns from the share page");

      // 2) the rep = the speaker on the operator company's domain; fall back to
      //    the most-talkative speaker (with a warning) if no domain matches.
      const companyDomain = ((await getCompany(orgId(req))).domain || "").toLowerCase().trim();
      const spans = media.turns.map((t, i) => ({ ...t, end: media.turns[i + 1]?.start ?? t.start + 30 }));
      let warning: string | undefined;
      let repSpans = spans.filter((s) => companyDomain && s.domain === companyDomain);
      let repName = repSpans[0]?.speaker ?? "";
      if (!repSpans.length) {
        const bySpeaker = new Map<string, number>();
        for (const s of spans) bySpeaker.set(s.speaker, (bySpeaker.get(s.speaker) || 0) + Math.max(0, s.end - s.start));
        const top = [...bySpeaker.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
        repSpans = spans.filter((s) => s.speaker === top);
        repName = top;
        warning = `no speaker matched the company domain "${companyDomain}" — used the most-talkative speaker (${top}) instead`;
        app.log.warn({ agentId: b.agentId, top }, "clone-voice: rep fallback by talk time");
      }

      // 3) longest uninterrupted rep turns → 60–90s of windows (edges trimmed against bleed)
      const windows: { a: number; b: number }[] = [];
      let total = 0;
      for (const s of [...repSpans].sort((x, y) => (y.end - y.start) - (x.end - x.start))) {
        const a = s.start + 2.5;
        const bnd = Math.max(a, s.end - 1);
        if (bnd - a < 12) continue;
        const take = Math.min(bnd - a, 50, 88 - total);
        if (take < 8) break;
        windows.push({ a, b: a + take });
        total += take;
        if (total >= 75) break;
      }
      if (total < 30) throw new Error(`only ${Math.round(total)}s of clean uninterrupted speech found for ${repName || "the rep"} — use a share link where they talk more`);

      // 4) playlist → the exact segments covering the windows (paths from the playlist ONLY —
      //    they embed the recording id, never construct them)
      const plR = await fetch(media.videoUrl, { headers: { "User-Agent": UA } });
      if (!plR.ok) throw new Error(`HLS playlist fetch failed (${plR.status})`);
      const pl = await plR.text();
      const origin = new URL(media.videoUrl).origin;
      const segs: { start: number; end: number; url: string }[] = [];
      let cursor = 0, dur = 0;
      for (const line of pl.split("\n")) {
        const l = line.trim();
        const em = l.match(/^#EXTINF:([\d.]+)/);
        if (em) { dur = parseFloat(em[1]); continue; }
        if (!l || l.startsWith("#")) continue;
        segs.push({ start: cursor, end: cursor + dur, url: l.startsWith("http") ? l : origin + l });
        cursor += dur; dur = 0;
      }
      if (!segs.length) throw new Error("the HLS playlist has no media segments");

      // 5) download ONLY the needed segments; cut each window; concat → mono 44.1k mp3
      const partPaths: string[] = [];
      for (let w = 0; w < windows.length; w++) {
        budget();
        const { a, b: bEnd } = windows[w];
        const need = segs.filter((s) => s.end > a && s.start < bEnd);
        if (!need.length) continue;
        const tsPath = join(tmp, `w${w}.ts`);
        const fd = openSync(tsPath, "w");
        try {
          for (const s of need) {
            budget();
            const rr = await fetch(s.url, { redirect: "follow", headers: { "User-Agent": UA } }); // 302 → signed GCS URL
            if (!rr.ok) throw new Error(`media segment fetch failed (${rr.status})`);
            writeSync(fd, Buffer.from(await rr.arrayBuffer()));
          }
        } finally { closeSync(fd); }
        const off = Math.max(0, a - need[0].start);
        const mp3Path = join(tmp, `w${w}.mp3`);
        await execF("ffmpeg", ["-y", "-i", tsPath, "-ss", off.toFixed(2), "-t", (bEnd - a).toFixed(2), "-vn", "-ac", "1", "-ar", "44100", "-b:a", "128k", mp3Path], { timeout: 60000 })
          .catch((e: unknown) => { throw new Error(`ffmpeg failed: ${String((e as { stderr?: string }).stderr || (e as Error).message).slice(-300)}`); });
        partPaths.push(mp3Path);
        rmSync(tsPath, { force: true });
      }
      if (!partPaths.length) throw new Error("no audio windows could be extracted");
      const outPath = join(tmp, "sample.mp3");
      if (partPaths.length === 1) {
        rmSync(outPath, { force: true });
        writeFileSync(outPath, readFileSync(partPaths[0]));
      } else {
        const listPath = join(tmp, "list.txt");
        writeFileSync(listPath, partPaths.map((p2) => `file '${p2}'`).join("\n"));
        await execF("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath], { timeout: 30000 })
          .catch((e: unknown) => { throw new Error(`ffmpeg concat failed: ${String((e as { stderr?: string }).stderr || (e as Error).message).slice(-300)}`); });
      }
      const sample = readFileSync(outPath);
      let sampleSeconds = Math.round(total);
      try {
        const pr = await execF("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", outPath], { timeout: 15000 });
        const d2 = parseFloat(String(pr.stdout).trim());
        if (Number.isFinite(d2)) sampleSeconds = Math.round(d2);
      } catch { /* keep the window estimate */ }

      // 6) idempotency: ONE "<name> — real voice" per agent — replace, never accumulate
      const voiceName = `${agent.name} — real voice`;
      const lv = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": elKey } });
      if (lv.ok) {
        const vj = (await lv.json()) as { voices?: { voice_id: string; name?: string }[] };
        for (const v of vj.voices ?? []) {
          if ((v.name || "") === voiceName) {
            await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(v.voice_id)}`, { method: "DELETE", headers: { "xi-api-key": elKey } }).catch(() => { /* add still proceeds */ });
          }
        }
      }

      // 7) create the clone
      const form = new FormData();
      form.append("name", voiceName);
      form.append("files", new Blob([new Uint8Array(sample)], { type: "audio/mpeg" }), "sample.mp3");
      const addR = await fetch("https://api.elevenlabs.io/v1/voices/add", { method: "POST", headers: { "xi-api-key": elKey }, body: form });
      if (!addR.ok) return reply.code(502).send({ error: `ElevenLabs voice add failed (${addR.status}): ${(await addR.text().catch(() => "")).slice(0, 300)}` });
      const added = (await addR.json()) as { voice_id?: string };
      if (!added.voice_id) return reply.code(502).send({ error: "ElevenLabs returned no voice_id" });
      // OWNERSHIP LEDGER: record the voice WE created + the key-org that made it,
      // so org/clone deletion can revoke exactly this biometric (and only ours).
      await query(`DELETE FROM cloned_voices WHERE org_id=$1 AND agent_id=$2`, [orgId(req), b.agentId]).catch(() => {});
      await query(
        `INSERT INTO cloned_voices (id, org_id, agent_id, voice_id, via_org) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (voice_id) DO NOTHING`,
        [newId("cv"), orgId(req), b.agentId, added.voice_id, elSrc?.viaOrg ?? orgId(req)],
      ).catch(() => {});
      bustVoiceCache(); // the wizard's picker refresh must see the new voice immediately
      app.log.info({ agentId: b.agentId, voiceId: added.voice_id, sampleSeconds, rep: repName }, "real voice cloned");
      return { voiceId: added.voice_id, name: voiceName, sampleSeconds, ...(warning ? { warning } : {}) };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  // Paste-a-share-link ingestion: no API key needed, reads the public share page
  app.post("/api/fathom/links", async (req, reply) => {
    const b = (req.body ?? {}) as { urls?: string[] };
    const urls = [...new Set((b.urls ?? []).map((s) => String(s).trim()).filter(Boolean))].slice(0, 20);
    if (!urls.length) return reply.code(400).send({ error: "urls required" });
    const transcripts: { url: string; title: string; transcript: string }[] = [];
    const failed: { url: string; reason: string }[] = [];
    for (const url of urls) {
      try {
        const t = await scrapeShareLink(url);
        transcripts.push({ url, ...t });
      } catch (e) {
        failed.push({ url, reason: (e as Error).message });
      }
    }
    return { transcripts, failed };
  });

  // Calls list for the wizard picker (no transcripts — cheap page)
  app.get("/api/fathom/meetings", async (req) => {
    const key = await fathomKey(orgId(req));
    if (!key) return { connected: false, meetings: [], nextCursor: null };
    const { cursor } = req.query as { cursor?: string };
    try {
      const { items, nextCursor } = await listPage(key, cursor || undefined, false);
      return { connected: true, meetings: items.map(normalize).filter((m) => m.id), nextCursor };
    } catch (e) {
      return { connected: true, meetings: [], nextCursor: null, error: (e as Error).message };
    }
  });

  // Full transcripts for the selected calls, fetched server-side
  app.post("/api/fathom/transcripts", async (req, reply) => {
    const b = (req.body ?? {}) as { ids?: string[] };
    const wanted = new Set((b.ids ?? []).map(String).filter(Boolean));
    if (!wanted.size) return reply.code(400).send({ error: "ids required" });
    const key = await fathomKey(orgId(req));
    if (!key) return reply.code(400).send({ error: "Fathom is not connected — add the API key first." });
    const found: { id: string; title: string; transcript: string }[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const res = await listPage(key, cursor || undefined, true);
      for (const m of res.items) {
        const n = normalize(m);
        if (wanted.has(n.id) && !found.some((f) => f.id === n.id)) {
          found.push({ id: n.id, title: n.title, transcript: transcriptText(m) });
        }
      }
      if (found.length >= wanted.size || !res.nextCursor) break;
      cursor = res.nextCursor;
    }
    const transcripts = found.filter((t) => t.transcript.trim().length > 40);
    const missing = [...wanted].filter((id) => !transcripts.some((t) => t.id === id));
    return { transcripts, missing };
  });

  // Connect Fathom without leaving the wizard: probe the key, then store it
  // in the notetaker integration slot (same row Integrations manages).
  app.post("/api/fathom/connect", async (req, reply) => {
    const b = (req.body ?? {}) as { apiKey?: string };
    const apiKey = (b.apiKey ?? "").trim();
    if (!apiKey) return reply.code(400).send({ error: "apiKey required" });
    try {
      await listPage(apiKey, undefined, false);
    } catch (e) {
      return reply.code(400).send({ error: `Fathom rejected the key: ${(e as Error).message}` });
    }
    await query(
      `INSERT INTO integrations (org_id, id, values, connected, detail, updated_at)
       VALUES ($2, 'notetaker', $1, true, 'fathom', now())
       ON CONFLICT (org_id, id) DO UPDATE SET values = EXCLUDED.values, connected = true, detail = 'fathom', updated_at = now()`,
      [JSON.stringify({ provider: "fathom", apiKey }), orgId(req)],
    );
    return { ok: true };
  });

  // Which of an agent's sources carry an observed timeline — cheap list for
  // the wizard's "Grounded ✓" badges and the fidelity run's source picker.
  app.get("/api/fathom/observed", async (req) => {
    const { agentId } = (req.query ?? {}) as { agentId?: string };
    if (!agentId) return { observed: [] };
    if (!(await agentInOrg(agentId, orgId(req)))) return { observed: [] };
    await ensureObservedColumn();
    const rows = await query<{ id: string; title: string | null; segs: number | null; turns: number | null }>(
      `SELECT id, title, jsonb_array_length(observed->'segments') AS segs, jsonb_array_length(observed->'turns') AS turns
       FROM clone_sources WHERE agent_id = $1 AND org_id = $2 AND observed IS NOT NULL`, [agentId, orgId(req)]);
    return { observed: rows.map((r) => ({ sourceId: r.id, title: r.title ?? "", segments: r.segs ?? 0, turns: r.turns ?? 0 })) };
  });

  // ================= VIDEO-GROUNDED STORYBOARD =================
  // Observe the recording's screen share instead of inferring it: sample the
  // HLS video, vision-label each frame against the site-map vocabulary, and
  // store the collapsed timeline (+ timed utterances) on the clone source.
  // Heavy (~minutes for a 25-min call): the segment URLs expire, so the whole
  // pass runs in one request. curl with a generous timeout.
  app.post("/api/fathom/observe-screens", async (req, reply) => {
    const b = (req.body ?? {}) as { shareUrl?: string; agentId?: string; sourceId?: string; maxFrames?: number };
    const shareUrl = (b.shareUrl ?? "").trim();
    if (!shareUrl) return reply.code(400).send({ error: "shareUrl required" });
    const org = orgId(req);
    // Every clone_sources lookup/insert below is org-scoped, so an observation
    // can only ever attach to the caller's own source.
    if (b.agentId && !(await agentInOrg(b.agentId, org))) return reply.code(404).send({ error: "agent not found" });
    try {
      await ensureObservedColumn();
      const media = await resolveShareMediaFull(shareUrl);
      if (!media.videoUrl) return reply.code(400).send({ error: "this share exposes no media stream (audio-only or restricted share)" });

      // Locate the clone source this recording belongs to: explicit sourceId →
      // exact title match → (with agentId) create the source from the share's
      // own transcript so the observation always lands somewhere durable.
      let src = b.sourceId
        ? await one<{ id: string; agent_id: string }>(`SELECT id, agent_id FROM clone_sources WHERE id=$1 AND org_id=$2${b.agentId ? " AND agent_id=$3" : ""}`, b.agentId ? [b.sourceId, org, b.agentId] : [b.sourceId, org])
        : null;
      if (b.sourceId && !src) return reply.code(404).send({ error: "source not found" });
      if (!src) {
        src = await one<{ id: string; agent_id: string }>(
          `SELECT id, agent_id FROM clone_sources WHERE kind != 'live_call' AND title=$1 AND org_id=$2${b.agentId ? " AND agent_id=$3" : ""} ORDER BY created_at DESC LIMIT 1`,
          b.agentId ? [media.title, org, b.agentId] : [media.title, org],
        );
      }
      if (!src && b.agentId) {
        if (media.utterances.length < 2) return reply.code(502).send({ error: "could not read the timed transcript from the share page" });
        const id = `cs_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`;
        const transcript = media.utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n");
        await query(`INSERT INTO clone_sources (id, agent_id, title, url, transcript, org_id) VALUES ($1,$2,$3,$4,$5,$6)`, [id, b.agentId, media.title, shareUrl, transcript, org]);
        src = { id, agent_id: b.agentId };
        app.log.info({ id, agentId: b.agentId, title: media.title }, "observe-screens: created a new source for this recording");
      }
      if (!src) return reply.code(404).send({ error: `no stored source titled "${media.title}" — pass agentId to create one` });

      const t0 = Date.now();
      const obs = await observeScreens(org, media.videoUrl, { maxFrames: b.maxFrames, log: (msg) => app.log.info({ sourceId: src!.id }, msg) });
      const observed: ObservedRecord = {
        shareUrl,
        title: media.title,
        generatedAt: new Date().toISOString(),
        durationSec: obs.durationSec,
        intervalSec: obs.intervalSec,
        frameCount: obs.frameCount,
        segments: obs.segments,
        turns: media.utterances,
      };
      await query(`UPDATE clone_sources SET observed=$2, url=COALESCE(NULLIF(url,''), $3) WHERE id=$1`, [src.id, JSON.stringify(observed), shareUrl]);
      app.log.info({ sourceId: src.id, frames: obs.frameCount, segments: obs.segments.length, ms: Date.now() - t0 }, "observe-screens: stored observed timeline");
      return {
        sourceId: src.id,
        agentId: src.agent_id,
        title: media.title,
        durationSec: obs.durationSec,
        intervalSec: obs.intervalSec,
        frames: obs.frameCount,
        turns: media.utterances.length,
        segments: obs.segments,
      };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // Enrich the CURRENT playbook draft with what the recording actually shows:
  // beats re-timed to observed segments, screen actions corrected to observed
  // screens, popup/question-card moments folded into the voice track. Returns
  // a DRAFT only — saving stays a human act via PUT /api/clones/:id/playbook.
  app.post("/api/fathom/enrich-playbook", async (req, reply) => {
    const b = (req.body ?? {}) as { agentId?: string; sourceId?: string };
    if (!b.agentId || !b.sourceId) return reply.code(400).send({ error: "agentId and sourceId required" });
    const org = orgId(req);
    await ensureObservedColumn();
    const agent = await one<any>(`SELECT * FROM agents WHERE id=$1 AND org_id=$2`, [b.agentId, org]);
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    const pb = agent.playbook && agent.playbook.kind === "calls" && agent.playbook.callPlaybook ? agent.playbook.callPlaybook : null;
    if (!pb || !Array.isArray(pb.stages) || !pb.stages.length) return reply.code(400).send({ error: "this clone has no playbook to enrich — draft one first" });
    const src = await one<any>(`SELECT id, title, observed FROM clone_sources WHERE agent_id=$1 AND id=$2 AND org_id=$3`, [b.agentId, b.sourceId, org]);
    if (!src) return reply.code(404).send({ error: "source not found" });
    const observed = src.observed as ObservedRecord | null;
    if (!observed?.segments?.length) return reply.code(409).send({ error: "no observed timeline on this source — run POST /api/fathom/observe-screens first" });

    const companyDomain = ((await getCompany(org)).domain || "").toLowerCase().trim();
    const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    const timeline = observed.segments.map((s) =>
      `${mmss(s.fromSec)}-${mmss(s.toSec)} screen=${s.screenKey}${s.popups.length ? ` popups=[${s.popups.join(" | ")}]` : ""}${s.notable ? ` (${s.notable})` : ""}`).join("\n");
    const turns = (observed.turns ?? []).map((u) => {
      const who = companyDomain && u.domain === companyDomain ? "REP" : "CUSTOMER";
      return `[${mmss(u.start)}] ${who} (${u.speaker}): ${u.text}`;
    }).join("\n").slice(0, 24000);

    const sys = `You correct a live-demo call playbook using GROUND TRUTH observed from the actual call recording. The playbook was drafted from the transcript alone; the OBSERVED TIMELINE is what the rep really had on screen (vision-labeled frames; screen keys come from the product site map; "camera-only" = no screen share). Re-ground the beats:\n` +
      `- Re-time each stage to the observed segments (add "observed":{"fromSec":int,"toSec":int,"screenKey":str} per stage).\n` +
      `- Correct each stage's screen.actions to match the screens ACTUALLY shown at that moment (use the observed screenKey vocabulary; talk-only moments get actions=[] and screenKey "camera-only").\n` +
      `- Where a popup/question card appeared, fold the handling into that stage's voice.listenFor and voice.moves (e.g. answer the question card before moving on).\n` +
      `- Keep every stage's id. Keep names/goals unless the evidence contradicts them. Do NOT invent screens that were never observed.\n` +
      `Return ONLY JSON: {"stages":[{"id":str,"name":str,"goal":str,"observed":{"fromSec":int,"toSec":int,"screenKey":str},"voice":{"objective":str,"moves":[str],"exampleLines":[str],"listenFor":[str]},"screen":{"actions":[str],"waitBehavior":str},"exitCriteria":str}],` +
      `"corrections":[{"stageId":str,"kind":"timing"|"screen"|"popup"|"voice","before":str,"after":str,"why":str}]}. corrections = the 3-8 most material fixes, before/after one line each, why cites the observed evidence (timestamp + screenKey).`;
    const user = `CURRENT PLAYBOOK STAGES:\n${JSON.stringify(pb.stages.map((s: any) => ({ id: s.id, name: s.name, goal: s.goal, voice: s.voice, screen: s.screen, exitCriteria: s.exitCriteria })))}\n\nOBSERVED TIMELINE (${observed.frameCount} frames over ${mmss(observed.durationSec)}):\n${timeline}\n\nTIMED TRANSCRIPT:\n${turns}`;

    // the model returns malformed JSON often enough — retry like studio does
    let j: { stages?: any[]; corrections?: any[] } | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      j = await providerChatJson(org, sys, user);
      if (j && Array.isArray(j.stages) && j.stages.length) break;
      j = null;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
    if (!j) return reply.code(502).send({ error: "enrichment returned no usable JSON — check the AI provider" });

    // merge defensively: overlay onto the existing stage by id so fields the
    // model dropped (wireframe etc.) survive; unknown ids are appended last.
    const byId = new Map<string, any>(pb.stages.map((s: any) => [String(s.id), s]));
    const stages = j.stages!.map((es: any, i: number) => {
      const base = byId.get(String(es.id)) ?? {};
      return {
        ...base,
        id: String(es.id || base.id || `st${i + 1}`),
        name: String(es.name || base.name || `Stage ${i + 1}`),
        goal: String(es.goal ?? base.goal ?? ""),
        voice: {
          objective: String(es.voice?.objective ?? base.voice?.objective ?? ""),
          moves: Array.isArray(es.voice?.moves) ? es.voice.moves.map(String) : base.voice?.moves ?? [],
          exampleLines: Array.isArray(es.voice?.exampleLines) ? es.voice.exampleLines.map(String) : base.voice?.exampleLines ?? [],
          listenFor: Array.isArray(es.voice?.listenFor) ? es.voice.listenFor.map(String) : base.voice?.listenFor ?? [],
        },
        screen: {
          actions: Array.isArray(es.screen?.actions) ? es.screen.actions.map(String) : base.screen?.actions ?? [],
          waitBehavior: String(es.screen?.waitBehavior ?? base.screen?.waitBehavior ?? ""),
        },
        ...(es.exitCriteria || base.exitCriteria ? { exitCriteria: String(es.exitCriteria ?? base.exitCriteria) } : {}),
        ...(es.observed && Number.isFinite(es.observed.fromSec) ? { observed: { fromSec: Math.round(es.observed.fromSec), toSec: Math.round(es.observed.toSec ?? es.observed.fromSec), screenKey: String(es.observed.screenKey ?? "") } } : {}),
      };
    });
    const corrections = Array.isArray(j.corrections)
      ? j.corrections.filter((c: any) => c?.stageId && c?.after).slice(0, 10).map((c: any) => ({
          stageId: String(c.stageId), kind: ["timing", "screen", "popup", "voice"].includes(c.kind) ? c.kind : "screen",
          before: String(c.before ?? ""), after: String(c.after), why: String(c.why ?? ""),
        }))
      : [];
    return {
      draft: { ...pb, stages, generatedAt: new Date().toISOString(), approved: false },
      corrections,
      note: "draft only — nothing saved; apply via PUT /api/clones/:agentId/playbook",
    };
  });
}
