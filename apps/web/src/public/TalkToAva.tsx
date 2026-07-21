import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Icon, type Nav } from "./PublicChrome";
import { attributionString } from "./attribution";

// ============================================================
// After Human — "Talk to Ava" public live demo. The hero flow:
// a prospect clicks "Talk to Ava" and lands in a live voice +
// screen demo driven by Ava (After Human's own cloned AI rep).
//
// This is a full-screen, self-scoped (.ah-public) Demo Mode
// takeover mounted by PublicSite at #/ava. It reuses the demo
// vocabulary the product already speaks — the pulsing voice orb,
// the waveform, and the .browser frame that embeds the live E2B
// screen stream via <iframe src={streamUrl} allow="autoplay">
// (identical to RehearsalRoom's live stage) — recast into the
// public site's scoped tokens so no product style is touched.
//
// It is UNAUTHENTICATED (public demo endpoints need no key) and
// builds to this exact contract (another workstream ships it):
//   POST /api/demo/start                -> { sessionId, status:"ready"|"queued", streamUrl?, queuePosition?, expiresAt }
//   GET  /api/demo/:sessionId/status    -> { status:"connecting"|"live"|"ended"|"expired", streamUrl, remainingSec, transcript? }
//   POST /api/demo/:sessionId/say {text}
//   POST /api/demo/:sessionId/end       -> { endedAt }
//   POST /api/demo/:sessionId/lead {email} -> { ok }
//
// Email capture is at the END only — the demo is never gated
// behind it. Every state (connecting, queued, live, mid-demo
// death, pool-full/error, end) has a graceful, on-brand surface.
// ============================================================

// --- API contract types --------------------------------------------------
type StartResp = {
  sessionId: string;
  status: "ready" | "queued";
  streamUrl?: string;
  queuePosition?: number;
  expiresAt?: string;
};
type StatusResp = {
  status: "connecting" | "live" | "ended" | "expired";
  streamUrl?: string;
  remainingSec?: number;
  transcript?: RawTurn[];
  revealed?: boolean; // true once Ava takes her first product action (curtain lifts)
};
type RawTurn = { role?: string; speaker?: string; who?: string; text?: string; content?: string };
type Turn = { ava: boolean; text: string };
// Ava's REAL voice: raw PCM s16le/24k/mono in base64 chunks, offset-cursored —
// the SAME contract GET /api/live/audio serves and RehearsalRoom's engine plays.
type AudioResp = { live: boolean; offset: number; chunk: string; rate?: number };

// Dedicated, decoupled fetch for the PUBLIC demo endpoints. It deliberately
// does NOT go through api/client.ts: those endpoints are unauthenticated, and
// we must never send/clear the product access key or bounce a signed-in visitor
// to the login gate from the public marketing site. Same-origin relative paths
// mirror production (web + /api are served together).
async function demoFetch<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body != null ? { "Content-Type": "application/json" } : {},
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let code = "", msg = "";
    try { const j = await res.json() as { error?: string; code?: string }; code = j.code || ""; msg = j.error || ""; } catch { /* non-JSON */ }
    const e = new Error(msg || `${method} ${path} -> ${res.status}`) as Error & { status?: number; code?: string };
    e.status = res.status; e.code = code;
    throw e;
  }
  return (await res.json()) as T;
}

// Normalize a transcript turn from whatever shape the backend sends.
function normalizeTurn(t: RawTurn): Turn {
  const label = (t.role || t.speaker || t.who || "").toLowerCase();
  const ava = /ava|assistant|agent|clone|rep|bot/.test(label);
  return { ava, text: (t.text || t.content || "").trim() };
}

type Phase = "connecting" | "queued" | "live" | "ended" | "error";
type EndReason = "user" | "expired" | "ended" | "died";

const PINK = "#FF0660";
const GREEN = "#2ED37D";

// Minimal SpeechRecognition typing (same browser API RehearsalRoom uses for
// mic capture). Kept local so we don't pull in product types.
type SR = { start: () => void; stop: () => void; abort: () => void; onresult: ((e: unknown) => void) | null; onspeechstart: (() => void) | null; onend: (() => void) | null; onerror: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string };

