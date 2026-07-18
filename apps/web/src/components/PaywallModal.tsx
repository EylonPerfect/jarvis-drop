import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { api } from "../api/client";

// ============================================================
// PaywallModal — the go-live / rehearsal-cap paywall (self-serve funnel).
//
// Two moments, one modal:
//  - "golive": the clone passed the 70 gate and the org has no paid plan.
//    "Your clone's ready — go live for $2,000." (backend 402 code
//    "payment_required" from the promote / live-join gate.)
//  - "cap": the free org used up its lifetime rehearsal runs (backend 402
//    code "rehearsal_cap"). Lighter "go live to keep rehearsing" prompt.
//
// The CTA starts a Lemon Squeezy hosted Checkout (POST /api/billing/checkout
// {plan:"starter"}) and redirects to the returned URL. On any failure (not
// signed in / billing not configured) it falls back to the in-app Billing
// screen so the buyer still lands somewhere useful (mirrors PricingPage).
//
// Reuses the EXISTING billing checkout endpoint — no billing logic here.
// ============================================================

const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));

const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

export type PaywallVariant = "golive" | "cap";

export default function PaywallModal({
  variant,
  cloneName,
  reason,
  onClose,
}: {
  variant: PaywallVariant;
  cloneName?: string;
  reason?: string;
  onClose: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const who = cloneName?.trim() || "Your clone";
  const isGoLive = variant === "golive";

  const title = isGoLive ? `${who}'s ready — go live for $2,000` : "You've used your free rehearsals";
  const body = isGoLive
    ? `${who} cleared the 70% quality bar. Going live puts it on real calls — a Starter plan is $2,000/mo per clone, billed only now, at go-live. Rehearsal stays free.`
    : reason ||
      "Rehearsal is free up to your run limit — you've hit it. Go live to keep rehearsing (unlimited on a paid plan) and put this clone on real calls.";
  const cta = isGoLive ? "Go live — $2,000" : "Go live to continue";

  async function checkout() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ url?: string }>("/api/billing/checkout", { plan: "starter", quantity: 1 });
      if (r.url) {
        window.location.href = r.url;
        return;
      }
      // No URL returned — fall back to the in-app Billing screen.
      nav("billing");
      onClose();
    } catch {
      // Not signed in / billing not configured — land the buyer on Billing.
      nav("billing");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 4000,
        background: "rgba(4,4,20,.62)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(460px, 100%)",
          borderRadius: 20,
          background: "var(--panel, #0B0B33)",
          border: "1px solid var(--border, rgba(255,255,255,.12))",
          boxShadow: "0 24px 80px rgba(0,0,0,.5)",
          color: "var(--ink1, #fff)",
          padding: "28px 26px 24px",
          fontFamily: "inherit",
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            background: "rgba(255,6,96,.14)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF0660" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isGoLive ? (
              <>
                <path d="m5 3 14 9-14 9V3z" />
              </>
            ) : (
              <>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </>
            )}
          </svg>
        </div>

        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: "var(--ink2, rgba(255,255,255,.66))", marginBottom: 22 }}>{body}</div>

        {err && <div style={{ fontSize: 13, color: "var(--danger, #ff6b6b)", marginBottom: 14 }}>{err}</div>}

        <button
          onClick={() => void checkout()}
          disabled={busy}
          style={{
            width: "100%",
            height: 48,
            borderRadius: 9999,
            border: "none",
            background: "#FF0660",
            color: "#fff",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: ".02em",
            boxShadow: "0 8px 24px rgba(255,6,96,.3)",
            opacity: busy ? 0.7 : 1,
            ...btnFont,
          }}
        >
          {busy ? "Opening checkout…" : cta}
        </button>

        <button
          onClick={onClose}
          disabled={busy}
          style={{
            width: "100%",
            height: 42,
            marginTop: 10,
            borderRadius: 9999,
            border: "none",
            background: "transparent",
            color: "var(--ink2, rgba(255,255,255,.6))",
            fontSize: 13.5,
            fontWeight: 600,
            ...btnFont,
          }}
        >
          {isGoLive ? "Not yet" : "Keep rehearsing later"}
        </button>

        <div style={{ marginTop: 14, textAlign: "center" }}>
          <button
            onClick={() => {
              nav("pricing");
              onClose();
            }}
            disabled={busy}
            style={{ border: "none", background: "transparent", color: "var(--ink3, rgba(255,255,255,.45))", fontSize: 12.5, textDecoration: "underline", ...btnFont }}
          >
            See all plans
          </button>
        </div>
      </div>
    </div>
  );
}
