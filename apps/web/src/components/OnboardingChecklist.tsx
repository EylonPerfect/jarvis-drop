import { useEffect, useState } from "react";
import { api } from "../api/client";

// FIRST-RUN ONBOARDING CHECKLIST (LAUNCH activation). Guided path for a fresh
// self-serve account, mounted on the roster/home surface. Every step's done
// state is DERIVED FROM REAL DATA by GET /api/onboarding/checklist (org, clone,
// sources, rehearsal, score>=70, gone-live) — no stored flags. Self-hides once
// every step is complete.

type Step = {
  key: "org" | "clone" | "rehearse" | "score" | "live";
  label: string;
  detail: string;
  done: boolean;
  view: string;
};
type Checklist = {
  fresh: boolean;
  complete: boolean;
  doneCount: number;
  total: number;
  nextKey: string | null;
  steps: Step[];
};

function goTo(view: string): void {
  window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
}

export default function OnboardingChecklist() {
  const [data, setData] = useState<Checklist | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api
      .get<Checklist>("/api/onboarding/checklist")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoaded(true));
  }, []);

  // Hide until we know, and hide entirely once onboarding is complete.
  if (!loaded || !data || data.complete) return null;

  const pct = Math.round((data.doneCount / data.total) * 100);

  return (
    <div
      className="card"
      style={{ borderRadius: 20, padding: 22, marginBottom: 22, border: "1px solid var(--border)", background: "var(--card)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--purple-ink)" }}>rocket_launch</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.01em", color: "var(--ink1)" }}>Get your first clone live</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 2 }}>
            {data.doneCount} of {data.total} done — your clone is only as good as your best calls.
          </div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--purple-ink)" }}>{pct}%</div>
      </div>

      {/* progress bar */}
      <div style={{ height: 6, borderRadius: 9999, background: "var(--track)", margin: "14px 0 18px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 9999, background: "var(--purple)", transition: "width .3s ease" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.steps.map((s, i) => {
          const isNext = s.key === data.nextKey;
          return (
            <div
              key={s.key}
              style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 12px", borderRadius: 12, background: isNext ? "var(--purple-soft)" : "var(--sunk)", border: isNext ? "1px solid var(--purple)" : "1px solid transparent" }}
            >
              <span
                className="material-symbols-rounded"
                style={{ fontSize: 22, color: s.done ? "var(--success)" : isNext ? "var(--purple-ink)" : "var(--ink3)", flexShrink: 0, lineHeight: 1.2 }}
              >
                {s.done ? "check_circle" : "radio_button_unchecked"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: s.done ? "var(--ink2)" : "var(--ink1)", textDecoration: s.done ? "line-through" : "none" }}>
                  <span style={{ color: "var(--ink3)", fontWeight: 800, marginRight: 8 }}>{i + 1}</span>{s.label}
                </div>
                {!s.done && <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 3, lineHeight: 1.45 }}>{s.detail}</div>}
              </div>
              {!s.done && (
                <button
                  onClick={() => goTo(s.view)}
                  style={{ flexShrink: 0, height: 32, padding: "0 14px", borderRadius: 9999, border: isNext ? "none" : "1px solid var(--border)", background: isNext ? "var(--accent)" : "transparent", color: isNext ? "#fff" : "var(--ink1)", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
                >
                  {isNext ? "Start" : "Open"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