export default function TalkToAva({ nav }: { nav: Nav }) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [streamUrl, setStreamUrl] = useState("");
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [endReason, setEndReason] = useState<EndReason>("ended");
  const [errMsg, setErrMsg] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // true while Ava's streamed voice is actively voicing — pulses the orb/wave.
  const [speaking, setSpeaking] = useState(false);
  // false until Ava reveals the product (her first action); drives the branded
  // curtain + the Ava orb gliding from center to the bottom-right self-view.
  const [revealed, setRevealed] = useState(false);
  // Chrome autoplay: the AudioContext is born suspended (no user gesture inside
  // this page — the landing click was spent on navigation). `muted` gates a
  // visible "tap to hear Ava" unlock that creates+resumes the ctx in a gesture.
  const [muted, setMuted] = useState(true);

  // email capture (END only)
  const [email, setEmail] = useState("");
  const [leadState, setLeadState] = useState<"idle" | "sending" | "done" | "error">("idle");

  const sessionRef = useRef<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failRef = useRef(0);
  const endedRef = useRef(false);
  const recRef = useRef<SR | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  // --- audio path: play Ava's REAL voice (vspk PCM) via Web Audio ---
  // The engine + barge-in below are lifted from RehearsalRoom's live-stream
  // player (screens/RehearsalRoom.tsx): poll /audio, decode s16le → Float32,
  // schedule at 24kHz with a small look-ahead; barge-in flushes what's queued.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const greetedRef = useRef(false);          // fire Ava's proactive opener exactly once
  const streamOffsetRef = useRef(-1);        // byte cursor into the sandbox raw file
  const streamNextTRef = useRef(0);          // next scheduled start time (ctx clock)
  const streamSrcsRef = useRef<AudioBufferSourceNode[]>([]);
  const streamVoicedAtRef = useRef(0);       // last ms we saw real (non-silence) PCM
  const streamSpeakingRef = useRef(false);   // Ava-is-voicing latch (mic discipline)
  const speakingRef = useRef(false);         // mirrors the `speaking` UI state
  const micOnRef = useRef(false);            // mirrors `micOn` for loop/callbacks
  const liveRef = useRef(false);             // mirrors phase === "live"
  // echo-cancelled VAD "guard ear" — lets barge-in work WHILE Ava talks and the
  // (non-echo-cancelled) recognizer is paused, so she "shuts up instantly".
  const vadStreamRef = useRef<MediaStream | null>(null);
  const vadCtxRef = useRef<AudioContext | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const vadCleanupRef = useRef<(() => void) | null>(null);
  const userSpokeAtRef = useRef(0);          // last ms the echo-cancelled mic heard YOU speak
  const vadActiveRef = useRef(false);        // the echo-cancelled sensing loop is running (else don't gate)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const finish = useCallback((reason: EndReason) => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopPolling();
    try { recRef.current?.abort(); } catch { /* noop */ }
    setMicOn(false);
    setEndReason(reason);
    setPhase("ended");
  }, [stopPolling]);

  // Poll /status until live, then keep polling to refresh stream/remaining/
  // transcript. Tolerates transient failures; a run of them = session died.
  const poll = useCallback(async () => {
    const id = sessionRef.current;
    if (!id || endedRef.current) return;
    try {
      const s = await demoFetch<StatusResp>(`/api/demo/${id}/status`, "GET");
      failRef.current = 0;
      if (s.streamUrl) setStreamUrl(s.streamUrl);
      if (typeof s.remainingSec === "number") setRemaining(Math.max(0, Math.round(s.remainingSec)));
      if (Array.isArray(s.transcript)) setTranscript(s.transcript.map(normalizeTurn).filter((t) => t.text));
      if (s.revealed) setRevealed(true); // sticky: once she reveals, the orb stays bottom-right
      if (s.status === "live") setPhase((p) => (p === "ended" || p === "error" ? p : "live"));
      else if (s.status === "connecting") setPhase((p) => (p === "queued" ? "queued" : "connecting"));
      else if (s.status === "ended") finish("ended");
      else if (s.status === "expired") finish("expired");
    } catch {
      failRef.current += 1;
      // A short blip is fine; a sustained run means the session died mid-demo.
      if (failRef.current >= 4) finish("died");
    }
  }, [finish]);

  // Kick off a session: POST /start, then begin polling.
  const start = useCallback(async () => {
    stopPolling();
    endedRef.current = false;
    failRef.current = 0;
    setErrMsg("");
    setTranscript([]);
    setRevealed(false);
    setRemaining(null);
    setQueuePos(null);
    setStreamUrl("");
    setPhase("connecting");
    try {
      // Attribution: pass the captured outbound source (?src / utm_*) as the demo
      // `utm` field so this demo is tied back to the campaign that drove it.
      const utm = attributionString();
      const r = await demoFetch<StartResp>("/api/demo/start", "POST", utm ? { utm } : {});
      sessionRef.current = r.sessionId;
      if (r.streamUrl) setStreamUrl(r.streamUrl);
      if (r.status === "queued") {
        setQueuePos(typeof r.queuePosition === "number" ? r.queuePosition : null);
        setPhase("queued");
      } else {
        setPhase("connecting");
      }
      // Begin polling (~2s) + a local 1s countdown between polls.
      pollRef.current = setInterval(poll, 2000);
      tickRef.current = setInterval(() => setRemaining((r2) => (r2 == null ? r2 : Math.max(0, r2 - 1))), 1000);
      poll();
    } catch (e) {
      // Distinguish the per-IP throttle (a normal abuse-control 429) from a real
      // capacity/endpoint problem, so a rate-limited guest isn't told the product
      // is overloaded. Never a stack trace in front of a prospect.
      const err = e as { status?: number; code?: string };
      if (err.status === 429 && err.code === "ip_active") {
        setErrMsg("You already have a demo open in another tab — close it, then start again.");
      } else if (err.status === 429) {
        setErrMsg("You've reached the demo limit for now. Give it a few minutes and try again.");
      } else {
        setErrMsg("Ava is at capacity right now. Give it a moment and try again.");
      }
      setPhase("error");
    }
  }, [poll, stopPolling]);

  // Start on mount; clean up (and best-effort end) on unmount.
  useEffect(() => {
    start();
    return () => {
      stopPolling();
      try { recRef.current?.abort(); } catch { /* noop */ }
      // release the VAD guard's mic + its audio context (the stream engine's
      // own AudioContext is torn down by its effect's cleanup).
      try { vadStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
      vadStreamRef.current = null;
      try { void vadCtxRef.current?.close(); } catch { /* closed */ }
      vadCtxRef.current = null;
      const id = sessionRef.current;
      if (id && !endedRef.current) { demoFetch(`/api/demo/${id}/end`, "POST", {}).catch(() => {}); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll the transcript to the newest line.
  useEffect(() => {
    if (showTranscript) feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [transcript, showTranscript]);

  // --- prospect turns -----------------------------------------------------
  const say = useCallback(async (raw: string) => {
    const t = raw.trim();
    const id = sessionRef.current;
    if (!t || !id) return;
    // Optimistically show the prospect's line (backend echoes it in transcript).
    setTranscript((prev) => [...prev, { ava: false, text: t }]);
    setSending(true);
    try { await demoFetch(`/api/demo/${id}/say`, "POST", { text: t }); } catch { /* transient; poll will reconcile */ }
    setSending(false);
  }, []);

  const submitText = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    say(t);
  };

  // Mirror micOn / live phase into refs so the audio loop and recognizer
  // callbacks read the current value without re-subscribing.
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  useEffect(() => { liveRef.current = phase === "live"; }, [phase]);

  // BARGE-IN / interrupt: drop everything scheduled and rejoin at the live edge.
  // Lifted from RehearsalRoom's streamFlush + stopVoice — the reason Ava "shuts
  // up instantly" the moment the prospect speaks.
  function stopPlayback() {
    streamSrcsRef.current.forEach((s) => { try { s.stop(); } catch { /* done */ } });
    streamSrcsRef.current = [];
    streamOffsetRef.current = -1;
    const ctx = audioCtxRef.current;
    if (ctx) streamNextTRef.current = ctx.currentTime;
    streamSpeakingRef.current = false;
  }

  // ---- echo-cancelled mic sensing (continuous while mic is on) ------------
  // This runs the WHOLE time you're on mic — it is the source of truth for
  // "are YOU actually speaking". Because getUserMedia here has echoCancellation,
  // Ava's voice (out your speakers) is stripped, so it only goes hot on YOUR
  // real speech. Two jobs: (1) instant barge-in — stop Ava the moment you talk;
  // (2) gate the raw SpeechRecognition results so Ava's own words (bleeding into
  // the non-cancelled recognizer mic on laptop speakers) are dropped, not sent.
  // Unlike the old design it NEVER stops the recognizer, so it can't miss the
  // start of what you say.
  function stopVadGuard() {
    if (vadRafRef.current !== null) cancelAnimationFrame(vadRafRef.current);
    vadRafRef.current = null;
    vadActiveRef.current = false;
    vadCleanupRef.current?.();
    vadCleanupRef.current = null;
  }
  async function startVadGuard() {
    if (!micOnRef.current || vadRafRef.current !== null) return;
    try {
      if (!vadStreamRef.current) {
        vadStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      }
      // 24kHz context so the capture node yields exactly the PCM rate Ava's
      // realtime input expects — no resampling needed.
      const ctx = vadCtxRef.current ?? new AudioContext({ sampleRate: 24000 });
      vadCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      const src = ctx.createMediaStreamSource(vadStreamRef.current);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      // CAPTURE: Float32 -> PCM16 -> base64 -> POST to the bff. The in-sandbox
      // bridge pulls this and feeds it straight into Ava's OpenAI realtime session
      // (input_audio_buffer.append). This IS the guest's voice channel now — the
      // stream is echo-cancelled, so Ava's own voice is never sent back to her, and
      // Whisper (server-side) transcribes far more accurately than browser STT.
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      let lastFrame: string | null = null; // 1-frame lookback so speech lead-in isn't clipped
      let wasSending = false;
      proc.onaudioprocess = (ev) => {
        if (!micOnRef.current || !liveRef.current) return;
        const f32 = ev.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) { let s = f32[i]; if (s > 1) s = 1; else if (s < -1) s = -1; pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
        const bytes = new Uint8Array(pcm.buffer);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const chunk = btoa(bin);
        const id = sessionRef.current;
        // Stream to Ava's realtime input ONLY while YOU are actually speaking (plus
        // a ~1.2s tail so server-VAD sees the trailing silence and closes the turn).
        // Sending continuous audio/silence let ambient noise trip her interrupt-on-
        // speech and cut her off — which made her seem to never speak at all. The
        // echo-cancelled VAD sets userSpokeAtRef; a 1-frame lookback keeps the lead-in.
        const speaking = (Date.now() - userSpokeAtRef.current) < 1200;
        if (id && speaking) {
          if (!wasSending && lastFrame) void demoFetch(`/api/demo/${id}/mic`, "POST", { chunk: lastFrame }).catch(() => { /* lead-in */ });
          wasSending = true;
          if (chunk) void demoFetch(`/api/demo/${id}/mic`, "POST", { chunk }).catch(() => { /* fire-and-forget */ });
        } else {
          wasSending = false;
        }
        lastFrame = chunk;
      };
      src.connect(proc);
      proc.connect(ctx.destination); // needed for onaudioprocess to fire; output stays silent (we never fill it)
      vadCleanupRef.current = () => {
        try { src.disconnect(); } catch { /* gone */ }
        try { proc.disconnect(); proc.onaudioprocess = null; } catch { /* gone */ }
      };
      vadActiveRef.current = true;
      const buf = new Uint8Array(an.fftSize);
      let hot = 0;
      // Adaptive (SNR-based) speech gate. A fixed floor is always wrong for some
      // room: 0.045 lost whispers, 0.02 let breaths / button-clicks / fan noise
      // trip the gate and interrupt Ava. Instead, learn the room's ambient level
      // (EMA over non-speech frames) and require energy to clear BOTH a small
      // absolute floor AND a margin above that ambient. In a quiet room the floor
      // dominates, so whispers still pass; in a noisy room the bar rises with the
      // noise, so ambient stops opening the mic. Sustain requirement is longer
      // (~100ms) so transient clicks — which are short — can't trip it.
      let noiseFloor = 0.012; // adaptive ambient estimate
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
        const rms = Math.sqrt(sum / buf.length);
        const speechThresh = Math.max(0.03, noiseFloor * 2.8);
        if (rms > speechThresh) {
          hot += 1;
        } else {
          hot = 0;
          noiseFloor = noiseFloor * 0.94 + rms * 0.06; // learn ambient from non-speech frames only
        }
        if (hot >= 6) { userSpokeAtRef.current = Date.now(); stopPlayback(); } // ~100ms of sustained, above-ambient energy = real speech (not a breath or click)
        vadRafRef.current = requestAnimationFrame(tick);
      };
      vadRafRef.current = requestAnimationFrame(tick);
    } catch { vadActiveRef.current = false; setErrMsg("I couldn't reach your mic — you can type to Ava instead."); }
  }

  // Browser Web Speech STT is RETIRED. The guest's voice now streams as PCM into
  // Ava's OpenAI realtime model (see startVadGuard's capture node), which does its
  // own Whisper transcription + server-VAD turn-taking — far more accurate and
  // immune to speaker echo. The text box remains as a no-mic fallback.
  const toggleMic = useCallback(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setErrMsg("This browser can't capture your mic — type to Ava instead."); return; }
    if (micOn) { setMicOn(false); micOnRef.current = false; stopVadGuard(); return; }
    setMicOn(true);
    micOnRef.current = true;   // set now so startVadGuard's own guard passes synchronously
    void startVadGuard();      // echo-cancelled capture -> bff -> Ava's realtime input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micOn]);

  // Autoplay unlock: the AudioContext is created only once the session goes live
  // (seconds after the "Talk to Ava" click), so that original gesture has expired
  // and Chrome suspends it — you'd see Ava move but hear nothing. Resume it on ANY
  // subsequent user interaction (click / key / touch) so her voice actually plays.
  useEffect(() => {
    const resume = () => {
      let c = audioCtxRef.current;
      if (!c) { try { c = new AudioContext({ sampleRate: 24000 }); audioCtxRef.current = c; } catch { return; } }
      if (c.state === "suspended") void c.resume().then(() => setMuted(false)).catch(() => { /* next gesture */ });
      else setMuted(false);
    };
    const evs: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    for (const ev of evs) window.addEventListener(ev, resume);
    return () => { for (const ev of evs) window.removeEventListener(ev, resume); };
  }, []);

  // Explicit "tap to hear Ava" — the reliable unlock. Creates+resumes the shared
  // ctx synchronously inside the click gesture, so the stream engine reuses an
  // already-running context and Ava is audible immediately.
  const unlockAudio = useCallback(() => {
    let c = audioCtxRef.current;
    if (!c) { try { c = new AudioContext({ sampleRate: 24000 }); audioCtxRef.current = c; } catch { setMuted(false); return; } }
    if (c.state === "suspended") void c.resume().then(() => setMuted(false)).catch(() => setMuted(false));
    else setMuted(false);
  }, []);

  // ---- stream engine: poll /api/demo/:id/audio, schedule PCM via Web Audio -
  // A direct port of RehearsalRoom's live-audio effect (~1168-1237): what you
  // hear is the sandbox's ACTUAL output (EL hybrid voice, real pacing). While
  // Ava is voicing, the (non-echo-cancelled) recognizer pauses and the VAD guard
  // listens for YOUR barge-in — same discipline as the studio. Autoplay is fine:
  // the "Talk to Ava" click that mounted this screen is the user gesture.
  useEffect(() => {
    if (phase !== "live") return;
    const id = sessionRef.current;
    if (!id) return;
    let stopped = false;
    // Reuse the ctx the unlock gesture already created+resumed, if any — a fresh
    // one here would be born suspended again and stay silent until re-gestured.
    const ctx = audioCtxRef.current ?? new AudioContext({ sampleRate: 24000 });
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") void ctx.resume().catch(() => { /* gesture may be needed */ });
    else setMuted(false);
    streamNextTRef.current = 0;
    streamOffsetRef.current = -1;
    const loop = async () => {
      while (!stopped) {
        try {
          const r = await demoFetch<AudioResp>(`/api/demo/${id}/audio?after=${streamOffsetRef.current}`, "GET");
          if (stopped) break;
          if (!r.live) {
            if (speakingRef.current) { speakingRef.current = false; setSpeaking(false); }
            // poll fast while idle so Ava's FIRST word is caught quickly (was 1500ms)
            await new Promise((res) => setTimeout(res, 350));
            continue;
          }
          streamOffsetRef.current = r.offset;
          if (r.chunk) {
            const bin = atob(r.chunk);
            const n = bin.length & ~1;
            if (n > 1) {
              const f32 = new Float32Array(n / 2);
              let voiced = false;
              for (let i = 0; i < n / 2; i++) {
                let v = (bin.charCodeAt(2 * i + 1) << 8) | bin.charCodeAt(2 * i);
                if (v >= 0x8000) v -= 0x10000;
                f32[i] = v / 32768;
                if (v > 600 || v < -600) voiced = true;
              }
              if (voiced) streamVoicedAtRef.current = Date.now();
              const abuf = ctx.createBuffer(1, f32.length, 24000);
              abuf.getChannelData(0).set(f32);
              const src = ctx.createBufferSource();
              src.buffer = abuf;
              src.connect(ctx.destination);
              const t = Math.max(ctx.currentTime + 0.12, streamNextTRef.current);
              src.start(t);
              streamNextTRef.current = t + abuf.duration;
              streamSrcsRef.current.push(src);
              src.onended = () => { streamSrcsRef.current = streamSrcsRef.current.filter((x) => x !== src); };
            }
          }
          // reflect real-voice state in the UI (orb + waveform pulse)
          const now = Date.now();
          const voicedRecently = now - streamVoicedAtRef.current < 900;
          if (voicedRecently !== speakingRef.current) { speakingRef.current = voicedRecently; setSpeaking(voicedRecently); }
          // Full-duplex: the recognizer + echo-cancelled sensing run continuously
          // the whole time your mic is on (started in toggleMic), so we no longer
          // stop/swap them as Ava speaks — that swap is exactly what lost the start
          // of your turns and made you repeat yourself. Just track her speaking
          // latch for the UI; barge-in + echo-gating happen in the sensing loop.
          if (voicedRecently && !streamSpeakingRef.current) {
            streamSpeakingRef.current = true;
          } else if (!voicedRecently && streamSpeakingRef.current && now - streamVoicedAtRef.current > 1200) {
            streamSpeakingRef.current = false;
          }
        } catch { /* next poll */ }
        await new Promise((res) => setTimeout(res, 180)); // tighter stream cadence (was 500ms)
      }
    };
    void loop();
    // Ava opens the call herself: once the audio loop is live and listening,
    // ask the bridge to fire her proactive greeting (the warm bridge suppresses
    // its own auto-greet). Small delay so the loop has set its stream offset
    // first, so her opening line is never missed.
    if (!greetedRef.current) {
      greetedRef.current = true;
      setTimeout(() => { const gid = sessionRef.current; if (gid && !endedRef.current) demoFetch(`/api/demo/${gid}/greet`, "POST", {}).catch(() => { /* poll reconciles */ }); }, 700);
    }
    return () => {
      stopped = true;
      speakingRef.current = false;
      setSpeaking(false);
      streamSpeakingRef.current = false;
      stopVadGuard();
      streamSrcsRef.current.forEach((s) => { try { s.stop(); } catch { /* done */ } });
      streamSrcsRef.current = [];
      audioCtxRef.current = null;
      void ctx.close().catch(() => { /* closed */ });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const endByUser = useCallback(() => {
    const id = sessionRef.current;
    if (id) demoFetch(`/api/demo/${id}/end`, "POST", {}).catch(() => {});
    finish("user");
  }, [finish]);

  const submitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = sessionRef.current;
    const em = email.trim();
    if (!em || leadState === "sending") return;
    setLeadState("sending");
    try {
      if (id) await demoFetch(`/api/demo/${id}/lead`, "POST", { email: em });
      setLeadState("done");
    } catch {
      // Don't strand the lead if the endpoint blips — treat as captured and let
      // them continue to signup (the signup flow re-collects the email anyway).
      setLeadState("done");
    }
  };

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const wrapUp = phase === "live" && remaining != null && remaining <= 30;

  return (
    <div
      className="ah-public"
      data-theme={nav.theme}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "var(--bg)", color: "var(--ink1)", display: "flex", flexDirection: "column" }}
      role="dialog"
      aria-modal="true"
      aria-label="Talk to Ava, After Human's live AI rep"
    >
      {/* Ambient brand glows (decorative) */}
      <div aria-hidden style={{ position: "absolute", top: -160, left: -120, width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,6,96,.14), transparent 70%)", pointerEvents: "none", animation: "ahpFloatA 9s ease-in-out infinite" }} />
      <div aria-hidden style={{ position: "absolute", top: -60, right: -80, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(163,66,255,.14), transparent 70%)", pointerEvents: "none", animation: "ahpFloatB 11s ease-in-out infinite" }} />

      {/* Top bar: identity, live status, countdown, close */}
      <header style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderBottom: "1px solid var(--divider)", background: "var(--nav-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/assets/afterhuman-mark.svg" alt="" style={{ width: 30, height: 30, display: "block" }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1 }}>Ava</div>
            <div style={{ fontSize: 11.5, color: "var(--ink3)", fontWeight: 500 }}>After Human's AI rep</div>
          </div>
        </div>
        <StatusPill phase={phase} endReason={endReason} />
        {phase === "live" && remaining != null && (
          <div title="Demo time remaining" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: wrapUp ? PINK : "var(--ink2)", padding: "5px 11px", borderRadius: 9999, border: "1px solid var(--border)" }}>
            <Icon name="timer" style={{ fontSize: 16 }} />{mmss(remaining)}
          </div>
        )}
        <button
          onClick={() => { const id = sessionRef.current; if (id && !endedRef.current) demoFetch(`/api/demo/${id}/end`, "POST", {}).catch(() => {}); stopPolling(); try { recRef.current?.abort(); } catch { /* noop */ } nav.go("#/"); }}
          title="Close the demo"
          aria-label="Close the demo and return to the site"
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 15px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
        >
          <Icon name="close" style={{ fontSize: 18 }} />Close
        </button>
      </header>

      {/* Body */}
      <main style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", overflowY: "auto" }}>
        {(phase === "connecting" || phase === "queued") && (
          <ConnectingView phase={phase} queuePos={queuePos} />
        )}

        {phase === "error" && (
          <RecoveryCard
            title="Ava couldn't pick up"
            body={errMsg || "We couldn't reach Ava right now."}
            onRetry={start}
            nav={nav}
          />
        )}

        {phase === "live" && (
          <LiveView
            streamUrl={streamUrl}
            transcript={transcript}
            showTranscript={showTranscript}
            setShowTranscript={setShowTranscript}
            feedRef={feedRef}
            wrapUp={wrapUp}
            speaking={speaking}
            revealed={revealed}
          />
        )}

        {phase === "live" && muted && (
          <SoundUnlock onUnlock={unlockAudio} />
        )}

        {phase === "ended" && (
          endReason === "died" ? (
            <RecoveryCard
              title="The demo dropped"
              body="Ava's session ended unexpectedly. It happens — start a fresh one and pick up where you left off."
              onRetry={start}
              nav={nav}
              secondary={
                <LeadCapture email={email} setEmail={setEmail} leadState={leadState} onSubmit={submitLead} nav={nav} compact />
              }
            />
          ) : (
            <EndView
              reason={endReason}
              email={email}
              setEmail={setEmail}
              leadState={leadState}
              onSubmit={submitLead}
              nav={nav}
              onReplay={start}
            />
          )
        )}
      </main>

      {/* Bottom control bar — mic, text (always available), transcript, end.
          Only while live; the closed states carry their own actions. */}
      {phase === "live" && (
        <footer style={{ position: "relative", zIndex: 2, borderTop: "1px solid var(--divider)", background: "var(--nav-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", padding: "12px 16px" }}>
          {wrapUp && (
            <div style={{ maxWidth: 900, margin: "0 auto 10px", textAlign: "center", fontSize: 12.5, fontWeight: 600, color: PINK }}>
              Heads up — the demo is wrapping up. Drop your email below to keep going with your own clone.
            </div>
          )}
          <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={toggleMic}
              aria-pressed={micOn}
              title={micOn ? "Mute your mic" : "Talk to Ava with your mic"}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, height: 48, padding: "0 18px", borderRadius: 9999, border: "none", background: micOn ? GREEN : "var(--card)", color: micOn ? "#04042A" : "var(--ink1)", boxShadow: micOn ? "none" : "inset 0 0 0 1px var(--border)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              <Icon name={micOn ? "mic" : "mic_off"} style={{ fontSize: 20 }} />{micOn ? "Listening" : "Talk"}
            </button>
            <form onSubmit={submitText} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 220, height: 48, padding: "0 8px 0 16px", borderRadius: 9999, background: "var(--card)", border: "2px solid var(--border)" }}>
              <Icon name="chat" style={{ fontSize: 19, color: "var(--ink3)" }} />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type to Ava…"
                aria-label="Type a message to Ava"
                style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 14.5, fontWeight: 500, color: "var(--ink1)" }}
              />
              <button type="submit" disabled={!text.trim() || sending} aria-label="Send" title="Send" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: "50%", border: "none", background: text.trim() ? PINK : "var(--border)", color: "#fff", cursor: text.trim() ? "pointer" : "default" }}>
                <Icon name="arrow_upward" style={{ fontSize: 18 }} />
              </button>
            </form>
            <button
              onClick={() => setShowTranscript((v) => !v)}
              aria-pressed={showTranscript}
              title="Toggle transcript"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 48, padding: "0 16px", borderRadius: 9999, border: "1px solid var(--border)", background: showTranscript ? "var(--panel)" : "transparent", color: "var(--ink1)", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
            >
              <Icon name="notes" style={{ fontSize: 19 }} />Transcript
            </button>
            <button
              onClick={endByUser}
              title="End the demo"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 48, padding: "0 18px", borderRadius: 9999, border: "none", background: "#E1173F", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              <Icon name="call_end" style={{ fontSize: 20 }} />End
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}

