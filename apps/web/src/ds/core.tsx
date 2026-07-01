import {
  type CSSProperties,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  useState,
} from "react";

type Tone = "optimal" | "info" | "warn" | "critical" | "standby" | "live" | "neutral";

// ---- Badge ----------------------------------------------------------------
export function Badge({
  children,
  status = "info",
  dot = true,
  solid = false,
  style = {},
  ...rest
}: {
  children?: ReactNode;
  status?: Tone;
  dot?: boolean;
  solid?: boolean;
  style?: CSSProperties;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const map: Record<string, { c: string; g: string }> = {
    optimal: { c: "var(--jv-green)", g: "var(--jv-glow-green)" },
    info: { c: "var(--jv-cyan)", g: "var(--jv-glow-cyan)" },
    warn: { c: "var(--jv-amber)", g: "var(--jv-glow-amber)" },
    critical: { c: "var(--jv-red)", g: "var(--jv-glow-red)" },
    standby: { c: "var(--jv-violet)", g: "var(--jv-glow-violet)" },
    live: { c: "var(--jv-red)", g: "var(--jv-glow-red)" },
    neutral: { c: "var(--jv-text-muted)", g: "transparent" },
  };
  const s = map[status] || map.info;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 10px",
        borderRadius: "var(--r-pill)",
        font: "var(--fw-semibold) 10px/1 var(--font-hud)",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        color: solid ? "var(--accent-contrast)" : s.c,
        background: solid ? s.c : `color-mix(in srgb, ${s.c} 14%, transparent)`,
        border: `1px solid ${solid ? "transparent" : `color-mix(in srgb, ${s.c} 45%, transparent)`}`,
        boxShadow: solid ? `0 0 12px ${s.g}` : "none",
        ...style,
      }}
      {...rest}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: solid ? "var(--accent-contrast)" : s.c,
            boxShadow: `0 0 6px ${s.g}`,
            animation: status === "live" ? "jv-pulse 1.4s ease-out infinite" : "none",
            flex: "0 0 auto",
          }}
        />
      )}
      {children}
    </span>
  );
}

// ---- Button ---------------------------------------------------------------
export function Button({
  children,
  variant = "primary",
  size = "md",
  chamfer = false,
  glow = true,
  disabled = false,
  icon = null,
  iconRight = null,
  style = {},
  ...rest
}: {
  children?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  chamfer?: boolean;
  glow?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  style?: CSSProperties;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const heights = { sm: 28, md: 36, lg: 44 };
  const pads = { sm: "0 12px", md: "0 16px", lg: "0 22px" };
  const fonts = { sm: 11, md: 12, lg: 13 };
  const palettes: Record<string, { background: string; color: string; border: string; shadow: string }> = {
    primary: {
      background: "var(--grad-cyan)",
      color: "var(--accent-contrast)",
      border: "1px solid rgba(41,211,245,0.6)",
      shadow: glow ? "0 0 16px var(--jv-glow-cyan), inset 0 1px 0 rgba(255,255,255,0.25)" : "none",
    },
    secondary: {
      background: "var(--grad-cyan-soft)",
      color: "var(--jv-cyan-100)",
      border: "1px solid var(--jv-border-cyan)",
      shadow: glow ? "inset 0 0 16px rgba(41,211,245,0.08)" : "none",
    },
    ghost: { background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--jv-border)", shadow: "none" },
    danger: {
      background: "linear-gradient(135deg, var(--jv-red-400), var(--jv-red-500))",
      color: "#fff",
      border: "1px solid rgba(251,91,110,0.6)",
      shadow: glow ? "0 0 16px var(--jv-glow-red)" : "none",
    },
  };
  const p = palettes[variant] || palettes.primary;
  return (
    <button
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: heights[size],
        padding: pads[size],
        font: `var(--fw-semibold) ${fonts[size]}px/1 var(--font-hud)`,
        textTransform: "uppercase",
        letterSpacing: "0.10em",
        whiteSpace: "nowrap",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        borderRadius: chamfer ? 0 : "var(--r-sm)",
        clipPath: chamfer ? "var(--clip-chamfer)" : "none",
        background: p.background,
        color: p.color,
        border: p.border,
        boxShadow: p.shadow,
        transition: "filter var(--t), transform var(--t-fast), box-shadow var(--t)",
        ...style,
      }}
      onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "translateY(1px) scale(0.99)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "")}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.filter = "";
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.filter = "brightness(1.12)")}
      {...rest}
    >
      {icon && <span style={{ display: "inline-flex", width: 16, height: 16 }}>{icon}</span>}
      {children}
      {iconRight && <span style={{ display: "inline-flex", width: 16, height: 16 }}>{iconRight}</span>}
    </button>
  );
}

