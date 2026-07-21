import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

// ============================================================================
// CalibrateCall — the demo Calibration Room, reimagined: "coach the call you
// JUST had with Ava." Renders the turns of THIS live Ava call (fetched by the
// sandbox id the bridge injected as localStorage['jv.democall']) and lets you
// thumbs-down any Ava line and coach it. ILLUSTRATIVE: coaching shows the
// mechanic (thumbs-down -> how a human would say it -> "version N+1") WITHOUT
// mutating the live host golden. No live-rehearsal sandbox is booted, so it is
// instant — the fix for the slow "signing in to the demo system" wait.
// ============================================================================

type Turn = { role: string; text: string };

export default function CalibrateCall() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [coaching, setCoaching] = useState<number | null>(null);
  const [coachText, setCoachText] = useState("");
  const [version, setVersion] = useState(12); // illustrative current version
  const [coachedIdx, setCoachedIdx] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const sandboxId = (() => { try { return localStorage.getItem("jv.democall") || ""; } catch { return ""; } })();

  useEffect(() => {
    if (!sandboxId) return;
    let alive = true;
    const load = () =>
      api.get<{ turns: Turn[] }>(`/api/demo/by-sandbox/${sandboxId}/transcript`)
        .then((r) => { if (alive && Array.isArray(r?.turns)) setTurns(r.turns); })
        .catch(() => { /* keep the last good render */ });
    load();
    const iv = setInterval(load, 4000); // the call is still live — keep it fresh
    return () => { alive = false; clearInterval(iv); };
  }, [sandboxId]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [turns.length]);

  function saveCoach(idx: number) {
    const next = version + 1;
    setVersion(next);
    setCoachedIdx((s) => new Set(s).add(idx));
    setCoaching(null); setCoachText("");
    setToast(`Coached — folded into version ${next}. That is how a clone learns.`);
    window.clearTimeout((saveCoach as unknown as { _t?: number })._t);
    (saveCoach as unknown as { _t?: number })._t = window.setTimeout(() => setToast(null), 3600);
  }

  const wrap: React.CSSProperties = { minHeight: "100vh", background: "var(--bg)", color: "var(--ink1)", fontFamily: "inherit", padding: "clamp(16px,3vw,32px)", boxSizing: "border-box" };
  const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20, boxShadow: "var(--shadow)" };

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 26, color: "var(--purple)", fontVariationSettings: "'FILL' 1" }}>tune</span>
          <h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-.02em" }}>Calibrate this call</h1>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 9999, background: "var(--purple-soft)", color: "var(--purple-ink)", fontSize: 12.5, fontWeight: 700 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>history</span>Ava · live version {version}
          </span>
        </div>
        <p style={{ margin: "0 0 18px", color: "var(--ink2)", fontSize: 14.5, lineHeight: 1.5, maxWidth: 680 }}>
          This is the call you just had with me. Thumbs-down any line that wasn't quite right, tell me how you'd say it, and that fix folds into the next version — that's exactly how you'd coach a clone of your own rep.
        </p>

        {/* The call */}
        <div style={{ ...card, overflow: "hidden" }}>
          <div ref={feedRef} style={{ maxHeight: "62vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            {turns.length === 0 && (
              <div style={{ color: "var(--ink3)", fontSize: 13.5, padding: "18px 4px" }}>Loading the call…</div>
            )}
            {turns.map((t, i) => {
              const ava = t.role === "ava";
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: ava ? "flex-start" : "flex-end" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", margin: "0 6px 3px" }}>{ava ? "Ava" : "You"}</div>
                  <div style={{ maxWidth: "82%", padding: "11px 15px", borderRadius: 16, fontSize: 14, lineHeight: 1.5,
                    background: ava ? "var(--clone-bg)" : "var(--sunk)", color: ava ? "var(--clone-ink)" : "var(--ink1)",
                    border: coachedIdx.has(i) ? "1.5px solid var(--success)" : "1px solid transparent" }}>
                    {t.text}
                  </div>
                  {ava && (
                    coachedIdx.has(i) ? (
                      <div style={{ margin: "5px 6px 0", fontSize: 11.5, fontWeight: 700, color: "var(--success-ink)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 15 }}>check_circle</span>Coached into v{version}
                      </div>
                    ) : (
                      <button onClick={() => { setCoaching(i); setCoachText(""); }} title="Coach this line"
                        style={{ margin: "5px 6px 0", display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 10px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink2)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 15 }}>thumb_down</span>Coach this line
                      </button>
                    )
                  )}
                  {ava && coaching === i && (
                    <div style={{ width: "82%", marginTop: 8, padding: 12, borderRadius: 14, background: "var(--sunk)", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)", marginBottom: 8 }}>How would you have said it?</div>
                      <textarea value={coachText} onChange={(e) => setCoachText(e.target.value)} rows={2} autoFocus
                        placeholder="e.g. Lead with the outcome, then the how…"
                        style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink1)", fontSize: 13.5, fontFamily: "inherit", resize: "vertical" }} />
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                        <button onClick={() => setCoaching(null)} style={{ height: 32, padding: "0 12px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink2)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                        <button onClick={() => saveCoach(i)} disabled={coachText.trim().length < 2}
                          style={{ height: 32, padding: "0 14px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: coachText.trim().length < 2 ? 0.55 : 1 }}>
                          Fold into version {version + 1}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ borderTop: "1px solid var(--divider)", padding: "12px 20px", fontSize: 12.5, color: "var(--ink3)", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, color: "var(--purple)" }}>bolt</span>
            Every correction compiles into a new version — you always know exactly what your clone will say.
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 50,
          background: "var(--success-soft)", color: "var(--success-ink)", border: "1px solid var(--success)", borderRadius: 12,
          padding: "12px 18px", fontSize: 13.5, fontWeight: 700, boxShadow: "var(--shadow-lg)", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>auto_awesome</span>{toast}
        </div>
      )}
    </div>
  );
}