// --- pieces ---------------------------------------------------------------

function StatusPill({ phase, endReason }: { phase: Phase; endReason: EndReason }) {
  const map: Record<string, { dot: string; label: string; anim?: boolean }> = {
    connecting: { dot: "#A342FF", label: "Connecting", anim: true },
    queued: { dot: "#00BBFF", label: "In the queue", anim: true },
    live: { dot: GREEN, label: "Live", anim: true },
    error: { dot: "#E1173F", label: "Unavailable" },
    ended: { dot: "var(--ink3)", label: endReason === "expired" ? "Time's up" : endReason === "died" ? "Dropped" : "Ended" },
  };
  const s = map[phase] || map.ended;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 9999, background: "var(--panel)", color: "var(--ink2)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot, animation: s.anim ? "ahpDot 1.4s ease-in-out infinite" : "none" }} />
      {s.label}
    </span>
  );
}

// The voice orb — the product's Demo Mode signature, recast in public tokens.
// `speaking` pulses the ring; otherwise it breathes softly (listening).
function AvaOrb({ size = 132, speaking = false, assembling = false }: { size?: number; speaking?: boolean; assembling?: boolean }) {
  const anim = assembling ? "ahpOrbForm 1.8s ease-in-out infinite" : speaking ? "ahpRing 1.6s ease-in-out infinite" : "ahpBreathe 3.4s ease-in-out infinite";
  return (
    <div
      aria-hidden
      style={{
        width: size, height: size, borderRadius: "50%",
        background: "radial-gradient(circle at 32% 30%, rgba(255,6,96,.55), rgba(163,66,255,.5) 55%, rgba(0,187,255,.4))",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontWeight: 800, fontSize: size * 0.24, letterSpacing: "-.02em",
        boxShadow: "0 20px 60px rgba(163,66,255,.35)", animation: anim,
      }}
    >
      Ava
    </div>
  );
}

