import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSetting } from "./settingsStore.js";
import { getActiveProvider } from "./providers.js";

const execF = promisify(execFile);

// ============================================================
// Call vision — observe what the rep ACTUALLY showed on a recorded
// Fathom call instead of inferring it from the transcript. Pipeline:
// HLS playlist → sampled segments (paths read from the playlist ONLY;
// they 302 to signed GCS URLs that expire, so everything runs in one
// pass) → one keyframe per sampled segment via ffmpeg → vision-label
// each frame against the site-map vocabulary → collapse consecutive
// identical labels into an observed timeline.
// ============================================================

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type FrameLabel = {
  atSec: number;
  screenShare: boolean;
  screenKey: string; // site-map destination key, "unknown-<desc>", or "camera-only"
  popupOrCard: string | null;
  notable: string;
};

export type ObservedSegment = {
  fromSec: number;
  toSec: number;
  screenKey: string;
  popups: string[];
  notable?: string;
};

// ---- generic JSON-out chat against the active OpenAI-compatible provider ----
// providers.ts only speaks text; this variant also accepts multimodal content
// parts (image_url) for vision labeling. Sends no token cap (mirrors the
// production chat path — newer OpenAI models reject max_tokens).
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: string } };

function extractJson<T>(text: string): T | null {
  let t = (text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // object or array — take the widest bracket span
  const so = t.indexOf("{"), sa = t.indexOf("[");
  const start = sa !== -1 && (so === -1 || sa < so) ? sa : so;
  const end = start === sa ? t.lastIndexOf("]") : t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)) as T; } catch { return null; }
}

