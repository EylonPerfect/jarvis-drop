import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../api/client";

// ============================================================================
// ReferralShare — the one PLG share surface for every loop. Reward-forward:
// "give a colleague a free clone-month, get one yourself." Rides the live
// backbone (GET /api/referrals/me for the code+link+stats). loop drives the copy
// (ava | team | clip); variant drives the layout (card | inline | brag).
//
// The referred party is attributed when they sign up carrying ?ref=CODE (the
// public attribution capture reads it), and BOTH sides get a free clone-month
// when the referred org starts its first paid plan.
// ============================================================================

type Loop = "ava" | "team" | "clip";
type Variant = "card" | "inline" | "brag";

interface MeResp {
  refCode: string; link: string; invited: number; converted: number; rewardsActive: number;
}

const COPY: Record<Loop, { eyebrow: string; title: string; body: string; primary: string }> = {
  team: {
    eyebrow: "Refer and earn",
    title: "Grow your team of clones",
    body: "Invite a teammate to get cloned. When their clone goes live, you both get a free clone-month.",
    primary: "Invite a teammate",
  },
  ava: {
    eyebrow: "Refer and earn",
    title: "Loved your clone?",
    body: "Send a colleague to meet Ava. When they go live, you both get a free clone-month.",
    primary: "Share with a colleague",
  },
  clip: {
    eyebrow: "Refer and earn",
    title: "Show off this call",
    body: "Share it. When a colleague goes live, you both get a free clone-month.",
    primary: "Share on LinkedIn",
  },
};

// Rewrite the /me link's loop + channel so every share is attributed correctly.
function buildLink(base: string, loop: Loop, channel: string): string {
  try {
    const u = new URL(base);
    u.searchParams.set("ref_loop", loop);
    u.searchParams.set("utm_medium", channel);
    return u.toString();
  } catch { return base; }
}

const EMAIL_SUBJECT = "Meet my AI teammate";
const emailBody = (link: string) =>
  `I've been using After Human to clone a rep into an AI teammate that runs live demos. Thought you'd want to see it — and we both get a free clone-month if you go live:\n\n${link}`;

export default function ReferralShare({ loop, wowTrigger, variant = "card", style }: {
  loop: Loop; wowTrigger?: string; variant?: Variant; style?: CSSProperties;
}): JSX.Element | null {
  const [me, setMe] = useState<MeResp | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(variant === "card");

  useEffect(() => {
    let alive = true;
    void api.get<MeResp>("/api/referrals/me")
      .then((r) => { if (alive) setMe(r); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) return null; // never break the host screen on a referral hiccup
  const copy = COPY[loop];
  const link = me ? buildLink(me.link, loop, "link") : "";

  const track = (channel: string) => {
    void api.post("/api/referrals/share", { loop, channel, wowTrigger, target: "ava" }).catch(() => {});
  };
  const doCopy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); track("copy"); } catch { /* ignore */ }
  };
  const doEmail = () => {
    if (!link) return;
    track("email");
    window.open(`mailto:?subject=${encodeURIComponent(EMAIL_SUBJECT)}&body=${encodeURIComponent(emailBody(buildLink(me!.link, loop, "email")))}`, "_blank");
  };
  const doLinkedIn = () => {
    if (!link) return;
    track("linkedin");
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(buildLink(me!.link, loop, "linkedin"))}`, "_blank", "noopener,noreferrer");
  };

  const pink = "#FF0660"; const purple = "#A342FF";
  const stats = me && me.invited > 0
    ? `${me.invited} invited · ${me.converted} live · ${me.rewardsActive} free month${me.rewardsActive === 1 ? "" : "s"} earned`
    : null;

  const ActionRow = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
      <button onClick={doCopy} disabled={!link} style={btn(pink, true)}>{copied ? "Copied ✓" : "Copy link"}</button>
      <button onClick={doEmail} disabled={!link} style={btn(pink, false)}>Email</button>
      <button onClick={doLinkedIn} disabled={!link} style={btn(pink, false)}>LinkedIn</button>
    </div>
  );

  // ---- brag: an inverted, LinkedIn-forward card for the post-call share ----
  if (variant === "brag") {
    const LI = "#0A66C2";
    return (
      <div style={{ padding: 18, borderRadius: 16, background: "#111436", border: "1px solid rgba(255,255,255,.10)", color: "#fff", boxShadow: "0 18px 50px rgba(0,0,64,.42)", ...style }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: LI, display: "grid", placeItems: "center", flex: "none" }}><LinkedInLogo size={16} color="#fff" /></span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: "#9FB4FF" }}>Share the win</span>
        </div>
        <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: "-.01em" }}>{copy.title}</div>
        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.68)", marginTop: 5, lineHeight: 1.5 }}>{copy.body}</div>
        <button onClick={doLinkedIn} disabled={!link} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, width: "100%", height: 44, marginTop: 14, border: "none", borderRadius: 10, background: LI, color: "#fff", fontSize: 14, fontWeight: 700, cursor: link ? "pointer" : "not-allowed", opacity: link ? 1 : 0.6, fontFamily: "inherit" }}>
          <LinkedInLogo size={18} color="#fff" />Share on LinkedIn
        </button>
        <button onClick={doCopy} disabled={!link} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", height: 38, marginTop: 8, border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, background: "transparent", color: "#fff", fontSize: 13, fontWeight: 600, cursor: link ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        {stats && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "rgba(255,255,255,.5)", marginTop: 13, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.10)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: pink, flex: "none" }} />{stats}
          </div>
        )}
      </div>
    );
  }

  // ---- inline: a compact prompt that expands to the actions ----
  if (variant !== "card") {
    return (
      <div className="card" style={{ padding: 16, borderRadius: 16, border: `1px solid color-mix(in srgb, ${purple} 30%, transparent)`, background: `color-mix(in srgb, ${purple} 7%, var(--card))`, ...style }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800 }}>{copy.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 2, lineHeight: 1.45 }}>{copy.body}</div>
          </div>
          {!open && <button onClick={() => { setOpen(true); }} style={btn(pink, true)}>Share</button>}
        </div>
        {open && ActionRow}
        {open && stats && <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 10 }}>{stats}</div>}
      </div>
    );
  }

  // ---- card: full referral card for the hub ----
  return (
    <div className="card" style={{ padding: 18, borderRadius: 18, ...style }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: purple, marginBottom: 8 }}>{copy.eyebrow}</div>
      <div style={{ fontSize: 16.5, fontWeight: 800 }}>{copy.title}</div>
      <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 5, lineHeight: 1.5 }}>{copy.body}</div>
      {ActionRow}
      {stats && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ink3)", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--divider)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: pink, flex: "none" }} />{stats}
        </div>
      )}
    </div>
  );
}

function LinkedInLogo({ size = 18, color = "currentColor" }: { size?: number; color?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={color} aria-hidden="true" style={{ flex: "none", display: "block" }}>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.75v20.5C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.75V1.75C24 .78 23.2 0 22.22 0z" />
    </svg>
  );
}

function btn(pink: string, primary: boolean): CSSProperties {
  return {
    height: 36, padding: "0 15px", borderRadius: 9999, cursor: "pointer", fontSize: 13, fontWeight: 700,
    border: primary ? "none" : "1px solid var(--border)",
    background: primary ? pink : "transparent",
    color: primary ? "#fff" : "var(--ink1)",
    ...(primary ? { boxShadow: "0 6px 18px rgba(255,6,96,.28)" } : {}),
  };
}