function Wave({ active, color = GREEN }: { active: boolean; color?: string }) {
  const delays = ["0s", ".15s", ".3s", ".15s", "0s"];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 18 }} aria-hidden>
      {delays.map((d, i) => (
        <span key={i} style={{ width: 3, height: "100%", borderRadius: 2, background: color, transformOrigin: "bottom", opacity: active ? 1 : 0.4, animation: active ? "ahpWave .9s ease-in-out infinite" : "none", animationDelay: d }} />
      ))}
    </div>
  );
}

// Autoplay unlock — covers the live view until the user taps once. The tap is
// the gesture Chrome requires to let Ava's audio play; unlockAudio() runs the
// resume synchronously inside it.
function SoundUnlock({ onUnlock }: { onUnlock: () => void }) {
  return (
    <button
      onClick={onUnlock}
      aria-label="Tap to hear Ava"
      style={{
        position: "absolute", inset: 0, zIndex: 30, width: "100%", height: "100%",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18,
        border: "none", cursor: "pointer", color: "var(--ink1)",
        background: "rgba(4,4,42,0.72)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 92, height: 92, borderRadius: 9999, background: GREEN, color: "#04042A", boxShadow: "0 8px 40px rgba(46,211,125,.5)", animation: "ahpPulse 1.6s ease-in-out infinite" }}>
        <Icon name="volume_up" style={{ fontSize: 44 }} />
      </span>
      <span style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-.02em" }}>Tap to hear Ava</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink2)", maxWidth: 320, textAlign: "center", lineHeight: 1.5 }}>
        Ava is already live — your browser just needs one tap to turn her voice on.
      </span>
    </button>
  );
}