export async function providerChatJson<T = unknown>(org: string, system: string, user: string | ContentPart[]): Promise<T | null> {
  const p = await getActiveProvider(org);
  if (!p) return null;
  try {
    const r = await fetch(`${p.base_url.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.api_key}` },
      body: JSON.stringify({ model: p.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], stream: false }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    return extractJson<T>(j?.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

// ---- site-map vocabulary: the label space for screen classification ----
export async function siteMapVocabulary(org: string): Promise<string> {
  const value = await getSetting<{ destinations?: Record<string, unknown>[] }>(org, "site_map");
  const dests = value?.destinations;
  if (!Array.isArray(dests) || !dests.length) return "(no site map stored — label every shared screen unknown-<desc>)";
  return dests.map((d) => {
    const st = (d.structure ?? {}) as Record<string, unknown>;
    const verify = (d.verify ?? {}) as Record<string, unknown>;
    const bits = [
      `- ${d.key}:`,
      verify.heading ? `heading "${verify.heading}"` : "",
      Array.isArray(st.tabs) && st.tabs.length ? `tabs [${(st.tabs as string[]).slice(0, 4).join(", ")}]` : "",
      Array.isArray(st.buttons) && st.buttons.length ? `buttons [${(st.buttons as string[]).slice(0, 4).join(", ")}]` : "",
      Array.isArray(st.inputs) && st.inputs.length ? `inputs [${(st.inputs as string[]).slice(0, 3).join(", ")}]` : "",
      Array.isArray(st.landmarks) && st.landmarks.length ? `landmarks [${(st.landmarks as string[]).slice(0, 3).join(", ")}]` : "",
      Array.isArray(verify.snippets) && verify.snippets.length ? `snippets [${(verify.snippets as string[]).slice(0, 2).map((s) => String(s).slice(0, 60)).join(" | ")}]` : "",
    ].filter(Boolean);
    return bits.join(" ");
  }).join("\n");
}

// ---- HLS playlist → timed segment list (paths from the playlist, never constructed) ----
type HlsSeg = { start: number; end: number; url: string };

function parsePlaylist(text: string, playlistUrl: string): HlsSeg[] {
  const origin = new URL(playlistUrl).origin;
  const segs: HlsSeg[] = [];
  let cursor = 0, dur = 0;
  for (const line of text.split("\n")) {
    const l = line.trim();
    const em = l.match(/^#EXTINF:([\d.]+)/);
    if (em) { dur = parseFloat(em[1]); continue; }
    if (!l || l.startsWith("#")) continue;
    segs.push({ start: cursor, end: cursor + dur, url: l.startsWith("http") ? l : origin + l });
    cursor += dur; dur = 0;
  }
  return segs;
}

async function fetchBytes(url: string): Promise<Buffer> {
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`media fetch failed (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

// ---- main pass: video HLS → labeled frames → observed timeline ----
export async function observeScreens(
  org: string,
  videoUrl: string,
  opts?: { maxFrames?: number; log?: (msg: string) => void },
): Promise<{ durationSec: number; intervalSec: number; frameCount: number; labels: FrameLabel[]; segments: ObservedSegment[] }> {
  const log = opts?.log ?? (() => {});
  const maxFrames = Math.max(10, Math.min(150, opts?.maxFrames ?? 120));

  const plR = await fetch(videoUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!plR.ok) throw new Error(`HLS playlist fetch failed (${plR.status})`);
  const segs = parsePlaylist(await plR.text(), videoUrl);
  if (!segs.length) throw new Error("the HLS playlist has no media segments");
  const durationSec = Math.round(segs[segs.length - 1].end);

  // sample times every ~intervalSec, snap each to its covering segment, dedupe
  const intervalSec = Math.max(5, Math.ceil(durationSec / maxFrames));
  const picked = new Map<number, HlsSeg>(); // segment index → seg
  for (let t = 0; t < durationSec; t += intervalSec) {
    const i = segs.findIndex((s) => s.end > t && s.start <= t);
    if (i >= 0 && !picked.has(i)) picked.set(i, segs[i]);
  }
  const sampled = [...picked.values()].slice(0, maxFrames);
  log(`observe-screens: ${durationSec}s call, sampling ${sampled.length} frames every ~${intervalSec}s`);

  const tmp = mkdtempSync(join(tmpdir(), "callvision-"));
  try {
    // download + extract one keyframe per sampled segment (segments expire — one pass)
    const frames: { atSec: number; path: string }[] = [];
    const CONC = 4;
    for (let i = 0; i < sampled.length; i += CONC) {
      await Promise.all(sampled.slice(i, i + CONC).map(async (seg, k) => {
        const n = i + k;
        const tsPath = join(tmp, `s${n}.ts`);
        const jpgPath = join(tmp, `f${n}.jpg`);
        try {
          writeFileSync(tsPath, await fetchBytes(seg.url));
          await execF("ffmpeg", ["-y", "-i", tsPath, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "5", jpgPath], { timeout: 30_000 });
          if (existsSync(jpgPath)) frames.push({ atSec: Math.round(seg.start), path: jpgPath });
        } catch { /* a bad segment loses one frame, not the run */ }
        finally { rmSync(tsPath, { force: true }); }
      }));
      if (i % 24 === 0) log(`observe-screens: extracted ${Math.min(i + CONC, sampled.length)}/${sampled.length}`);
    }
    frames.sort((a, b) => a.atSec - b.atSec);
    if (frames.length < 5) throw new Error(`only ${frames.length} frames could be extracted from the recording`);

    // vision-label in small batches against the site-map vocabulary
    const vocab = await siteMapVocabulary(org);
    const sys = `You label frames sampled from a screen-recorded sales demo call (Zoom call where the rep screen-shares the GoPerfect recruiting product).\n` +
      `KNOWN SCREENS (destination key: visual cues):\n${vocab}\n\n` +
      `For EACH numbered image return one object. Return ONLY a JSON array [{"i":int,"screenShare":bool,"screenKey":str,"popupOrCard":str|null,"notable":str}].\n` +
      `- screenShare: true only if an application/product screen is being shared (not just webcam faces).\n` +
      `- screenKey: the best-matching destination key from KNOWN SCREENS. If a screen is shared but matches none, use "unknown-<3-5-word-desc>". If screenShare is false, use "camera-only".\n` +
      `- popupOrCard: short description of any modal, question card, dropdown, toast or artifact OVERLAYING the app (null if none).\n` +
      `- notable: what is happening, max 10 words (e.g. "typing role brief into chat", "ranked candidate list visible").`;
    const labels: FrameLabel[] = [];
    const BATCH = 5;
    for (let i = 0; i < frames.length; i += BATCH) {
      const batch = frames.slice(i, i + BATCH);
      const content: ContentPart[] = [{ type: "text", text: `Frames ${batch.map((_, k) => k).join(", ")} (timestamps ${batch.map((f) => f.atSec + "s").join(", ")}). Label each.` }];
      for (const f of batch) {
        content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${readFileSync(f.path).toString("base64")}`, detail: "low" } });
      }
      const j = await providerChatJson<{ i: number; screenShare?: boolean; screenKey?: string; popupOrCard?: string | null; notable?: string }[]>(org, sys, content);
      if (Array.isArray(j)) {
        for (const o of j) {
          const f = batch[Number(o.i)];
          if (!f) continue;
          const share = !!o.screenShare;
          labels.push({
            atSec: f.atSec,
            screenShare: share,
            screenKey: share ? String(o.screenKey || "unknown-unlabeled").slice(0, 60) : "camera-only",
            popupOrCard: o.popupOrCard ? String(o.popupOrCard).slice(0, 160) : null,
            notable: String(o.notable ?? "").slice(0, 120),
          });
        }
      }
      log(`observe-screens: labeled ${Math.min(i + BATCH, frames.length)}/${frames.length}`);
    }
    labels.sort((a, b) => a.atSec - b.atSec);
    if (!labels.length) throw new Error("vision labeling returned nothing — check the AI provider supports images");

    // collapse consecutive identical screenKeys into an observed timeline
    const segments: ObservedSegment[] = [];
    for (const l of labels) {
      const last = segments[segments.length - 1];
      if (last && last.screenKey === l.screenKey) {
        last.toSec = l.atSec + intervalSec;
        if (l.popupOrCard && !last.popups.includes(l.popupOrCard)) last.popups.push(l.popupOrCard);
        if (!last.notable && l.notable) last.notable = l.notable;
      } else {
        segments.push({ fromSec: l.atSec, toSec: l.atSec + intervalSec, screenKey: l.screenKey, popups: l.popupOrCard ? [l.popupOrCard] : [], ...(l.notable ? { notable: l.notable } : {}) });
      }
    }
    return { durationSec, intervalSec, frameCount: labels.length, labels, segments };
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
