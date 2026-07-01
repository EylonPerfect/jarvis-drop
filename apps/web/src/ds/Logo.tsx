import { type CSSProperties, useId } from "react";

// J.A.R.V.I.S. arc-reactor emblem: rotating dashed ring, segmented coil,
// triangular reactor core. Ported from the design-system bundle.
export function Logo({
  size = 44,
  color = "var(--jv-cyan)",
  core = "var(--jv-cyan-300)",
  wordmark = false,
  subtitle = "COMMAND CENTER",
  spin = true,
  style = {},
}: {
  size?: number;
  color?: string;
  core?: string;
  wordmark?: boolean;
  subtitle?: string;
  spin?: boolean;
  style?: CSSProperties;
}) {
  const uid = useId().replace(/[:]/g, "");
  const cx = 50;
  const cy = 50;

  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r1 = 26;
    const r2 = i % 2 === 0 ? 33 : 30;
    return { x1: cx + r1 * Math.cos(a), y1: cy + r1 * Math.sin(a), x2: cx + r2 * Math.cos(a), y2: cy + r2 * Math.sin(a), w: i % 2 === 0 ? 2 : 1 };
  });

  const blades = [0, 120, 240].map((deg) => {
    const a = (deg - 90) * (Math.PI / 180);
    const tip = 13;
    const base = 5;
    const halfW = 7;
    const ax = cx + tip * Math.cos(a);
    const ay = cy + tip * Math.sin(a);
    const pa = a + Math.PI / 2;
    const b1x = cx + base * Math.cos(a) + halfW * Math.cos(pa);
    const b1y = cy + base * Math.sin(a) + halfW * Math.sin(pa);
    const b2x = cx + base * Math.cos(a) - halfW * Math.cos(pa);
    const b2y = cy + base * Math.sin(a) - halfW * Math.sin(pa);
    return `M${ax.toFixed(2)} ${ay.toFixed(2)} L${b1x.toFixed(2)} ${b1y.toFixed(2)} L${b2x.toFixed(2)} ${b2y.toFixed(2)} Z`;
  });

  const svg = (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flex: "0 0 auto", overflow: "visible" }} aria-hidden="true">
      <defs>
        <radialGradient id={`core${uid}`} cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="35%" stopColor={core} />
          <stop offset="100%" stopColor={color} />
        </radialGradient>
        <filter id={`glow${uid}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g style={{ transformOrigin: "50px 50px", animation: spin ? "jv-spin 18s linear infinite" : "none" }}>
        <circle cx={cx} cy={cy} r={46} fill="none" stroke={color} strokeWidth="1.4" strokeDasharray="1.5 6" opacity="0.5" />
      </g>
      <g filter={`url(#glow${uid})`} style={{ transformOrigin: "50px 50px", animation: spin ? "jv-spin 30s linear infinite reverse" : "none" }}>
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={color} strokeWidth={t.w} strokeLinecap="round" opacity="0.85" />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={22} fill="none" stroke={core} strokeWidth="2.2" filter={`url(#glow${uid})`} />
      <circle cx={cx} cy={cy} r={18} fill="rgba(6,16,28,0.65)" />
      <circle cx={cx} cy={cy} r={12} fill={`url(#core${uid})`} filter={`url(#glow${uid})`} />
      <g fill="rgba(6,16,28,0.55)" filter={`url(#glow${uid})`}>
        {blades.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={3.2} fill="#ffffff" />
    </svg>
  );

  if (!wordmark) return <span style={{ display: "inline-flex", ...style }}>{svg}</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12, ...style }}>
      {svg}
      <span>
        <span style={{ display: "block", font: `var(--fw-bold) ${size * 0.46}px/1 var(--font-display)`, letterSpacing: "0.22em", color: "var(--jv-text)" }}>JARVIS</span>
        {subtitle && (
          <span style={{ display: "block", font: "var(--fw-medium) 9px/1 var(--font-hud)", letterSpacing: "0.30em", color: "var(--jv-text-muted)", marginTop: 5 }}>
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}
