import { useEffect, useRef, useState } from "react";

// Standalone presenter surface — rendered as the Recall bot's shared screen.
// Shows a live browser feed of the product and speaks the agent's narration.
// Uses plain fetch against the auth-exempt /api/present/* endpoints (the session
// id in the URL is the capability token).
interface Session { title: string; url: string; steps: { say: string }[] }

export default function Presenter() {
  const sid = new URLSearchParams(window.location.search).get("s") || "";
  const [session, setSession] = useState<Session | null>(null);
  const [i, setI] = useState(0);
  const [shot, setShot] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!sid) return;
    fetch(`/api/present/${sid}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setSession(d)).catch(() => {});
  }, [sid]);

  // Refresh the live browser feed of the product every few seconds.
  useEffect(() => {
    const id = window.setInterval(() => setShot((n) => n + 1), 3500);
    return () => window.clearInterval(id);
  }, []);

  // Speak each step, advancing when the audio ends.
  useEffect(() => {
    if (!session || i >= session.steps.length) return;
    const a = new Audio(`/api/present/${sid}/audio?i=${i}`);
    let advanced = false;
    const next = (delay: number) => { if (advanced) return; advanced = true; setSpeaking(false); window.setTimeout(() => setI((x) => x + 1), delay); };
    a.onplaying = () => setSpeaking(true);
    a.onended = () => next(700);
    a.onerror = () => next(1500);
    a.play().catch(() => next(4000)); // if autoplay is blocked, still advance
    return () => { a.pause(); };
  }, [session, i, sid]);

  const dark = { minHeight: "100vh", background: "#06101c", color: "#e8f2fa", display: "flex", flexDirection: "column" as const, fontFamily: "Inter, system-ui, sans-serif" };

  if (!sid || !session) {
    return <div style={{ ...dark, alignItems: "center", justifyContent: "center" }}><div style={{ opacity: 0.7 }}>Preparing the presentation…</div></div>;
  }

  const done = i >= session.steps.length;
  const line = done ? "Thanks so much — I'm happy to take any questions." : session.steps[i].say;

  return (
    <div style={dark}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", borderBottom: "1px solid rgba(95,212,255,0.18)" }}>
        <img src="/after-human-icon.svg" alt="" style={{ width: 26, height: 26 }} />
        <div style={{ fontWeight: 600, letterSpacing: "0.02em" }}>{session.title}</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#5fd4ff", textTransform: "uppercase", letterSpacing: "0.12em" }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#5fd4ff", boxShadow: "0 0 10px #5fd4ff", opacity: speaking ? 1 : 0.35, animation: speaking ? "jv-pulse 1.4s ease-out infinite" : "none" }} />
          {speaking ? "Speaking" : done ? "Q&A" : "Presenting"}
        </div>
      </div>

      {/* Live product feed (the "shared screen") */}
      <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 20, minHeight: 0 }}>
        <img
          key={shot}
          src={`/api/present/${sid}/shot?n=${shot}`}
          alt="Live product"
          style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", borderRadius: 10, border: "1px solid rgba(95,212,255,0.25)", boxShadow: "0 12px 48px rgba(0,0,0,0.5)", objectFit: "contain" }}
        />
      </div>

      {/* Narration caption */}
      <div style={{ padding: "18px 26px 26px", borderTop: "1px solid rgba(95,212,255,0.18)", background: "rgba(6,16,28,0.9)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", fontSize: 26, lineHeight: 1.45, fontWeight: 500 }}>{line}</div>
      </div>
    </div>
  );
}