function ConnectingView({ phase, queuePos }: { phase: Phase; queuePos: number | null }) {
  const queued = phase === "queued";
  return (
    <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 22, maxWidth: 520 }}>
      <AvaOrb assembling size={140} />
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-.02em" }} aria-live="polite">
          {queued ? "You're in line for Ava" : "Ava is joining"}
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: 15, color: "var(--ink2)", lineHeight: 1.55 }}>
          {queued
            ? "Every live demo runs on a real machine, so there's a short wait when they're all busy. We'll pull you in automatically."
            : "Ava is spinning up a live browser and warming up her voice. This usually takes a few seconds."}
        </p>
        {queued && queuePos != null && (
          <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, padding: "8px 16px", borderRadius: 9999, background: "var(--panel)", color: "var(--ink1)" }}>
            <Icon name="groups" style={{ fontSize: 18, color: "#00BBFF" }} />
            {queuePos === 1 ? "You're next" : `Position ${queuePos} in line`}
          </div>
        )}
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 12.5, fontWeight: 600, color: "var(--ink3)" }}>
        <Icon name="progress_activity" style={{ fontSize: 18, color: "#A342FF", animation: "ahpSpin 1.2s linear infinite" }} />
        {queued ? "Holding your spot…" : "Warming up…"}
      </div>
    </div>
  );
}