// ---- Input ----------------------------------------------------------------
export function Input({
  icon = null,
  trailing = null,
  mono = false,
  style = {},
  wrapStyle = {},
  ...rest
}: {
  icon?: ReactNode;
  trailing?: ReactNode;
  mono?: boolean;
  style?: CSSProperties;
  wrapStyle?: CSSProperties;
} & InputHTMLAttributes<HTMLInputElement>) {
  const [focus, setFocus] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 40,
        padding: "0 12px",
        borderRadius: "var(--r-sm)",
        background: "rgba(4, 12, 22, 0.6)",
        border: `1px solid ${focus ? "var(--jv-border-cyan)" : "var(--jv-border)"}`,
        boxShadow: focus ? "0 0 0 3px rgba(41,211,245,0.10), inset 0 0 12px rgba(41,211,245,0.05)" : "none",
        transition: "all var(--t-fast)",
        ...wrapStyle,
      }}
    >
      {icon && <span style={{ display: "inline-flex", color: "var(--text-muted)", width: 16, height: 16 }}>{icon}</span>}
      <input
        {...rest}
        onFocus={(e) => {
          setFocus(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          rest.onBlur?.(e);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--text-primary)",
          font: mono ? "var(--fw-regular) 12px/1 var(--font-mono)" : "var(--fw-regular) 13px/1 var(--font-body)",
          ...style,
        }}
      />
      {trailing}
    </div>
  );
}

// ---- NavItem --------------------------------------------------------------
export function NavItem({
  icon = null,
  label,
  count = null,
  active = false,
  onClick,
  style = {},
}: {
  icon?: ReactNode;
  label: ReactNode;
  count?: number | null;
  active?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        height: 42,
        padding: "0 14px",
        borderRadius: "var(--r-sm)",
        border: active ? "1px solid var(--jv-border-cyan)" : "1px solid transparent",
        background: active ? "var(--grad-cyan-soft)" : hover ? "rgba(41,211,245,0.05)" : "transparent",
        color: active ? "var(--jv-cyan-100)" : hover ? "var(--text-primary)" : "var(--text-secondary)",
        cursor: "pointer",
        textAlign: "left",
        font: "var(--fw-medium) 14px/1 var(--font-body)",
        boxShadow: active ? "inset 0 0 16px rgba(41,211,245,0.08)" : "none",
        transition: "all var(--t-fast)",
        ...style,
      }}
    >
      {active && (
        <span
          style={{
            position: "absolute",
            left: -1,
            top: 9,
            bottom: 9,
            width: 2.5,
            borderRadius: 2,
            background: "var(--jv-cyan)",
            boxShadow: "0 0 8px var(--jv-glow-cyan)",
          }}
        />
      )}
      {icon && <span style={{ display: "inline-flex", width: 18, height: 18, color: active ? "var(--jv-cyan)" : "inherit" }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      {count != null && (
        <span
          style={{
            minWidth: 20,
            height: 20,
            padding: "0 6px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--r-pill)",
            font: "var(--fw-semibold) 11px/1 var(--font-mono)",
            color: active ? "var(--accent-contrast)" : "var(--jv-cyan-100)",
            background: active ? "var(--jv-cyan)" : "rgba(41,211,245,0.12)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ---- Panel ----------------------------------------------------------------
function Brackets() {
  const base: CSSProperties = {
    position: "absolute",
    width: 14,
    height: 14,
    borderColor: "var(--jv-border-cyan)",
    borderStyle: "solid",
    pointerEvents: "none",
  };
  return (
    <>
      <span style={{ ...base, top: 8, left: 8, borderWidth: "1.5px 0 0 1.5px" }} />
      <span style={{ ...base, top: 8, right: 8, borderWidth: "1.5px 1.5px 0 0" }} />
      <span style={{ ...base, bottom: 8, left: 8, borderWidth: "0 0 1.5px 1.5px" }} />
      <span style={{ ...base, bottom: 8, right: 8, borderWidth: "0 1.5px 1.5px 0" }} />
    </>
  );
}

export function Panel({
  title = null,
  eyebrow = false,
  action = null,
  brackets = false,
  chamfer = false,
  active = false,
  pad = true,
  children,
  style = {},
  bodyStyle = {},
  ...rest
}: {
  title?: ReactNode;
  eyebrow?: boolean;
  action?: ReactNode;
  brackets?: boolean;
  chamfer?: boolean;
  active?: boolean;
  pad?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section
      style={{
        position: "relative",
        background: "var(--grad-panel)",
        borderRadius: chamfer ? 0 : "var(--r-md)",
        clipPath: chamfer ? "var(--clip-chamfer)" : "none",
        boxShadow: active ? "var(--panel-shadow-active)" : "var(--panel-shadow)",
        padding: pad ? "var(--panel-pad)" : 0,
        ...style,
      }}
      {...rest}
    >
      {brackets && <Brackets />}
      {(title || action) && (
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <h3
            style={{
              margin: 0,
              color: eyebrow ? "var(--jv-cyan-300)" : "var(--text-primary)",
              font: eyebrow ? "var(--fw-semibold) 11px/1 var(--font-hud)" : "var(--fw-semibold) 16px/1.2 var(--font-body)",
              letterSpacing: eyebrow ? "0.16em" : "0",
              textTransform: eyebrow ? "uppercase" : "none",
            }}
          >
            {title}
          </h3>
          {action && <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{action}</div>}
        </header>
      )}
      <div style={bodyStyle}>{children}</div>
    </section>
  );
}

// ---- StatTile -------------------------------------------------------------
export function StatTile({
  value,
  label,
  tone = "info",
  style = {},
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: "info" | "optimal" | "warn" | "critical" | "standby";
  style?: CSSProperties;
}) {
  const map: Record<string, string> = {
    info: "var(--jv-cyan)",
    optimal: "var(--jv-green)",
    warn: "var(--jv-amber)",
    critical: "var(--jv-red)",
    standby: "var(--jv-violet)",
  };
  const c = map[tone] || map.info;
  return (
    <div
      style={{
        position: "relative",
        padding: "14px 16px",
        borderRadius: "var(--r-md)",
        background: `linear-gradient(150deg, color-mix(in srgb, ${c} 16%, transparent), color-mix(in srgb, ${c} 4%, transparent))`,
        border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ font: "var(--fw-bold) 30px/1 var(--font-display)", color: c, textShadow: `0 0 14px color-mix(in srgb, ${c} 55%, transparent)` }}>
        {value}
      </div>
      <div style={{ marginTop: 6, font: "var(--fw-medium) 11px/1 var(--font-hud)", letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)" }}>
        {label}
      </div>
    </div>
  );
}

// ---- StatusRow ------------------------------------------------------------
export function StatusRow({
  icon = null,
  name,
  status,
  tone = "optimal",
  iconTone = "info",
  trailing = null,
  style = {},
}: {
  icon?: ReactNode;
  name: ReactNode;
  status?: ReactNode;
  tone?: "optimal" | "info" | "warn" | "critical" | "standby" | "muted";
  iconTone?: "optimal" | "info" | "warn" | "critical" | "standby" | "muted";
  trailing?: ReactNode;
  style?: CSSProperties;
}) {
  const toneMap: Record<string, string> = {
    optimal: "var(--jv-green)",
    info: "var(--jv-cyan)",
    warn: "var(--jv-amber)",
    critical: "var(--jv-red)",
    standby: "var(--jv-violet)",
    muted: "var(--jv-text-muted)",
  };
  const sc = toneMap[tone] || toneMap.optimal;
  const ic = toneMap[iconTone] || toneMap.info;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: "var(--r-sm)",
        background: "var(--jv-surface-3)",
        border: "1px solid var(--jv-border-soft)",
        ...style,
      }}
    >
      {icon && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "var(--r-sm)",
            color: ic,
            background: `color-mix(in srgb, ${ic} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${ic} 35%, transparent)`,
          }}
        >
          {icon}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--fw-semibold) 13px/1.2 var(--font-body)", color: "var(--text-primary)" }}>{name}</div>
        {status && (
          <div style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 6, font: "var(--fw-medium) 11px/1 var(--font-hud)", letterSpacing: "0.04em", color: sc }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: sc, boxShadow: `0 0 6px ${sc}` }} />
            {status}
          </div>
        )}
      </div>
      {trailing}
    </div>
  );
}

