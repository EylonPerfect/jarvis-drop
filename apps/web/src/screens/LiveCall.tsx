// Live Call — the After Human two-loop runtime, in-browser and testable:
//  • VOICE loop: you talk to the agent (OpenAI Realtime, native turn-taking).
//  • OPERATOR loop: when the agent calls show_on_screen, it drives its E2B
//    desktop (computer-use) to show it — streamed here as the shared screen.
//  • BLACKBOARD: grounding is refreshed into the voice session so it narrates
//    only confirmed state and covers latency naturally.
import { useEffect, useRef, useState } from "react";
import { Panel, Button, Icon, Badge, EmptyState } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Agent } from "@jarvis/shared";

type Phase = "idle" | "starting" | "connecting" | "live" | "speaking" | "listening" | "error";

export default function LiveCall() {
  const { data: agentsData } = useApi<Agent[]>("/api/agents");
  const agents = agentsData ?? [];
  const [agentId, setAgentId] = useState("");
  const [goal, setGoal] = useState("");
  const [callId, setCallId] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [caption, setCaption] = useState("");
  const [showLog, setShowLog] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const captionRef = useRef("");
  const lastGroundRef = useRef("");

  useEffect(() => { if (!agentId && agents.length) setAgentId(agents[0].id); }, [agents, agentId]);

  // Flush captions slowly (avoid re-render per token).
  useEffect(() => { const t = setInterval(() => setCaption(captionRef.current.slice(-220)), 320); return () => clearInterval(t); }, []);

  const hangUp = async () => {
    try { pcRef.current?.close(); } catch { /* ignore */ }
    pcRef.current = null; dcRef.current = null;
    if (callId) { try { await api.post(`/api/call/${callId}/end`); } catch { /* ignore */ } }
    setCallId(""); setStreamUrl(""); setPhase("idle"); setCaption(""); setShowLog([]);
  };

  const startCall = async () => {
    if (!agentId) return;
    setErr(null); setPhase("starting");
    try {
      const s = await api.post<{ callId?: string; streamUrl?: string; error?: string }>("/api/call/start", { agentId, goal: goal.trim() || undefined });
      if (!s.callId) throw new Error(s.error || "Could not start the call.");
      setCallId(s.callId); setStreamUrl(s.streamUrl || "");
      await connectVoice(s.callId);
    } catch (e) { setErr((e as Error).message); setPhase("error"); }
  };

  const connectVoice = async (cid: string) => {
    setPhase("connecting");
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const tok = await api.post<{ value?: string; model?: string; error?: string }>(`/api/call/${cid}/token`);
    if (!tok.value) throw new Error(tok.error || "Could not get a voice token.");
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    pc.ontrack = (e) => { if (audioRef.current) { audioRef.current.srcObject = e.streams[0]; audioRef.current.play().catch(() => {}); } setPhase("live"); };
    mic.getTracks().forEach((t) => pc.addTrack(t, mic));
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onopen = () => setTimeout(() => { try { dc.send(JSON.stringify({ type: "response.create" })); } catch { /* ignore */ } }, 700);
    dc.onmessage = (e) => {
      const t = e.data as string;
      if (t.indexOf("\"delta\"") !== -1 && t.indexOf("transcript") !== -1) { try { captionRef.current += (JSON.parse(t).delta ?? ""); } catch { /* ignore */ } return; }
      if (t.indexOf(".delta") !== -1) return;
      try {
        const ev = JSON.parse(t);
        if (ev.type === "input_audio_buffer.speech_started") setPhase("listening");
        else if (ev.type === "response.created") setPhase("speaking");
        else if (ev.type === "response.done") { setPhase("live"); captionRef.current = ""; }
        else if (ev.type === "response.function_call_arguments.done" && ev.name === "show_on_screen") {
          let req = "";
          try { req = JSON.parse(ev.arguments || "{}").request || ""; } catch { /* ignore */ }
          if (req) { setShowLog((l) => [...l.slice(-6), req]); api.post(`/api/call/${cid}/show`, { request: req }).catch(() => {}); }
          dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: "on it" } }));
          dc.send(JSON.stringify({ type: "response.create" }));
        }
      } catch { /* ignore */ }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const resp = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(tok.model || "gpt-realtime")}`, { method: "POST", body: offer.sdp || "", headers: { Authorization: `Bearer ${tok.value}`, "Content-Type": "application/sdp" } });
    if (!resp.ok) throw new Error(`OpenAI declined the call (${resp.status}).`);
    await pc.setRemoteDescription({ type: "answer", sdp: await resp.text() });
    setPhase("live");
  };

  // Keep the voice loop grounded: push fresh blackboard state into the session as
  // the operator loop changes the screen.
  useEffect(() => {
    if (!callId || phase === "idle" || phase === "starting") return;
    const t = setInterval(async () => {
      try {
        const g = await api.get<{ grounding?: string }>(`/api/call/${callId}/grounding`);
        const grounding = g.grounding || "";
        if (grounding && grounding !== lastGroundRef.current && dcRef.current?.readyState === "open") {
          lastGroundRef.current = grounding;
          dcRef.current.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: `[screen state update]\n${grounding}` }] } }));
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(t);
  }, [callId, phase]);

  const label = phase === "speaking" ? "Speaking" : phase === "listening" ? "Listening" : phase === "live" ? "Live" : phase === "connecting" ? "Connecting…" : phase === "starting" ? "Starting…" : phase === "error" ? "Error" : "Idle";
  const accent = phase === "error" ? "var(--jv-red)" : phase === "listening" ? "var(--jv-green)" : "var(--jv-cyan)";
  const agent = agents.find((a) => a.id === agentId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel eyebrow>
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <Badge status={callId ? "optimal" : "standby"} dot={!!callId}>{callId ? label : "Not in a call"}</Badge>
          <Badge status="info" dot={false}><Icon name="cpu" size={11} style={{ marginRight: 4 }} />voice + operator, one brain</Badge>
        </div>
        <div style={{ font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>Live Call</div>
        <p style={{ margin: "0 0 16px", maxWidth: 660, font: "var(--fw-regular) 13.5px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>
          Talk to the agent — it answers in real time and, when you should see something, drives its own browser to show it (screen below). The two loops stay in sync via the blackboard, so it only describes what's actually on screen. This is the in-browser test of the live-call runtime (no Zoom yet).
        </p>
        {!callId ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <span style={{ position: "absolute", left: 12, pointerEvents: "none", color: "var(--jv-cyan)" }}><Icon name="bot" size={15} /></span>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ appearance: "none", padding: "10px 34px 10px 36px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", color: "var(--jv-text)", font: "var(--fw-medium) 13px var(--font-body)", cursor: "pointer" }}>
                {agents.length === 0 && <option value="">No agents yet</option>}
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? ` — ${a.role}` : ""}</option>)}
              </select>
              <span style={{ position: "absolute", right: 12, pointerEvents: "none", color: "var(--jv-text-muted)" }}><Icon name="chevron-down" size={15} /></span>
            </div>
            <Button variant="primary" icon={<Icon name={phase === "starting" ? "loader" : "phone-call"} size={14} />} disabled={phase === "starting" || !agentId} onClick={startCall}>{phase === "starting" ? "Starting…" : "Start call"}</Button>
          </div>
        ) : (
          <Button variant="danger" icon={<Icon name="phone-off" size={14} />} onClick={hangUp}>End call</Button>
        )}
        {err && <div style={{ marginTop: 12, font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-red-400)" }}>{err}</div>}
      </Panel>

      {callId ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          <Panel title={`${agent?.name || "Agent"} — shared screen`} eyebrow bodyStyle={{ padding: 0 }}>
            <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", background: "#05070d", borderRadius: "0 0 var(--r-md) var(--r-md)", overflow: "hidden" }}>
              {streamUrl && <iframe src={streamUrl} title="screen" allow="autoplay" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} />}
              <div style={{ position: "absolute", top: 12, right: 12, display: "flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 999, background: "rgba(0,0,0,0.6)", border: `1px solid ${accent}` }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent }} /><span style={{ font: "var(--fw-semibold) 11px var(--font-body)", color: accent }}>{label}</span>
              </div>
              {caption && <div style={{ position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", maxWidth: "86%", padding: "8px 14px", borderRadius: 10, background: "rgba(0,0,0,0.72)", color: "#e8f0ff", font: "var(--fw-regular) 14px/1.45 var(--font-body)", textAlign: "center" }}>{caption}</div>}
            </div>
          </Panel>
          <Panel title="Call" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ font: "var(--fw-regular) 12.5px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>
              Speak naturally — ask it about the product, ask to see pricing, interrupt it. It talks and drives the screen on the left.
            </div>
            <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Showed on screen</div>
            {showLog.length === 0 ? (
              <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-faint)" }}>Nothing yet — ask it to show you something.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {showLog.map((s, i) => <div key={i} style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-cyan-300)" }}>↗ {s}</div>)}
              </div>
            )}
          </Panel>
        </div>
      ) : (
        <EmptyState icon="phone-call" title="No active call" hint="Pick an agent and start a call to talk to it live while it drives its screen." />
      )}
      <audio ref={audioRef} autoPlay />
    </div>
  );
}