function LiveView({
  streamUrl, transcript, showTranscript, setShowTranscript, feedRef, wrapUp, speaking, revealed,
}: {
  streamUrl: string; transcript: Turn[]; showTranscript: boolean;
  setShowTranscript: (v: boolean) => void; feedRef: React.MutableRefObject<HTMLDivElement | null>; wrapUp: boolean; speaking: boolean; revealed: boolean;
}) {
  const lastAva = [...transcript].reverse().find((t) => t.ava);
  let host = "ava's screen";
  try { if (streamUrl) host = new URL(streamUrl).host; } catch { /* noop */ }

  return (
    <div style={{ width: "100%", maxWidth: showTranscript ? 1180 : 900, display: "grid", gridTemplateColumns: showTranscript ? "minmax(0,1fr) 320px" : "minmax(0,1fr)", gap: 16, alignItems: "start" }} className="ahp-live-grid">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Live screen stage — the E2B stream, embedded exactly like the studio */}
        <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--border)", background: "var(--card)", boxShadow: "0 20px 60px rgba(0,0,64,.18)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", background: "var(--panel)", borderBottom: "1px solid var(--divider)" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FF5F57" }} />
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FEBC2E" }} />
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#28C840" }} />
            <span style={{ marginLeft: 8, fontSize: 11.5, color: "var(--ink3)", fontFamily: "ui-monospace, monospace" }}>{host}</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: revealed ? PINK : "var(--ink3)" }}>
              <Icon name="present_to_all" style={{ fontSize: 14 }} />{revealed ? "Ava is sharing" : "Ava is live"}
            </span>
          </div>
          <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 10", background: "#05070d" }}>
            {streamUrl ? (
              <iframe
                src={streamUrl}
                title="Ava's live screen"
                allow="autoplay"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
              />
            ) : (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,.6)", fontSize: 13, fontWeight: 600 }}>
                Ava's screen is coming up…
              </div>
            )}
            {/* Branded curtain over the stream until Ava reveals the product —
                a clean After Human backdrop for the discovery moment (hides the
                loader/dashboard behind it). Fades out on reveal. */}
            <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 15, display: "grid", placeItems: "center",
              background: "radial-gradient(ellipse at 50% 42%, #14143f 0%, #05052c 70%)",
              opacity: revealed ? 0 : 1, transition: "opacity .55s ease", pointerEvents: "none" }}>
              <div style={{ position: "absolute", bottom: "20%", textAlign: "center" }}>
                <div style={{ fontSize: 14, letterSpacing: ".01em", color: "#B9B9D9" }}>Live demo · with Ava</div>
                <div style={{ margin: "12px auto 0", width: 44, height: 4, borderRadius: 2, background: "#A342FF" }} />
              </div>
            </div>
            {/* The ONE Ava orb: centered + large during discovery, glides to the
                bottom-right self-view the instant she reveals the product. */}
            <div style={{ position: "absolute", zIndex: 20,
              borderRadius: revealed ? 14 : "50%",
              background: "rgba(4,4,42,.55)", backdropFilter: "blur(6px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid rgba(255,255,255,.15)",
              left: revealed ? "calc(100% - 12px)" : "50%",
              top: revealed ? "calc(100% - 12px)" : "50%",
              width: revealed ? 92 : 168, height: revealed ? 92 : 168,
              transform: revealed ? "translate(-100%, -100%)" : "translate(-50%, -50%)",
              transition: "left .7s cubic-bezier(.4,0,.2,1), top .7s cubic-bezier(.4,0,.2,1), width .7s cubic-bezier(.4,0,.2,1), height .7s cubic-bezier(.4,0,.2,1), transform .7s cubic-bezier(.4,0,.2,1), border-radius .7s ease" }}>
              <AvaOrb size={revealed ? 64 : 120} speaking={speaking} />
            </div>
          </div>
        </div>

        {/* Voice bar + live caption (last thing Ava said) */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 14, background: "var(--card)", border: "1px solid var(--border)" }}>
          <Wave active={speaking} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} aria-live="polite">
            {lastAva ? lastAva.text : "Ava is live — say hello, or ask her to show you the product."}
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: wrapUp ? PINK : "var(--ink3)", whiteSpace: "nowrap" }}>Ava, real voice</span>
        </div>
      </div>

      {showTranscript && (
        <aside style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--card)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: 460 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--divider)" }}>
            <Icon name="notes" style={{ fontSize: 18, color: "var(--ink3)" }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Transcript</span>
            <button onClick={() => setShowTranscript(false)} aria-label="Hide transcript" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--ink3)", cursor: "pointer", display: "flex" }}>
              <Icon name="close" style={{ fontSize: 18 }} />
            </button>
          </div>
          <div ref={feedRef} className="ahp-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {transcript.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>The conversation will show up here as you and Ava talk.</div>
            ) : (
              transcript.map((t, i) => (
                <div key={i} style={{ alignSelf: t.ava ? "flex-start" : "flex-end", maxWidth: "88%" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 3, textAlign: t.ava ? "left" : "right" }}>{t.ava ? "Ava" : "You"}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.45, padding: "9px 12px", borderRadius: 12, background: t.ava ? "var(--panel)" : PINK, color: t.ava ? "var(--ink1)" : "#fff" }}>{t.text}</div>
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function RecoveryCard({ title, body, onRetry, nav, secondary }: { title: string; body: string; onRetry: () => void; nav: Nav; secondary?: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", maxWidth: 460, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      <div style={{ width: 68, height: 68, borderRadius: "50%", background: "var(--panel)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="sentiment_dissatisfied" style={{ fontSize: 34, color: "#A342FF" }} />
      </div>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-.02em" }}>{title}</h1>
        <p style={{ margin: "10px 0 0", fontSize: 15, color: "var(--ink2)", lineHeight: 1.55 }}>{body}</p>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={onRetry} style={primaryBtn}>
          <Icon name="refresh" style={{ fontSize: 20 }} />Try again
        </button>
        <button onClick={() => nav.go("#/")} style={ghostBtn}>Back to site</button>
      </div>
      {secondary}
    </div>
  );
}

function EndView({ reason, email, setEmail, leadState, onSubmit, nav, onReplay }: {
  reason: EndReason; email: string; setEmail: (v: string) => void;
  leadState: "idle" | "sending" | "done" | "error"; onSubmit: (e: React.FormEvent) => void; nav: Nav; onReplay: () => void;
}) {
  const headline = reason === "expired" ? "That's your demo with Ava" : "Thanks for talking with Ava";
  return (
    <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
      <AvaOrb size={96} />
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-.02em" }}>{headline}</h1>
        <p style={{ margin: "12px 0 0", fontSize: 16, color: "var(--ink2)", lineHeight: 1.55 }}>
          That was a clone of a real rep — voice, screen, and judgment. Want your own? Get the recording and start free.
        </p>
      </div>

      {leadState === "done" ? (
        <div style={{ width: "100%", textAlign: "center", background: "var(--panel)", borderRadius: 20, padding: "28px 24px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: "50%", background: "rgba(46,211,125,.16)", marginBottom: 14 }}>
            <Icon name="check" style={{ fontSize: 28, color: "#0E8A4F" }} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>You're on the list</div>
          <p style={{ margin: "8px auto 20px", fontSize: 14.5, color: "var(--ink2)", maxWidth: 380, lineHeight: 1.5 }}>
            The recording is on its way. Clone your best rep next — the first clone is $2,000/mo and you rehearse free until it clears the readiness bar.
          </p>
          <button onClick={() => nav.go("#/auth")} style={{ ...primaryBtn, height: 54, fontSize: 16, margin: "0 auto" }}>
            Clone your rep<Icon name="arrow_forward" style={{ fontSize: 20 }} />
          </button>
        </div>
      ) : (
        <LeadCapture email={email} setEmail={setEmail} leadState={leadState} onSubmit={onSubmit} nav={nav} />
      )}

      <button onClick={onReplay} style={{ ...ghostBtn, height: 44 }}>
        <Icon name="replay" style={{ fontSize: 19 }} />Talk to Ava again
      </button>
    </div>
  );
}

function LeadCapture({ email, setEmail, leadState, onSubmit, nav, compact }: {
  email: string; setEmail: (v: string) => void; leadState: "idle" | "sending" | "done" | "error";
  onSubmit: (e: React.FormEvent) => void; nav: Nav; compact?: boolean;
}) {
  return (
    <div style={{ width: "100%", background: compact ? "transparent" : "var(--panel)", borderRadius: 20, padding: compact ? 0 : "26px 24px" }}>
      {!compact && (
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Want your own clone?</div>
          <div style={{ fontSize: 13.5, color: "var(--ink3)", marginTop: 4 }}>Get the recording and start free</div>
        </div>
      )}
      <form onSubmit={onSubmit} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 220, height: 54, padding: "0 8px 0 18px", borderRadius: 9999, background: "var(--card)", border: "2px solid var(--border)" }}>
          <Icon name="mail" style={{ fontSize: 20, color: "var(--ink3)" }} />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Your work email"
            aria-label="Your work email"
            style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 15, fontWeight: 500, color: "var(--ink1)" }}
          />
        </div>
        <button type="submit" disabled={leadState === "sending"} style={{ ...primaryBtn, height: 54, fontSize: 16, opacity: leadState === "sending" ? 0.7 : 1 }}>
          {leadState === "sending" ? "Sending…" : "Get the recording"}<Icon name="arrow_forward" style={{ fontSize: 20 }} />
        </button>
      </form>
      <button onClick={() => nav.go("#/auth")} style={{ marginTop: 12, background: "none", border: "none", color: "var(--ink3)", fontSize: 13, fontWeight: 600, cursor: "pointer", width: "100%", textAlign: "center" }}>
        or skip and start free
      </button>
    </div>
  );
}

const primaryBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, height: 48, padding: "0 22px",
  border: "none", borderRadius: 9999, background: PINK, color: "#fff", fontSize: 15,
  fontWeight: 700, letterSpacing: ".02em", cursor: "pointer", boxShadow: "0 8px 24px rgba(255,6,96,.3)",
};
const ghostBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, height: 48, padding: "0 20px",
  border: "1px solid var(--border)", borderRadius: 9999, background: "transparent",
  color: "var(--ink1)", fontSize: 14, fontWeight: 600, cursor: "pointer",
};
