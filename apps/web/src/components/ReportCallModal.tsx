import { useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../api/client";

// REPORT-THIS-CALL modal (LAUNCH self-serve support). Shared by the live-call
// cockpit (RehearsalRoom) and the post-call debrief (Debrief). Files a
// structured report to POST /api/calls/:id/report, which lands in the shared
// `call_reports` table that feeds the super-admin report-this-call queue.

type Severity = "notice" | "warning" | "critical";

const SEVERITIES: { key: Severity; label: string; hint: string }[] = [
  { key: "notice", label: "Minor", hint: "Worth noting — didn't derail the call" },
  { key: "warning", label: "Problem", hint: "Hurt the call but it recovered" },
  { key: "critical", label: "Serious", hint: "Broke the call / said something it shouldn't" },
];

const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

export default function ReportCallModal(props: {
  callId: string;
  agentId?: string | null;
  orgId?: string | null;
  /** Short context line, e.g. the call title or "Live call in progress". */
  context?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const { callId, agentId, orgId, context, onClose, onSubmitted } = props;
  const [reason, setReason] = useState("");
  const [severity, setSeverity] = useState<Severity>("warning");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    const what = reason.trim();
    if (!what || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api.post(`/api/calls/${encodeURIComponent(callId)}/report`, {
        reason: what,
        severity,
        agentId: agentId ?? undefined,
        orgId: orgId ?? undefined,
      });
      setDone(true);
      onSubmitted?.();
      setTimeout(onClose, 1100);
    } catch {
      setErr("Couldn't file the report — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(4,10,20,.55)", display: "grid", placeItems: "center", padding: 20 }}
    >
      <div
        role="dialog"
        aria-label="Report this call"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(520px, 100%)", background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow-lg)", padding: 22 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--warning-ink)" }}>flag</span>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.01em", color: "var(--ink1)" }}>Report this call</div>
        </div>
        {context && <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 14 }}>{context}</div>}

        {done ? (
          <div style={{ padding: "18px 4px", display: "flex", alignItems: "center", gap: 10, color: "var(--success-ink, var(--ink1))", fontSize: 13.5, fontWeight: 700 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 20, color: "var(--success)" }}>check_circle</span>
            Thanks — this is now in the support queue.
          </div>
        ) : (
          <>
            <label style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink3)" }}>What went wrong?</label>
            <textarea
              value={reason}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. It quoted a discount it was never authorized to give, then got stuck on the pricing screen."
              style={{ width: "100%", minHeight: 96, marginTop: 6, marginBottom: 16, borderRadius: 12, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.5, padding: "10px 12px", outline: "none", resize: "vertical", boxSizing: "border-box" }}
            />

            <label style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink3)" }}>How bad was it?</label>
            <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 20, flexWrap: "wrap" }}>
              {SEVERITIES.map((s) => {
                const on = severity === s.key;
                return (
                  <button
                    key={s.key}
                    title={s.hint}
                    onClick={() => setSeverity(s.key)}
                    style={{ flex: 1, minWidth: 96, padding: "9px 10px", borderRadius: 11, border: on ? "1.5px solid var(--accent)" : "1px solid var(--border)", background: on ? "var(--accent-soft, var(--sunk))" : "transparent", color: on ? "var(--accent)" : "var(--ink2)", fontSize: 12.5, fontWeight: 800, ...btnFont }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>

            {err && <div style={{ fontSize: 12, color: "var(--error-ink)", marginBottom: 12 }}>{err}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={onClose} style={{ height: 38, padding: "0 16px", borderRadius: 9999, border: "none", background: "transparent", color: "var(--ink2)", fontSize: 13, fontWeight: 700, ...btnFont }}>Cancel</button>
              <button
                onClick={() => void submit()}
                disabled={busy || !reason.trim()}
                style={{ height: 38, padding: "0 20px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 800, boxShadow: "0 8px 24px rgba(255,6,96,.3)", opacity: busy || !reason.trim() ? 0.55 : 1, ...btnFont }}
              >
                {busy ? "Sending…" : "Send report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
