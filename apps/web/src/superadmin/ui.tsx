// Small shared building blocks + color helpers for the console panels.
import type { Kpi } from "./types";

export const C = {
  green: "#4BE39A",
  amber: "#F8C01A",
  red: "#FF6B84",
  purple: "#CBA3FF",
  blue: "#66D9FF",
  pink: "#FF0660",
  pinkInk: "#FF6E9C",
};

export function healthColor(h: number): string {
  return h >= 75 ? C.green : h >= 45 ? C.amber : C.red;
}

export function usageColor(pct: number): string {
  return pct >= 100 ? C.red : pct >= 85 ? C.amber : C.green;
}

export function statusMeta(status: string): { bg: string; c: string; label: string; anim: boolean } {
  switch (status) {
    case "stalling":
      return { bg: "rgba(248,192,26,.16)", c: C.amber, label: "Stalling", anim: false };
    case "bailing":
      return { bg: "rgba(255,0,49,.16)", c: C.red, label: "Bailing out", anim: true };
    default:
      return { bg: "rgba(46,211,125,.16)", c: C.green, label: "Healthy", anim: false };
  }
}

export function sevMeta(k: string): { bg: string; c: string } {
  return (
    {
      "live-action": { bg: "rgba(255,0,49,.16)", c: C.red },
      impersonation: { bg: "rgba(163,66,255,.16)", c: C.purple },
      cost: { bg: "rgba(248,192,26,.16)", c: C.amber },
      billing: { bg: "rgba(0,187,255,.16)", c: C.blue },
      auth: { bg: "rgba(46,211,125,.16)", c: C.green },
      config: { bg: "rgba(255,255,255,.1)", c: "#fff" },
    }[k] || { bg: "rgba(255,255,255,.1)", c: "#fff" }
  );
}

export function Icon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" style={{ fontSize: size, color }}>
      {name}
    </span>
  );
}

export function KpiTile({ k, big = 28 }: { k: Kpi; big?: number }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: "16px 18px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)" }}>
        {k.label}
      </div>
      <div style={{ fontSize: big, fontWeight: 800, letterSpacing: "-.02em", marginTop: 6, color: k.color || "#fff" }}>
        {k.val}
      </div>
      {k.sub != null && <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>{k.sub}</div>}
    </div>
  );
}

// Consistent, clearly-labelled fallbacks — no fabricated data.
export function StateBlock({
  loading,
  error,
  empty,
  emptyLabel,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  if (loading)
    return (
      <div style={rowMsg}>
        <span className="sa-spinner" /> Loading…
      </div>
    );
  if (error)
    return (
      <div style={rowMsg}>
        <Icon name="cloud_off" size={20} color={C.amber} />
        <div>
          <div style={{ fontWeight: 600, color: "var(--ink2)" }}>Backend endpoint not reachable</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2, fontFamily: "monospace" }}>{error}</div>
        </div>
      </div>
    );
  if (empty)
    return (
      <div style={rowMsg}>
        <Icon name="inbox" size={20} color="var(--ink3)" />
        {emptyLabel}
      </div>
    );
  return <>{children}</>;
}

const rowMsg: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "40px 22px",
  color: "var(--ink2)",
  fontSize: 13.5,
};
