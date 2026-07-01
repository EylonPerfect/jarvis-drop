import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typing for the (prefixed) Web Speech API.
type SpeechRecognitionCtor = new () => any;
function getSR(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export interface Speech {
  supported: boolean; // STT available AND secure context
  secure: boolean; // https or localhost (mic requires this)
  listening: boolean;
  interim: string; // live partial transcript
  level: number; // 0..1 mic amplitude (drives the visualizer)
  start: () => void;
  stop: () => void;
  pause: () => void; // temporarily ignore input (e.g. while JARVIS is speaking)
  resume: () => void; // re-arm after pause() if still listening
}

/**
 * Real voice input: microphone transcription (Web Speech API) + a live
 * amplitude level (Web Audio analyser) so the UI visibly reacts to sound.
 * onFinal fires with each completed utterance. Requires a secure context
 * (HTTPS or localhost) and a Chromium-based browser for SpeechRecognition.
 */
export function useSpeech(onFinal: (text: string) => void): Speech {
  const SR = getSR();
  const secure = typeof window !== "undefined" && (window.isSecureContext ?? false);
  const supported = !!SR && secure;

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);

  const recRef = useRef<any>(null);
  const listeningRef = useRef(false);
  listeningRef.current = listening;
  const pausedRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const audioRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      cancelAnimationFrame(a.raf);
      a.stream.getTracks().forEach((t) => t.stop());
      a.ctx.close().catch(() => {});
      audioRef.current = null;
    }
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    setListening(false);
    listeningRef.current = false;
    pausedRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
    stopAudio();
  }, [stopAudio]);

  // Pause/resume recognition without tearing down the session. Used to mute the
  // mic while JARVIS speaks so its own voice isn't transcribed as a new query.
  const pause = useCallback(() => {
    pausedRef.current = true;
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    if (listeningRef.current) {
      try {
        recRef.current?.start();
      } catch {
        /* noop */
      }
    }
  }, []);

  const start = useCallback(async () => {
    if (!supported || !SR) return;
    setInterim("");

    // Mic amplitude → level (independent of recognition, for the visualizer).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.2));
        if (audioRef.current) audioRef.current.raf = requestAnimationFrame(tick);
      };
      audioRef.current = { ctx, stream, raf: requestAnimationFrame(tick) };
    } catch {
      /* mic denied — recognition may still prompt separately */
    }

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      if (pausedRef.current) return; // ignore captured audio while paused (TTS playing)
      let itr = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const t = String(r[0].transcript).trim();
          if (t) onFinalRef.current(t);
          setInterim("");
        } else {
          itr += r[0].transcript;
        }
      }
      if (itr) setInterim(itr);
    };
    rec.onerror = () => {};
    rec.onend = () => {
      // Chrome auto-stops; restart while the user still wants to listen and
      // we're not deliberately paused (JARVIS speaking).
      if (recRef.current === rec && listeningRef.current && !pausedRef.current) {
        try {
          rec.start();
        } catch {
          /* noop */
        }
      }
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
      listeningRef.current = true;
    } catch {
      /* noop */
    }
  }, [supported, SR]);

  useEffect(
    () => () => {
      try {
        recRef.current?.stop();
      } catch {
        /* noop */
      }
      stopAudio();
    },
    [stopAudio],
  );

  return { supported, secure, listening, interim, level, start, stop, pause, resume };
}

// ---------------------------------------------------------------------------
// Voice output (text-to-speech). Speaks JARVIS's replies aloud via the Web
// Speech Synthesis API. Prefers a natural English voice, cancels on demand,
// and reports `speaking` so the caller can duck the mic to avoid feedback.
// ---------------------------------------------------------------------------
export interface VoiceOut {
  supported: boolean;
  speaking: boolean;
  speak: (text: string, opts?: { onStart?: () => void; onEnd?: () => void }) => void;
  cancel: () => void;
}

function pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const byName = (re: RegExp) => voices.find((v) => re.test(v.name));
  // Prefer a crisp English voice; fall back to any en-* then the first voice.
  return (
    byName(/Google UK English Male/i) ||
    byName(/Daniel|Arthur|Oliver/i) ||
    byName(/Google US English/i) ||
    voices.find((v) => /^en(-|_)?GB/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    voices[0]
  );
}

export function useVoiceOutput(): VoiceOut {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const supported = !!synth;
  const [speaking, setSpeaking] = useState(false);

  // Voices load async in some browsers; warm the list so pickVoice() has data.
  useEffect(() => {
    if (!synth) return;
    const warm = () => synth.getVoices();
    warm();
    synth.addEventListener?.("voiceschanged", warm);
    return () => synth.removeEventListener?.("voiceschanged", warm);
  }, [synth]);

  const cancel = useCallback(() => {
    if (!synth) return;
    synth.cancel();
    setSpeaking(false);
  }, [synth]);

  const speak = useCallback(
    (text: string, opts?: { onStart?: () => void; onEnd?: () => void }) => {
      if (!synth) return;
      const clean = text.replace(/\s+/g, " ").trim();
      if (!clean) return;
      synth.cancel(); // never queue — always speak the latest reply
      const u = new SpeechSynthesisUtterance(clean);
      const v = pickVoice(synth);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      }
      u.rate = 1.02;
      u.pitch = 1.0;
      u.onstart = () => {
        setSpeaking(true);
        opts?.onStart?.();
      };
      const done = () => {
        setSpeaking(false);
        opts?.onEnd?.();
      };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    },
    [synth],
  );

  return { supported, speaking, speak, cancel };
}
