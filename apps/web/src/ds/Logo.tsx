import { type CSSProperties } from "react";

// After Human emblem: a human silhouette dissolving into an ordered grid of
// cyan squares — "the workforce that comes next". Silhouette uses the theme
// text color; the grid uses the accent (cyan).
export function Logo({
  size = 44,
  color = "var(--jv-cyan)",
  wordmark = false,
  subtitle = "COMMAND CENTER",
  style = {},
}: {
  size?: number;
  color?: string;
  wordmark?: boolean;
  subtitle?: string;
  style?: CSSProperties;
}) {
  const mark = "var(--jv-text)";
  // 3×6 grid of accent squares (the "next workforce").
  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < 6; row++) for (let col = 0; col < 3; col++) cells.push({ x: col * 23, y: row * 23 });
  // Silhouette fragments trailing off toward the grid.
  const frags = [
    { x: 72, y: 8, s: 12, o: 0.9 }, { x: 91, y: 26, s: 10, o: 0.75 }, { x: 77, y: 45, s: 9, o: 0.7 },
    { x: 97, y: 57, s: 11, o: 0.6 }, { x: 82, y: 79, s: 9, o: 0.55 }, { x: 99, y: 93, s: 10, o: 0.5 },
    { x: 79, y: 108, s: 9, o: 0.45 },
  ];

  const svg = (
    <svg width={size} height={size} viewBox="0 0 256 256" style={{ flex: "0 0 auto", overflow: "visible" }} aria-hidden="true">
      <g transform="translate(14,44)">
        <circle fill={mark} cx="30" cy="22" r="19" />
        <path fill={mark} d="M6 51 h48 a5 5 0 0 1 5 5 v67 a5 5 0 0 1 -5 5 h-48 a5 5 0 0 1 -5 -5 v-67 a5 5 0 0 1 5 -5 z" />
        {frags.map((f, i) => (
          <rect key={i} fill={mark} x={f.x} y={f.y} width={f.s} height={f.s} rx="2" opacity={f.o} />
        ))}
        <g transform="translate(126,8)" style={{ animation: "jv-glow-breathe 3.6s var(--ease-out, ease) infinite" }}>
          {cells.map((c, i) => (
            <rect key={i} fill={color} x={c.x} y={c.y} width="16" height="16" rx="2" />
          ))}
        </g>
      </g>
    </svg>
  );

  if (!wordmark) return <span style={{ display: "inline-flex", ...style }}>{svg}</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12, ...style }}>
      {svg}
      <span>
        <span style={{ display: "block", font: `var(--fw-bold) ${size * 0.38}px/1 var(--font-display)`, letterSpacing: "0.14em", color: "var(--jv-text)", whiteSpace: "nowrap" }}>
          AFTER<span style={{ color: "var(--jv-text-muted)", fontWeight: 400 }}> HUMAN</span>
        </span>
        {subtitle && (
          <span style={{ display: "block", font: "var(--fw-medium) 9px/1 var(--font-hud)", letterSpacing: "0.30em", color: "var(--jv-text-muted)", marginTop: 5 }}>
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}