// ---- Switch ---------------------------------------------------------------
export function Switch({
  checked = false,
  onChange,
  disabled = false,
  style = {},
}: {
  checked?: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{
        position: "relative",
        width: 42,
        height: 24,
        flex: "0 0 auto",
        borderRadius: "var(--r-pill)",
        border: `1px solid ${checked ? "var(--jv-border-cyan)" : "var(--jv-border)"}`,
        background: checked ? "var(--grad-cyan-soft)" : "rgba(4,12,22,0.6)",
        boxShadow: checked ? "inset 0 0 12px rgba(41,211,245,0.20)" : "inset 0 1px 2px rgba(0,0,0,0.4)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all var(--t)",
        padding: 0,
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: checked ? "var(--jv-cyan)" : "var(--jv-text-muted)",
          boxShadow: checked ? "0 0 10px var(--jv-glow-cyan)" : "0 1px 2px rgba(0,0,0,0.5)",
          transition: "all var(--t) var(--ease-hud)",
        }}
      />
    </button>
  );
}

// ---- Tag ------------------------------------------------------------------
export function Tag({
  children,
  priority = null,
  style = {},
}: {
  children?: ReactNode;
  priority?: "critical" | "high" | "medium" | "low" | null;
  style?: CSSProperties;
}) {
  if (priority) {
    const map: Record<string, string> = {
      critical: "var(--tag-critical)",
      high: "var(--tag-high)",
      medium: "var(--tag-medium)",
      low: "var(--tag-low)",
    };
    const c = map[priority] || map.medium;
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          height: 18,
          padding: "0 7px",
          borderRadius: "var(--r-xs)",
          font: "var(--fw-bold) 9px/1 var(--font-hud)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: c,
          background: `color-mix(in srgb, ${c} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`,
          ...style,
        }}
      >
        {children || priority}
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 19,
        padding: "0 8px",
        borderRadius: "var(--r-sm)",
        font: "var(--fw-medium) 11px/1 var(--font-mono)",
        color: "var(--jv-cyan-100)",
        background: "rgba(41,211,245,0.07)",
        border: "1px solid var(--jv-border-soft)",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
