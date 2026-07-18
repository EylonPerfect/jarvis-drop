// Live real-time voice agent — runs INSIDE the Recall Output Media bot's browser
// as its camera+mic. getUserMedia() here is the mixed meeting audio; whatever we
// play becomes the bot's voice. We open an OpenAI Realtime WebRTC session
// (speech-to-speech, interruptible) and stream a REAL, agent-driven browser as
// the shared screen (computer-use): the agent navigates/scrolls/clicks and we
// poll frames of that live browser.
import { useEffect, useRef, useState } from "react";

interface LiveConfig { title: string; url: string; voice: string }
type Phase = "connecting" | "live" | "speaking" | "listening" | "error";

export default function Live() {
  const id = new URLSearchParams(window.location.search).get("s") ?? "";
  const [cfg, setCfg] = useState<LiveConfig | null>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [detail, setDetail] = useState("");
  const [caption, setCaption] = useState("");
  const [frameN, setFrameN] = useState(0);
  const [haveFrame, setHaveFrame] = useState(false);
  const [needGesture, setNeedGesture] = useState(false); // browser autoplay fallback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const captionRef = useRef("");

  // Load config (title / demo URL / voice).
  useEffect(() => {
    if (!id) { setPhase("error"); setDetail("Missing session id."); return; }
    fetch(`/api/live/${id}`).then((r) => r.json()).then((j) => { if (j?.url) setCfg(j); }).catch(() => {});
  }, [id]);

  // Frames are EVENT-DRIVEN, not continuously polled: fetching+decoding a JPEG
  // every second in Recall's browser competes with the audio and reintroduces
  // stutter. So we grab a few frames at startup (homepage) and a short burst
  // right after each agent action; otherwise the screen stays static (the page
  // only changes when the agent acts anyway). A very slow safety poll catches
  // late-loading content without loading the CPU.
  useEffect(() => {
    const boot = [1200, 3000, 5000].map((ms) => setTimeout(() => setFrameN((n) => n + 1), ms));
    const t = setInterval(() => setFrameN((n) => n + 1), 12000);
    return () => { boot.forEach(clearTimeout); clearInterval(t); };
  }, []);
  const refreshFrames = () => { [300, 900, 1700, 2800].forEach((ms) => setTimeout(() => setFrameN((n) => n + 1), ms)); };

  // Flush buffered captions ~3x/sec instead of on every streamed token.
  useEffect(() => {
    const t = setInterval(() => setCaption(captionRef.current.slice(-240)), 320);
    return () => clearInterval(t);
  }, []);

  // OpenAI Realtime WebRTC session.
  useEffect(() => {
    if (!id) return;
    let pc: RTCPeerConnection | null = null;
    let cancelled = false;
    (async () => {
      try {
        let mic: MediaStream | null = null;
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); } catch { mic = null; }
        const tok = await fetch(`/api/live/${id}/token`, { method: "POST" }).then((r) => r.json());
        if (!tok?.value) throw new Error(tok?.error || "Could not get a realtime token.");
        if (cancelled) { mic?.getTracks().forEach((t) => t.stop()); return; }

        pc = new RTCPeerConnection();

        // Remote audio → Web Audio graph (Recall captures it smoothly). Muted
        // <audio> keeps the WebRTC stream flowing (Chrome needs a media sink).
        pc.ontrack = (e) => {
          const stream = e.streams[0];
          if (audioRef.current) { audioRef.current.srcObject = stream; audioRef.current.muted = true; audioRef.current.play().catch(() => {}); }
          try {
            const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            const ctx = audioCtxRef.current || new Ctx();
            audioCtxRef.current = ctx;
            ctx.createMediaStreamSource(stream).connect(ctx.destination);
            if (ctx.state === "suspended") ctx.resume().then(() => setPhase("live")).catch(() => { if (audioRef.current) audioRef.current.muted = false; setNeedGesture(true); });
            else setPhase("live");
          } catch {
            if (audioRef.current) { audioRef.current.muted = false; audioRef.current.play().catch(() => setNeedGesture(true)); }
            setPhase("live");
          }
        };
        if (mic) mic.getTracks().forEach((t) => pc!.addTrack(t, mic!));
        else pc.addTransceiver("audio", { direction: "recvonly" });

        const dc = pc.createDataChannel("oai-events");
        dc.onopen = () => setTimeout(() => { try { dc.send(JSON.stringify({ type: "response.create" })); } catch { /* closed */ } }, 700);

        // Perform an agent browser action, then refresh frames.
        const act = (body: Record<string, unknown>) => {
          fetch(`/api/live/${id}/act`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(() => refreshFrames()).catch(() => {});
        };

        dc.onmessage = (e) => {
          const t = e.data as string;
          if (t.indexOf("\"delta\"") !== -1 && t.indexOf("transcript") !== -1) {
            try { captionRef.current += (JSON.parse(t).delta ?? ""); } catch { /* ignore */ }
            return;
          }
          if (t.indexOf(".delta") !== -1) return; // audio deltas — ignore cheaply
          try {
            const ev = JSON.parse(t);
            if (ev.type === "input_audio_buffer.speech_started") setPhase("listening");
            else if (ev.type === "response.created") setPhase("speaking");
            else if (ev.type === "response.done") { setPhase("live"); captionRef.current = ""; }
            else if (ev.type === "response.function_call_arguments.done") {
              let a: Record<string, unknown> = {};
              try { a = JSON.parse(ev.arguments || "{}"); } catch { /* ignore */ }
              if (ev.name === "open_page") act({ action: "open_page", url: a.url });
              else if (ev.name === "scroll") act({ action: "scroll", direction: a.direction || "down" });
              else if (ev.name === "click") act({ action: "click", text: a.text });
              else if (ev.name === "go_back") act({ action: "back" });
              dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: "done" } }));
              dc.send(JSON.stringify({ type: "response.create" }));
            }
          } catch { /* ignore */ }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const resp = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(tok.model || "gpt-realtime")}`, {
          method: "POST", body: offer.sdp || "", headers: { Authorization: `Bearer ${tok.value}`, "Content-Type": "application/sdp" },
        });
        if (!resp.ok) throw new Error(`OpenAI declined the call (${resp.status}).`);
        await pc.setRemoteDescription({ type: "answer", sdp: await resp.text() });
        setPhase("live");
      } catch (e) {
        if (!cancelled) { setPhase("error"); setDetail((e as Error).message); }
      }
    })();
    return () => { cancelled = true; pc?.close(); audioCtxRef.current?.close().catch(() => {}); };
  }, [id]);

  const label = phase === "speaking" ? "Speaking" : phase === "listening" ? "Listening" : phase === "live" ? "Live" : phase === "error" ? "Connection issue" : "Connecting…";
  const accent = phase === "error" ? "#ff5c6c" : phase === "listening" ? "#7cf0c8" : "#29d3f5";

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#05070d", color: "#e8f0ff", fontFamily: "Inter, system-ui, sans-serif", position: "relative", overflow: "hidden" }}>
      {/* The live, agent-driven browser (the shared screen). */}
      <img
        src={`/api/live/${id}/frame?n=${frameN}`}
        alt=""
        onLoad={() => setHaveFrame(true)}
        onError={() => { /* keep last good frame */ }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#05070d" }}
      />
      {!haveFrame && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#9fb3d1", fontSize: 15 }}>Opening {cfg?.title || "the demo"}…</div>
      )}

      {/* Top bar: brand + live state */}
      <div style={{ position: "absolute", top: 18, left: 22, right: 22, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700, letterSpacing: "0.14em", fontSize: 12, textTransform: "uppercase", color: "#cde0f8", textShadow: "0 1px 6px rgba(0,0,0,0.8)" }}>{cfg?.title || "After Human · Live agent"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999, background: "rgba(0,0,0,0.55)", border: `1px solid ${accent}66` }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: accent }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: accent }}>{label}</span>
        </div>
      </div>

      {/* Live caption of what the agent is saying */}
      {caption && (
        <div style={{ position: "absolute", bottom: 26, left: "50%", transform: "translateX(-50%)", maxWidth: "82%", padding: "9px 16px", borderRadius: 12, background: "rgba(0,0,0,0.72)", fontSize: 16, lineHeight: 1.5, textAlign: "center" }}>{caption}</div>
      )}
      {phase === "error" && (
        <div style={{ position: "absolute", bottom: 26, left: "50%", transform: "translateX(-50%)", padding: "10px 18px", borderRadius: 10, background: "rgba(255,92,108,0.15)", border: "1px solid #ff5c6c55", color: "#ffb3ba", fontSize: 13 }}>{detail || "Could not start the live agent."}</div>
      )}

      {needGesture && (
        <button
          onClick={() => { audioCtxRef.current?.resume().catch(() => {}); audioRef.current?.play().catch(() => {}); setNeedGesture(false); setPhase("live"); }}
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(5,7,13,0.7)", border: "none", cursor: "pointer", color: "#e8f0ff", font: "600 16px Inter, system-ui, sans-serif" }}
        >
          <span style={{ padding: "14px 26px", borderRadius: 12, background: accent, color: "#05070d" }}>▶ Tap to start the agent</span>
        </button>
      )}
      <audio ref={audioRef} autoPlay />
    </div>
  );
}
