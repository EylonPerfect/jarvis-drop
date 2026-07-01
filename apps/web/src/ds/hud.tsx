import { type CSSProperties, type ReactNode, useId, useMemo } from "react";

// ---- ProgressRing ---------------------------------------------------------
export function ProgressRing({
  value = 0,
  label = "",
  sublabel = "",
  size = 92,
  stroke = 7,
  tone = "info",
  style = {},
}: {
  value?: number;
  label?: string;
  sublabel?: string;
  size?: number;
  stroke?: number;
  tone?: "info" | "optimal" | "warn" | "critical" | "standby";
  style?: CSSProperties;
}) {
  const toneMap: Record<string, string> = {
    info: "var(--jv-cyan)",
    optimal: "var(--jv-green)",
    warn: "var(--jv-amber)",
    critical: "var(--jv-red)",
    standby: "var(--jv-violet)",
  };
  const c = toneMap[tone] || toneMap.info;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * circ;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 8, ...style }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)", filter: `drop-shadow(0 0 6px color-mix(in srgb, ${c} 55%, transparent))` }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(120,160,190,0.12)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={c}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            style={{ transition: "stroke-dasharray var(--dur-slow) var(--ease-hud)" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {label && (
            <span style={{ font: "var(--fw-medium) 10px/1 var(--font-hud)", letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              {label}
            </span>
          )}
          <span style={{ font: "var(--fw-bold) 18px/1 var(--font-display)", color: c, marginTop: 3 }}>{pct}%</span>
        </div>
      </div>
      {sublabel && <span style={{ font: "var(--fw-medium) 11px/1 var(--font-hud)", letterSpacing: "0.08em", color: "var(--text-muted)" }}>{sublabel}</span>}
    </div>
  );
}

// ---- Waveform -------------------------------------------------------------
export function Waveform({
  bars = 28,
  height = 40,
  color = "var(--jv-cyan)",
  active = true,
  style = {},
}: {
  bars?: number;
  height?: number;
  color?: string;
  active?: boolean;
  style?: CSSProperties;
}) {
  const seeds = useMemo(
    () => Array.from({ length: bars }, (_, i) => 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))),
    [bars],
  );
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, height, ...style }} aria-hidden="true">
      {seeds.map((s, i) => (
        <span
          key={i}
          style={{
            width: 2.5,
            borderRadius: 2,
            background: color,
            height: `${Math.round(s * 100)}%`,
            boxShadow: `0 0 6px color-mix(in srgb, ${color} 60%, transparent)`,
            transformOrigin: "center",
            animation: active ? `jv-equalize ${0.7 + (i % 5) * 0.18}s var(--ease-out) ${i * 0.04}s infinite` : "none",
            opacity: active ? 1 : 0.4,
          }}
        />
      ))}
    </div>
  );
}

// ---- VoiceOrb -------------------------------------------------------------
function DefaultMic({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

export function VoiceOrb({
  size = 120,
  listening = true,
  icon = null,
  onClick,
  style = {},
}: {
  size?: number;
  listening?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      aria-label="Tap to speak"
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid var(--jv-border-cyan)", animation: listening ? "jv-glow-breathe 2.4s var(--ease-out) infinite" : "none" }} />
      <span style={{ position: "absolute", inset: size * 0.13, borderRadius: "50%", border: "1px solid rgba(41,211,245,0.5)" }} />
      <span
        style={{
          position: "absolute",
          inset: size * 0.26,
          borderRadius: "50%",
          background: "radial-gradient(circle at 50% 40%, var(--jv-cyan-300), var(--jv-cyan-600))",
          boxShadow: "0 0 28px var(--jv-glow-cyan), inset 0 2px 6px rgba(255,255,255,0.35)",
          animation: listening ? "jv-pulse 2.4s var(--ease-out) infinite" : "none",
        }}
      />
      <span style={{ position: "relative", color: "#04141b", display: "inline-flex" }}>{icon || <DefaultMic size={size * 0.26} />}</span>
    </button>
  );
}
