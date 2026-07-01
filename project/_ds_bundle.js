/* @ds-bundle: {"format":3,"namespace":"JARVISDesignSystem_547efc","components":[{"name":"Logo","sourcePath":"components/brand/Logo.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"NavItem","sourcePath":"components/core/NavItem.jsx"},{"name":"Panel","sourcePath":"components/core/Panel.jsx"},{"name":"StatTile","sourcePath":"components/core/StatTile.jsx"},{"name":"StatusRow","sourcePath":"components/core/StatusRow.jsx"},{"name":"Switch","sourcePath":"components/core/Switch.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"ProgressRing","sourcePath":"components/hud/ProgressRing.jsx"},{"name":"VoiceOrb","sourcePath":"components/hud/VoiceOrb.jsx"},{"name":"Waveform","sourcePath":"components/hud/Waveform.jsx"}],"sourceHashes":{"components/brand/Logo.jsx":"10a46c9a7a3f","components/core/Badge.jsx":"1f4fe2f98609","components/core/Button.jsx":"c7e531c1470d","components/core/Icon.jsx":"ea44b6fe75f9","components/core/Input.jsx":"96c2fd9e76fd","components/core/NavItem.jsx":"deae8741841f","components/core/Panel.jsx":"30921dddaf02","components/core/StatTile.jsx":"8dc8f5304d5f","components/core/StatusRow.jsx":"b6548095fe1f","components/core/Switch.jsx":"d5fe2fec3127","components/core/Tag.jsx":"05713e8d4d44","components/hud/ProgressRing.jsx":"bfb93e814c14","components/hud/VoiceOrb.jsx":"7555d336f766","components/hud/Waveform.jsx":"7c742c1aad3d","ui_kits/command-center/AppShell.jsx":"eb75b2ef71be","ui_kits/command-center/CommandCenter.jsx":"bd1c6959cee8","ui_kits/command-center/SystemMonitor.jsx":"fdf23c5d714c","ui_kits/command-center/TasksKanban.jsx":"fc86424603f3","ui_kits/command-center/tweaks-panel.jsx":"6591467622ed"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.JARVISDesignSystem_547efc = window.JARVISDesignSystem_547efc || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/brand/Logo.jsx
try { (() => {
/**
 * Logo — the J.A.R.V.I.S. arc-reactor emblem. A glowing triangular reactor core
 * inside a segmented coil ring, an inner solid ring, and an outer rotating
 * dashed ring. Crisp SVG, color-driven by `color`, with an optional slow spin.
 * Optionally renders the "JARVIS / COMMAND CENTER" wordmark lockup.
 */
function Logo({
  size = 44,
  color = "var(--jv-cyan)",
  core = "var(--jv-cyan-300)",
  wordmark = false,
  subtitle = "COMMAND CENTER",
  spin = true,
  style = {}
}) {
  const uid = React.useId().replace(/[:]/g, "");
  const cx = 50,
    cy = 50;

  // coil ticks — 24 short radial segments forming the reactor coil ring
  const ticks = Array.from({
    length: 24
  }, (_, i) => {
    const a = i / 24 * Math.PI * 2;
    const r1 = 26,
      r2 = i % 2 === 0 ? 33 : 30;
    return {
      x1: cx + r1 * Math.cos(a),
      y1: cy + r1 * Math.sin(a),
      x2: cx + r2 * Math.cos(a),
      y2: cy + r2 * Math.sin(a),
      w: i % 2 === 0 ? 2 : 1
    };
  });

  // triangular reactor core (3 chevron blades, Iron-Man style)
  const blades = [0, 120, 240].map(deg => {
    const a = (deg - 90) * (Math.PI / 180);
    const tip = 13,
      base = 5,
      halfW = 7;
    const ax = cx + tip * Math.cos(a),
      ay = cy + tip * Math.sin(a);
    const pa = a + Math.PI / 2;
    const b1x = cx + base * Math.cos(a) + halfW * Math.cos(pa);
    const b1y = cy + base * Math.sin(a) + halfW * Math.sin(pa);
    const b2x = cx + base * Math.cos(a) - halfW * Math.cos(pa);
    const b2y = cy + base * Math.sin(a) - halfW * Math.sin(pa);
    return `M${ax.toFixed(2)} ${ay.toFixed(2)} L${b1x.toFixed(2)} ${b1y.toFixed(2)} L${b2x.toFixed(2)} ${b2y.toFixed(2)} Z`;
  });
  const svg = /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 100 100",
    style: {
      flex: "0 0 auto",
      overflow: "visible"
    },
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("radialGradient", {
    id: `core${uid}`,
    cx: "50%",
    cy: "42%",
    r: "60%"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#ffffff"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "35%",
    stopColor: core
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: color
  })), /*#__PURE__*/React.createElement("filter", {
    id: `glow${uid}`,
    x: "-60%",
    y: "-60%",
    width: "220%",
    height: "220%"
  }, /*#__PURE__*/React.createElement("feGaussianBlur", {
    stdDeviation: "2.4",
    result: "b"
  }), /*#__PURE__*/React.createElement("feMerge", null, /*#__PURE__*/React.createElement("feMergeNode", {
    in: "b"
  }), /*#__PURE__*/React.createElement("feMergeNode", {
    in: "SourceGraphic"
  })))), /*#__PURE__*/React.createElement("g", {
    style: {
      transformOrigin: "50px 50px",
      animation: spin ? "jv-spin 18s linear infinite" : "none"
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: 46,
    fill: "none",
    stroke: color,
    strokeWidth: "1.4",
    strokeDasharray: "1.5 6",
    opacity: "0.5"
  })), /*#__PURE__*/React.createElement("g", {
    filter: `url(#glow${uid})`,
    style: {
      transformOrigin: "50px 50px",
      animation: spin ? "jv-spin 30s linear infinite reverse" : "none"
    }
  }, ticks.map((t, i) => /*#__PURE__*/React.createElement("line", {
    key: i,
    x1: t.x1,
    y1: t.y1,
    x2: t.x2,
    y2: t.y2,
    stroke: color,
    strokeWidth: t.w,
    strokeLinecap: "round",
    opacity: "0.85"
  }))), /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: 22,
    fill: "none",
    stroke: core,
    strokeWidth: "2.2",
    filter: `url(#glow${uid})`
  }), /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: 18,
    fill: "rgba(6,16,28,0.65)"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: 12,
    fill: `url(#core${uid})`,
    filter: `url(#glow${uid})`
  }), /*#__PURE__*/React.createElement("g", {
    fill: "rgba(6,16,28,0.55)",
    filter: `url(#glow${uid})`
  }, blades.map((d, i) => /*#__PURE__*/React.createElement("path", {
    key: i,
    d: d
  }))), /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: 3.2,
    fill: "#ffffff"
  }));
  if (!wordmark) return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      ...style
    }
  }, svg);
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      ...style
    }
  }, svg, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: `var(--fw-bold) ${size * 0.46}px/1 var(--font-display)`,
      letterSpacing: "0.22em",
      color: "var(--jv-text)"
    }
  }, "JARVIS"), subtitle && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--fw-medium) 9px/1 var(--font-hud)",
      letterSpacing: "0.30em",
      color: "var(--jv-text-muted)",
      marginTop: 5
    }
  }, subtitle)));
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Logo.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Status badge / pill. Shows a live system status with a glowing dot
 * (optimal/warn/critical/info/standby/live) or a neutral label.
 */
function Badge({
  children,
  status = "info",
  dot = true,
  solid = false,
  style = {},
  ...rest
}) {
  const map = {
    optimal: {
      c: "var(--jv-green)",
      g: "var(--jv-glow-green)"
    },
    info: {
      c: "var(--jv-cyan)",
      g: "var(--jv-glow-cyan)"
    },
    warn: {
      c: "var(--jv-amber)",
      g: "var(--jv-glow-amber)"
    },
    critical: {
      c: "var(--jv-red)",
      g: "var(--jv-glow-red)"
    },
    standby: {
      c: "var(--jv-violet)",
      g: "var(--jv-glow-violet)"
    },
    live: {
      c: "var(--jv-red)",
      g: "var(--jv-glow-red)"
    },
    neutral: {
      c: "var(--jv-text-muted)",
      g: "transparent"
    }
  };
  const s = map[status] || map.info;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
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
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: solid ? "var(--accent-contrast)" : s.c,
      boxShadow: `0 0 6px ${s.g}`,
      animation: status === "live" ? "jv-pulse 1.4s ease-out infinite" : "none",
      flex: "0 0 auto"
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * JARVIS HUD Button. Cyan glowing primary by default; secondary (outline),
 * ghost, and danger variants. Supports chamfered corners and an optional icon.
 */
function Button({
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
}) {
  const heights = {
    sm: 28,
    md: 36,
    lg: 44
  };
  const pads = {
    sm: "0 12px",
    md: "0 16px",
    lg: "0 22px"
  };
  const fonts = {
    sm: 11,
    md: 12,
    lg: 13
  };
  const h = heights[size];
  const palettes = {
    primary: {
      background: "var(--grad-cyan)",
      color: "var(--accent-contrast)",
      border: "1px solid rgba(41,211,245,0.6)",
      shadow: glow ? "0 0 16px var(--jv-glow-cyan), inset 0 1px 0 rgba(255,255,255,0.25)" : "none"
    },
    secondary: {
      background: "var(--grad-cyan-soft)",
      color: "var(--jv-cyan-100)",
      border: "1px solid var(--jv-border-cyan)",
      shadow: glow ? "inset 0 0 16px rgba(41,211,245,0.08)" : "none"
    },
    ghost: {
      background: "transparent",
      color: "var(--text-secondary)",
      border: "1px solid var(--jv-border)",
      shadow: "none"
    },
    danger: {
      background: "linear-gradient(135deg, var(--jv-red-400), var(--jv-red-500))",
      color: "#fff",
      border: "1px solid rgba(251,91,110,0.6)",
      shadow: glow ? "0 0 16px var(--jv-glow-red)" : "none"
    }
  };
  const p = palettes[variant] || palettes.primary;
  return /*#__PURE__*/React.createElement("button", _extends({
    disabled: disabled,
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      height: h,
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
      ...style
    },
    onMouseDown: e => !disabled && (e.currentTarget.style.transform = "translateY(1px) scale(0.99)"),
    onMouseUp: e => e.currentTarget.style.transform = "",
    onMouseLeave: e => {
      e.currentTarget.style.transform = "";
      e.currentTarget.style.filter = "";
    },
    onMouseEnter: e => !disabled && (e.currentTarget.style.filter = "brightness(1.12)")
  }, rest), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      width: 16,
      height: 16
    }
  }, icon), children, iconRight && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      width: 16,
      height: 16
    }
  }, iconRight));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Icon — thin wrapper over Lucide (the JARVIS icon set: 1.75px stroke,
 * round caps, 24px grid). Requires the Lucide UMD script to be present on
 * the page (window.lucide). Renders an inline SVG sized to `size`.
 */
function Icon({
  name,
  size = 18,
  color = "currentColor",
  strokeWidth = 1.75,
  style = {},
  ...rest
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const lucide = typeof window !== "undefined" ? window.lucide : null;
    const data = lucide && lucide.icons;
    // lucide.icons keys are PascalCase; accept kebab too
    const toPascal = s => s.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
    const node = data ? data[toPascal(name)] || data[name] : null;
    if (node && lucide.createElement) {
      el.innerHTML = "";
      const svg = lucide.createElement(node);
      svg.setAttribute("width", size);
      svg.setAttribute("height", size);
      svg.setAttribute("stroke-width", strokeWidth);
      el.appendChild(svg);
    } else if (lucide && lucide.createIcons) {
      // fallback: data-attribute replacement
      el.innerHTML = `<i data-lucide="${name}"></i>`;
      lucide.createIcons({
        nameAttr: "data-lucide",
        attrs: {
          width: size,
          height: size,
          "stroke-width": strokeWidth
        }
      });
    }
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", _extends({
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: size,
      height: size,
      color,
      flex: "0 0 auto",
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Input — HUD text field. Dark inset, cyan focus glow, optional leading icon
 * and trailing affordance (eye toggle, etc.). Use for search and key entry.
 */
function Input({
  icon = null,
  trailing = null,
  mono = false,
  style = {},
  wrapStyle = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
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
      ...wrapStyle
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      color: "var(--text-muted)",
      width: 16,
      height: 16
    }
  }, icon), /*#__PURE__*/React.createElement("input", _extends({
    onFocus: e => {
      setFocus(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setFocus(false);
      rest.onBlur && rest.onBlur(e);
    },
    style: {
      flex: 1,
      minWidth: 0,
      height: "100%",
      border: "none",
      outline: "none",
      background: "transparent",
      color: "var(--text-primary)",
      font: mono ? "var(--fw-regular) 12px/1 var(--font-mono)" : "var(--fw-regular) 13px/1 var(--font-body)",
      ...style
    }
  }, rest)), trailing);
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/NavItem.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * NavItem — left-rail navigation row. Icon + label, optional count badge,
 * and an active state with cyan glow + left indicator bar.
 */
function NavItem({
  icon = null,
  label,
  count = null,
  active = false,
  onClick,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
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
      ...style
    }
  }, rest), active && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: -1,
      top: 9,
      bottom: 9,
      width: 2.5,
      borderRadius: 2,
      background: "var(--jv-cyan)",
      boxShadow: "0 0 8px var(--jv-glow-cyan)"
    }
  }), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      width: 18,
      height: 18,
      color: active ? "var(--jv-cyan)" : "inherit"
    }
  }, icon), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, label), count != null && /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 20,
      height: 20,
      padding: "0 6px",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "var(--r-pill)",
      font: "var(--fw-semibold) 11px/1 var(--font-mono)",
      color: active ? "var(--accent-contrast)" : "var(--jv-cyan-100)",
      background: active ? "var(--jv-cyan)" : "rgba(41,211,245,0.12)"
    }
  }, count));
}
Object.assign(__ds_scope, { NavItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/NavItem.jsx", error: String((e && e.message) || e) }); }

// components/core/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Panel — the HUD container behind nearly every region. Gradient navy fill,
 * inner edge-light, optional corner brackets and chamfered corners. Header
 * shows a tracked title plus optional right-side action/meta.
 */
function Panel({
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
}) {
  return /*#__PURE__*/React.createElement("section", _extends({
    style: {
      position: "relative",
      background: "var(--grad-panel)",
      borderRadius: chamfer ? 0 : "var(--r-md)",
      clipPath: chamfer ? "var(--clip-chamfer)" : "none",
      boxShadow: active ? "var(--panel-shadow-active)" : "var(--panel-shadow)",
      padding: pad ? "var(--panel-pad)" : 0,
      ...style
    }
  }, rest), brackets && /*#__PURE__*/React.createElement(Brackets, null), (title || action) && /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      color: eyebrow ? "var(--jv-cyan-300)" : "var(--text-primary)",
      font: eyebrow ? "var(--fw-semibold) 11px/1 var(--font-hud)" : "var(--fw-semibold) 16px/1.2 var(--font-body)",
      letterSpacing: eyebrow ? "0.16em" : "0",
      textTransform: eyebrow ? "uppercase" : "none"
    }
  }, title), action && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, action)), /*#__PURE__*/React.createElement("div", {
    style: bodyStyle
  }, children));
}
function Brackets() {
  const base = {
    position: "absolute",
    width: 14,
    height: 14,
    borderColor: "var(--jv-border-cyan)",
    borderStyle: "solid",
    pointerEvents: "none"
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      ...base,
      top: 8,
      left: 8,
      borderWidth: "1.5px 0 0 1.5px"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      ...base,
      top: 8,
      right: 8,
      borderWidth: "1.5px 1.5px 0 0"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      ...base,
      bottom: 8,
      left: 8,
      borderWidth: "0 0 1.5px 1.5px"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      ...base,
      bottom: 8,
      right: 8,
      borderWidth: "0 1.5px 1.5px 0"
    }
  }));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Panel.jsx", error: String((e && e.message) || e) }); }

// components/core/StatTile.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StatTile — big colored metric in a tinted, chamfered box (Mission Stats:
 * "4 Ready", "3 In Progress", "2 Blocked", "5 Done").
 */
function StatTile({
  value,
  label,
  tone = "info",
  style = {},
  ...rest
}) {
  const map = {
    info: "var(--jv-cyan)",
    optimal: "var(--jv-green)",
    warn: "var(--jv-amber)",
    critical: "var(--jv-red)",
    standby: "var(--jv-violet)"
  };
  const c = map[tone] || map.info;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      position: "relative",
      padding: "14px 16px",
      borderRadius: "var(--r-md)",
      background: `linear-gradient(150deg, color-mix(in srgb, ${c} 16%, transparent), color-mix(in srgb, ${c} 4%, transparent))`,
      border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
      overflow: "hidden",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--fw-bold) 30px/1 var(--font-display)",
      color: c,
      textShadow: `0 0 14px color-mix(in srgb, ${c} 55%, transparent)`
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      font: "var(--fw-medium) 11px/1 var(--font-hud)",
      letterSpacing: "0.10em",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label));
}
Object.assign(__ds_scope, { StatTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatTile.jsx", error: String((e && e.message) || e) }); }

// components/core/StatusRow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StatusRow — an icon tile + name + sub-status line, optional trailing node.
 * Used in "AI Core Overview", "LLM Status", "Active Agents" lists.
 */
function StatusRow({
  icon = null,
  name,
  status,
  tone = "optimal",
  iconTone = "info",
  trailing = null,
  style = {},
  ...rest
}) {
  const toneMap = {
    optimal: "var(--jv-green)",
    info: "var(--jv-cyan)",
    warn: "var(--jv-amber)",
    critical: "var(--jv-red)",
    standby: "var(--jv-violet)",
    muted: "var(--jv-text-muted)"
  };
  const sc = toneMap[tone] || toneMap.optimal;
  const ic = toneMap[iconTone] || toneMap.info;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 12px",
      borderRadius: "var(--r-sm)",
      background: "var(--jv-surface-3)",
      border: "1px solid var(--jv-border-soft)",
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 32,
      height: 32,
      borderRadius: "var(--r-sm)",
      color: ic,
      background: `color-mix(in srgb, ${ic} 14%, transparent)`,
      border: `1px solid color-mix(in srgb, ${ic} 35%, transparent)`
    }
  }, icon), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--fw-semibold) 13px/1.2 var(--font-body)",
      color: "var(--text-primary)"
    }
  }, name), status && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 2,
      display: "flex",
      alignItems: "center",
      gap: 6,
      font: "var(--fw-medium) 11px/1 var(--font-hud)",
      letterSpacing: "0.04em",
      color: sc
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 5,
      height: 5,
      borderRadius: "50%",
      background: sc,
      boxShadow: `0 0 6px ${sc}`
    }
  }), status)), trailing);
}
Object.assign(__ds_scope, { StatusRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatusRow.jsx", error: String((e && e.message) || e) }); }

// components/core/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Switch — HUD toggle. Cyan glowing track when on; smooth knob slide.
 */
function Switch({
  checked = false,
  onChange,
  disabled = false,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    role: "switch",
    "aria-checked": checked,
    disabled: disabled,
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
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
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 2,
      left: checked ? 20 : 2,
      width: 18,
      height: 18,
      borderRadius: "50%",
      background: checked ? "var(--jv-cyan)" : "var(--jv-text-muted)",
      boxShadow: checked ? "0 0 10px var(--jv-glow-cyan)" : "0 1px 2px rgba(0,0,0,0.5)",
      transition: "all var(--t) var(--ease-hud)"
    }
  }));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Switch.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Tag — small metadata chip. Two flavors:
 *  • priority: CRITICAL / HIGH / MEDIUM / LOW (colored uppercase, screenshot style)
 *  • label: plain lowercase token chips (e.g. "voice", "electron", "api")
 */
function Tag({
  children,
  priority = null,
  style = {},
  ...rest
}) {
  if (priority) {
    const map = {
      critical: "var(--tag-critical)",
      high: "var(--tag-high)",
      medium: "var(--tag-medium)",
      low: "var(--tag-low)"
    };
    const c = map[priority] || map.medium;
    return /*#__PURE__*/React.createElement("span", _extends({
      style: {
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
        ...style
      }
    }, rest), children || priority);
  }
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      height: 19,
      padding: "0 8px",
      borderRadius: "var(--r-sm)",
      font: "var(--fw-medium) 11px/1 var(--font-mono)",
      color: "var(--jv-cyan-100)",
      background: "rgba(41,211,245,0.07)",
      border: "1px solid var(--jv-border-soft)",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/hud/ProgressRing.jsx
try { (() => {
/**
 * ProgressRing — donut gauge for CPU / RAM / Disk. Glowing cyan arc on a
 * dark track, value + label centered. Pure SVG, no deps.
 */
function ProgressRing({
  value = 0,
  label = "",
  sublabel = "",
  size = 92,
  stroke = 7,
  tone = "info",
  style = {}
}) {
  const toneMap = {
    info: "var(--jv-cyan)",
    optimal: "var(--jv-green)",
    warn: "var(--jv-amber)",
    critical: "var(--jv-red)",
    standby: "var(--jv-violet)"
  };
  const c = toneMap[tone] || toneMap.info;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const dash = pct / 100 * circ;
  const id = React.useId();
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 8,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      width: size,
      height: size
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    style: {
      transform: "rotate(-90deg)",
      filter: `drop-shadow(0 0 6px color-mix(in srgb, ${c} 55%, transparent))`
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: "rgba(120,160,190,0.12)",
    strokeWidth: stroke
  }), /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: c,
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeDasharray: `${dash} ${circ}`,
    style: {
      transition: "stroke-dasharray var(--dur-slow) var(--ease-hud)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center"
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--fw-medium) 10px/1 var(--font-hud)",
      letterSpacing: "0.10em",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--fw-bold) 18px/1 var(--font-display)",
      color: c,
      marginTop: 3
    }
  }, pct, "%"))), sublabel && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--fw-medium) 11px/1 var(--font-hud)",
      letterSpacing: "0.08em",
      color: "var(--text-muted)"
    }
  }, sublabel));
}
Object.assign(__ds_scope, { ProgressRing });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/hud/ProgressRing.jsx", error: String((e && e.message) || e) }); }

// components/hud/VoiceOrb.jsx
try { (() => {
/**
 * VoiceOrb — the glowing "Tap to Speak" mic orb. Concentric breathing rings,
 * radial cyan core, centered mic icon. The emotional center of the HUD.
 */
function VoiceOrb({
  size = 120,
  listening = true,
  icon = null,
  onClick,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    "aria-label": "Tap to speak",
    style: {
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
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: 0,
      borderRadius: "50%",
      border: "1px solid var(--jv-border-cyan)",
      animation: listening ? "jv-glow-breathe 2.4s var(--ease-out) infinite" : "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: size * 0.13,
      borderRadius: "50%",
      border: "1px solid rgba(41,211,245,0.5)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: size * 0.26,
      borderRadius: "50%",
      background: "radial-gradient(circle at 50% 40%, var(--jv-cyan-300), var(--jv-cyan-600))",
      boxShadow: "0 0 28px var(--jv-glow-cyan), inset 0 2px 6px rgba(255,255,255,0.35)",
      animation: listening ? "jv-pulse 2.4s var(--ease-out) infinite" : "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      color: "#04141b",
      display: "inline-flex"
    }
  }, icon || /*#__PURE__*/React.createElement(DefaultMic, {
    size: size * 0.26
  })));
}
function DefaultMic({
  size = 30
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "9",
    y: "2",
    width: "6",
    height: "12",
    rx: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 10a7 7 0 0 0 14 0"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "19",
    x2: "12",
    y2: "22"
  }));
}
Object.assign(__ds_scope, { VoiceOrb });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/hud/VoiceOrb.jsx", error: String((e && e.message) || e) }); }

// components/hud/Waveform.jsx
try { (() => {
/**
 * Waveform — animated audio equalizer bars (the voice-activity motif).
 * Deterministic bar heights; CSS-animated when `active`.
 */
function Waveform({
  bars = 28,
  height = 40,
  color = "var(--jv-cyan)",
  active = true,
  style = {}
}) {
  const seeds = React.useMemo(() => Array.from({
    length: bars
  }, (_, i) => 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))), [bars]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
      height,
      ...style
    },
    "aria-hidden": "true"
  }, seeds.map((s, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: 2.5,
      borderRadius: 2,
      background: color,
      height: `${Math.round(s * 100)}%`,
      boxShadow: `0 0 6px color-mix(in srgb, ${color} 60%, transparent)`,
      transformOrigin: "center",
      animation: active ? `jv-equalize ${0.7 + i % 5 * 0.18}s var(--ease-out) ${i * 0.04}s infinite` : "none",
      opacity: active ? 1 : 0.4
    }
  })));
}
Object.assign(__ds_scope, { Waveform });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/hud/Waveform.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/AppShell.jsx
try { (() => {
// AppShell — JARVIS HUD chrome: left rail (logo + nav + voice status + focus),
// top bar (status, clock, search, model, operator), and bottom "TALK TO JARVIS" dock.
// Composes design-system primitives from window.JARVISDesignSystem_547efc.
(function () {
  const {
    NavItem,
    Input,
    Badge,
    Waveform,
    VoiceOrb,
    Button,
    Icon,
    Logo
  } = window.JARVISDesignSystem_547efc;
  const NAV = [{
    id: "command",
    icon: "layout-grid",
    label: "Command Center"
  }, {
    id: "aicore",
    icon: "cpu",
    label: "AI Core"
  }, {
    id: "agents",
    icon: "bot",
    label: "Agents"
  }, {
    id: "tasks",
    icon: "list-checks",
    label: "Tasks",
    count: 3
  }, {
    id: "calendar",
    icon: "calendar",
    label: "Calendar"
  }, {
    id: "memory",
    icon: "database",
    label: "Memory"
  }, {
    id: "conversations",
    icon: "message-square",
    label: "Conversations",
    count: 12
  }, {
    id: "knowledge",
    icon: "network",
    label: "Knowledge Base"
  }, {
    id: "tools",
    icon: "wrench",
    label: "Tools & Skills",
    count: 18
  }, {
    id: "workflows",
    icon: "workflow",
    label: "Workflows"
  }, {
    id: "monitor",
    icon: "gauge",
    label: "System Monitor"
  }];
  function useClock() {
    const [t, setT] = React.useState(new Date());
    React.useEffect(() => {
      const id = setInterval(() => setT(new Date()), 1000);
      return () => clearInterval(id);
    }, []);
    return t;
  }
  function Clock() {
    const t = useClock();
    const time = t.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
    return /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        lineHeight: 1.1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-medium) 11px var(--font-body)",
        color: "var(--jv-text-soft)"
      }
    }, "Monday, 15 June 2026"), /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-bold) 28px/1 var(--font-display)",
        color: "var(--jv-cyan-300)",
        textShadow: "var(--glow-cyan)",
        letterSpacing: "0.02em"
      }
    }, time.toLowerCase()));
  }
  function Rail({
    active,
    onNav
  }) {
    return /*#__PURE__*/React.createElement("aside", {
      style: {
        width: 260,
        flex: "0 0 260px",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(180deg, #0a1626, #070f1c)",
        borderRight: "1px solid var(--jv-border)",
        padding: "0 14px 14px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        height: 80,
        padding: "0 4px",
        borderBottom: "1px solid var(--jv-hairline)",
        marginBottom: 14
      }
    }, Logo ? /*#__PURE__*/React.createElement(Logo, {
      size: 44,
      wordmark: true
    }) : /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-bold) 20px/1 var(--font-display)",
        letterSpacing: "0.22em",
        color: "var(--jv-text)"
      }
    }, "JARVIS"), /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-medium) 9px/1 var(--font-hud)",
        letterSpacing: "0.30em",
        color: "var(--jv-text-muted)",
        marginTop: 5
      }
    }, "COMMAND CENTER"))), /*#__PURE__*/React.createElement("nav", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 3,
        overflowY: "auto",
        flex: 1,
        margin: "0 -4px",
        padding: "0 4px"
      }
    }, NAV.map(n => /*#__PURE__*/React.createElement(NavItem, {
      key: n.id,
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: n.icon,
        size: 18
      }),
      label: n.label,
      count: n.count,
      active: active === n.id,
      onClick: () => onNav(n.id)
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: "0 0 8px"
      }
    }), /*#__PURE__*/React.createElement("button", {
      style: {
        marginTop: 10,
        height: 38,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        borderRadius: "var(--r-sm)",
        border: "1px solid var(--jv-border)",
        background: "rgba(41,211,245,0.05)",
        color: "var(--jv-text-soft)",
        font: "var(--fw-semibold) 12px var(--font-hud)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "zap",
      size: 15,
      color: "var(--jv-cyan)"
    }), " Focus Mode"));
  }
  function TopBar() {
    return /*#__PURE__*/React.createElement("header", {
      style: {
        height: 64,
        flex: "0 0 64px",
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "0 22px",
        borderBottom: "1px solid var(--jv-border)",
        background: "linear-gradient(180deg, rgba(12,26,46,0.6), transparent)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 14px",
        borderRadius: "var(--r-sm)",
        border: "1px solid var(--jv-border)",
        clipPath: "var(--clip-chamfer)",
        background: "rgba(4,12,22,0.5)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--fw-semibold) 10px var(--font-hud)",
        letterSpacing: "0.14em",
        color: "var(--jv-text-muted)"
      }
    }, "SYSTEM STATUS"), /*#__PURE__*/React.createElement(Badge, {
      status: "optimal"
    }, "Optimal")), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: "flex",
        justifyContent: "center"
      }
    }, /*#__PURE__*/React.createElement(Clock, null)), /*#__PURE__*/React.createElement(Input, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "search",
        size: 16
      }),
      placeholder: "Search\u2026",
      wrapStyle: {
        width: 240,
        height: 36
      }
    }), /*#__PURE__*/React.createElement("select", {
      style: {
        height: 36,
        padding: "0 10px",
        borderRadius: "var(--r-sm)",
        background: "rgba(4,12,22,0.6)",
        border: "1px solid var(--jv-border)",
        color: "var(--jv-text-soft)",
        font: "var(--fw-medium) 12px var(--font-mono)"
      }
    }, /*#__PURE__*/React.createElement("option", null, "claude-opus-4-8"), /*#__PURE__*/React.createElement("option", null, "claude-sonnet-4-6")), ["layout-grid", "bell", "settings"].map(n => /*#__PURE__*/React.createElement("button", {
      key: n,
      style: {
        width: 36,
        height: 36,
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--r-sm)",
        border: "1px solid var(--jv-border)",
        background: "transparent",
        color: "var(--jv-text-muted)",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: n,
      size: 17
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 8px 5px 14px",
        borderRadius: "var(--r-pill)",
        border: "1px solid var(--jv-border-cyan)",
        background: "var(--grad-cyan-soft)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "right",
        lineHeight: 1.2
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-semibold) 12px var(--font-body)",
        color: "var(--jv-text)"
      }
    }, "Operator"), /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-medium) 9px var(--font-hud)",
        letterSpacing: "0.1em",
        color: "var(--jv-cyan-300)"
      }
    }, "Commander")), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 30,
        height: 30,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "var(--jv-surface-3)",
        border: "1px solid var(--jv-border-cyan)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "user",
      size: 16,
      color: "var(--jv-cyan)"
    }))));
  }
  function Dock() {
    return /*#__PURE__*/React.createElement("footer", {
      style: {
        height: 72,
        flex: "0 0 72px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 22px",
        borderTop: "1px solid var(--jv-border)",
        background: "linear-gradient(0deg, rgba(12,26,46,0.7), transparent)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 18
      }
    }, [["map-pin", "Location", "Bhimber, Paki…"], ["sun", "Weather", "28°C Overcast"], ["wifi", "Network", "Excellent"]].map(([ic, k, v]) => /*#__PURE__*/React.createElement("div", {
      key: k,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: ic,
      size: 16,
      color: "var(--jv-cyan)"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        lineHeight: 1.25
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-medium) 9px var(--font-hud)",
        letterSpacing: "0.08em",
        color: "var(--jv-text-muted)",
        textTransform: "uppercase"
      }
    }, k), /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-semibold) 12px var(--font-body)",
        color: "var(--jv-text-soft)"
      }
    }, v))))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: "flex",
        justifyContent: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 26px",
        borderRadius: "var(--r-pill)",
        border: "1px solid var(--jv-border-cyan)",
        background: "var(--grad-cyan-soft)",
        boxShadow: "var(--glow-cyan)"
      }
    }, /*#__PURE__*/React.createElement(Waveform, {
      height: 20,
      bars: 10,
      active: true,
      color: "var(--jv-cyan-300)"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-bold) 14px var(--font-hud)",
        letterSpacing: "0.18em",
        color: "var(--jv-cyan-300)"
      }
    }, "TALK TO JARVIS"), /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-medium) 10px var(--font-body)",
        color: "var(--jv-text-soft)"
      }
    }, "I am listening\u2026")), /*#__PURE__*/React.createElement(Waveform, {
      height: 20,
      bars: 10,
      active: true,
      color: "var(--jv-cyan-300)"
    }))), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "play",
        size: 14
      })
    }, "Executive Briefing"));
  }
  function AppShell({
    active,
    onNav,
    showDock = true,
    children
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--grad-app)",
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: "flex",
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement(Rail, {
      active: active,
      onNav: onNav
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement(TopBar, null), /*#__PURE__*/React.createElement("main", {
      style: {
        flex: 1,
        overflowY: "auto",
        padding: 18
      }
    }, children))), showDock && /*#__PURE__*/React.createElement(Dock, null));
  }
  Object.assign(window, {
    AppShell
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/CommandCenter.jsx
try { (() => {
// CommandCenter — the flagship dashboard view. Reconstructs the HUD grid:
// AI Core overview, orbital globe hero, intelligence feed, agents, timeline,
// quick commands, system monitor, memory insights, LLM status.
(function () {
  const {
    Panel,
    Badge,
    StatusRow,
    ProgressRing,
    VoiceOrb,
    Waveform,
    Button,
    Icon
  } = window.JARVISDesignSystem_547efc;

  // RadialVoiceViz — concentric rings + a circular waveform (no mic icon).
  function RadialVoiceViz({
    active = true,
    bars = 56,
    size = 210,
    color = "var(--jv-cyan)",
    showBars = true,
    onClick
  }) {
    const seeds = React.useMemo(() => Array.from({
      length: bars
    }, (_, i) => 0.32 + 0.68 * Math.abs(Math.sin(i * 2.3) * Math.cos(i * 0.7))), [bars]);
    const c = size / 2;
    const inner = size * 0.305;
    const maxLen = size * 0.15;
    return /*#__PURE__*/React.createElement("button", {
      onClick: onClick,
      "aria-label": "Toggle listening",
      style: {
        position: "relative",
        width: size,
        height: size,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: 0
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        inset: 0,
        borderRadius: "50%",
        border: `1px dashed ${color}`,
        opacity: 0.22,
        animation: active ? "jv-glow-breathe 2.6s ease-out infinite" : "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        inset: size * 0.13,
        borderRadius: "50%",
        border: `1px solid ${color}`,
        opacity: 0.16
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        inset: size * 0.30,
        borderRadius: "50%",
        background: `radial-gradient(circle at 50% 45%, color-mix(in srgb, ${color} 30%, transparent), transparent 72%)`,
        animation: active ? "jv-pulse 2.6s ease-out infinite" : "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        top: "50%",
        left: "50%",
        width: 16,
        height: 16,
        marginLeft: -8,
        marginTop: -8,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 18px ${color}`
      }
    }), showBars && /*#__PURE__*/React.createElement("svg", {
      viewBox: `0 0 ${size} ${size}`,
      style: {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        filter: `drop-shadow(0 0 4px color-mix(in srgb, ${color} 55%, transparent))`
      }
    }, seeds.map((s, i) => {
      const ang = i / bars * 360;
      const len = maxLen * (active ? s : 0.42);
      return /*#__PURE__*/React.createElement("g", {
        key: i,
        transform: `rotate(${ang} ${c} ${c})`
      }, /*#__PURE__*/React.createElement("rect", {
        x: c - 1.3,
        y: c - inner - len,
        width: 2.6,
        height: len,
        rx: 1.3,
        fill: color,
        style: {
          transformBox: "fill-box",
          transformOrigin: "center bottom",
          animation: active ? `jv-equalize ${0.7 + i % 6 * 0.16}s ease-out ${i * 0.03}s infinite` : "none"
        }
      }));
    })));
  }

  // VoiceCore — the centerpiece: speak with JARVIS. Circular waveform, listening
  // state and a rolling transcript exchange.
  function VoiceCore({
    tweaks = {}
  }) {
    const {
      viz = "radial",
      bars = 56,
      showTranscript = true,
      accentColor = "var(--jv-cyan)"
    } = tweaks;
    const EXCHANGES = [{
      you: "JARVIS, what's my system status?",
      jarvis: "All systems optimal, Commander. CPU at 15%, two agents running, memory at 3,380 vectors."
    }, {
      you: "Draft the v3.0.0 release notes.",
      jarvis: "On it. Pulling 14 merged PRs since the last tag — I'll have a draft in the Compose panel shortly."
    }, {
      you: "Anything overdue today?",
      jarvis: "Two tasks: \u201cPolish voice pipeline\u201d and the MSIX capability audit. Want me to reschedule them?"
    }];
    const [listening, setListening] = React.useState(true);
    const [i, setI] = React.useState(0);
    React.useEffect(() => {
      if (!listening) return;
      const id = setInterval(() => setI(n => (n + 1) % EXCHANGES.length), 5200);
      return () => clearInterval(id);
    }, [listening]);
    const ex = EXCHANGES[i];
    const toggle = () => setListening(v => !v);
    const bigSize = tweaks.vizSize || 300;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight: 480
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        width: 580,
        height: 580,
        borderRadius: "50%",
        background: "radial-gradient(circle at 50% 45%, color-mix(in srgb, " + accentColor + " 12%, transparent), transparent 62%)",
        pointerEvents: "none"
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative",
        textAlign: "center",
        marginBottom: 24
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-bold) 42px/1 var(--font-display)",
        letterSpacing: "0.34em",
        color: accentColor,
        textShadow: "var(--glow-cyan-lg)"
      }
    }, "JARVIS"), /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-medium) 11px/1 var(--font-hud)",
        letterSpacing: "0.44em",
        color: "var(--jv-cyan-100)",
        marginTop: 10
      }
    }, "AI CORE \xB7 v3.0.0")), viz === "linear" ? /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative",
        width: bigSize,
        height: bigSize,
        display: "grid",
        placeItems: "center",
        cursor: "pointer"
      },
      onClick: toggle
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        inset: 0,
        borderRadius: "50%",
        border: `1px dashed ${accentColor}`,
        opacity: 0.2,
        animation: listening ? "jv-glow-breathe 2.6s ease-out infinite" : "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        inset: bigSize * 0.14,
        borderRadius: "50%",
        border: `1px solid ${accentColor}`,
        opacity: 0.14
      }
    }), /*#__PURE__*/React.createElement(Waveform, {
      height: 92,
      bars: Math.round(bars / 2),
      active: listening,
      color: accentColor,
      style: {
        width: bigSize * 0.58
      }
    })) : /*#__PURE__*/React.createElement(RadialVoiceViz, {
      active: listening,
      bars: bars,
      size: bigSize,
      color: accentColor,
      showBars: viz !== "pulse",
      onClick: toggle
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 24,
        font: "var(--fw-semibold) 12px var(--font-hud)",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: listening ? accentColor : "var(--jv-text-muted)"
      }
    }, listening ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: accentColor,
        boxShadow: "0 0 8px " + accentColor,
        animation: "jv-pulse 2s ease-out infinite"
      }
    }), " I am listening\u2026") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
      name: "hand",
      size: 14
    }), " Tap to speak")), showTranscript && /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative",
        width: "100%",
        maxWidth: 460,
        marginTop: 22,
        display: "flex",
        flexDirection: "column",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        alignSelf: "flex-end",
        maxWidth: "82%",
        padding: "9px 13px",
        borderRadius: "12px 12px 3px 12px",
        background: "var(--grad-cyan-soft)",
        border: "1px solid var(--jv-border-cyan)",
        font: "var(--fw-medium) 12.5px/1.45 var(--font-body)",
        color: "var(--jv-text)"
      }
    }, ex.you), /*#__PURE__*/React.createElement("div", {
      style: {
        alignSelf: "flex-start",
        maxWidth: "88%",
        display: "flex",
        gap: 9
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: "0 0 26px",
        width: 26,
        height: 26,
        marginTop: 1,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "var(--jv-surface-3)",
        border: "1px solid var(--jv-border-cyan)",
        color: accentColor
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "sparkles",
      size: 13
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "9px 13px",
        borderRadius: "12px 12px 12px 3px",
        background: "var(--jv-surface-3)",
        border: "1px solid var(--jv-border-soft)",
        font: "var(--fw-regular) 12.5px/1.5 var(--font-body)",
        color: "var(--jv-text-soft)"
      }
    }, ex.jarvis))));
  }
  function ViewAll({
    children = "View All"
  }) {
    return /*#__PURE__*/React.createElement("a", {
      href: "#",
      style: {
        font: "var(--fw-medium) 12px var(--font-body)",
        color: "var(--jv-cyan-300)"
      }
    }, children, " \u203A");
  }
  function Feed() {
    const items = [["calendar", "info", "Design review with the product team", "Meeting", "INFO"], ["alert-triangle", "warn", "2 tasks are overdue — \"Polish voic…\"", "Overdue", "WARN"], ["git-pull-request", "info", "3 pull requests are awaiting your revi…", "Github", "TIP"], ["lightbulb", "info", "Your deep-work block is 2–4 PM. Noti…", "Focus", "TIP"], ["activity", "optimal", "CPU usage at 15%", "System load nominal", "LIVE"]];
    const tone = {
      INFO: "info",
      WARN: "warn",
      TIP: "info",
      LIVE: "optimal"
    };
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 8
      }
    }, items.map(([ic, t, title, sub, tag], i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "9px 10px",
        borderRadius: "var(--r-sm)",
        background: "var(--jv-surface-3)",
        border: "1px solid var(--jv-border-soft)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 26,
        height: 26,
        flex: "0 0 26px",
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--r-xs)",
        color: `var(--jv-${t === "optimal" ? "green" : t === "warn" ? "amber" : "cyan"})`,
        background: "rgba(41,211,245,0.08)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: ic,
      size: 14
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-semibold) 12px var(--font-body)",
        color: "var(--jv-text)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, title), /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-medium) 10px var(--font-hud)",
        letterSpacing: "0.06em",
        color: "var(--jv-text-muted)",
        textTransform: "uppercase",
        marginTop: 2
      }
    }, sub)), /*#__PURE__*/React.createElement(Badge, {
      status: tone[tag],
      dot: false
    }, tag))));
  }
  function StatusStrip() {
    const items = [["cpu", "AI Core", "Active", "optimal"], ["database", "Memory", "3,380", "info"], ["mic", "Voice", "Online", "optimal"], ["bot", "Agents", "2 Running", "standby"], ["boxes", "LLMs", "4 Connected", "optimal"], ["shield-check", "System", "Optimal", "optimal"]];
    const col = t => t === "optimal" ? "var(--jv-green)" : t === "standby" ? "var(--jv-violet)" : t === "warn" ? "var(--jv-amber)" : "var(--jv-cyan)";
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        padding: "9px 16px",
        borderRadius: "var(--r-md)",
        background: "rgba(10,22,38,0.5)",
        border: "1px solid var(--jv-border-soft)",
        flex: 1,
        minWidth: 0,
        overflowX: "auto"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--fw-semibold) 10px var(--font-hud)",
        letterSpacing: "0.16em",
        color: "var(--jv-cyan-300)",
        marginRight: 4,
        whiteSpace: "nowrap"
      }
    }, "SYSTEM STATUS"), items.map(([ic, n, s, t], i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 16px",
        borderLeft: "1px solid var(--jv-hairline)",
        marginLeft: 12,
        whiteSpace: "nowrap"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: ic,
      size: 15,
      color: col(t)
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--fw-semibold) 12px var(--font-body)",
        color: "var(--jv-text)"
      }
    }, n), /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 5,
        font: "var(--fw-medium) 11px var(--font-hud)",
        letterSpacing: "0.04em",
        color: col(t)
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 5,
        height: 5,
        borderRadius: "50%",
        background: col(t),
        boxShadow: `0 0 6px ${col(t)}`
      }
    }), s))));
  }
  function QuickBar() {
    const cmds = [["plus-circle", "New Task", "primary"], ["calendar", "Calendar", "secondary"], ["mic", "Voice Chat", "secondary"], ["play", "Workflow", "secondary"]];
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flex: "0 0 auto"
      }
    }, cmds.map(([ic, l, v], i) => /*#__PURE__*/React.createElement(Button, {
      key: i,
      size: "sm",
      variant: v,
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: ic,
        size: 14
      })
    }, l)));
  }
  function AgentsList() {
    const agents = [["code", "Coding Agent", "Writing code", "optimal"], ["search", "Research Agent", "Deep analysis", "optimal"], ["database", "Memory Agent", "Idle", "standby"], ["globe", "Browser Agent", "Idle", "standby"], ["list-checks", "Task Agent", "Idle", "standby"], ["shield-check", "System Agent", "Monitoring", "optimal"]];
    return /*#__PURE__*/React.createElement(Panel, {
      title: "Your Team",
      eyebrow: true,
      action: /*#__PURE__*/React.createElement(ViewAll, null),
      style: {
        height: "100%"
      },
      bodyStyle: {
        display: "flex",
        flexDirection: "column",
        gap: 8
      }
    }, agents.map(([ic, n, role, t], i) => {
      const c = t === "optimal" ? "var(--jv-green)" : "var(--jv-violet)";
      return /*#__PURE__*/React.createElement("div", {
        key: i,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "10px 11px",
          borderRadius: "var(--r-sm)",
          background: "var(--jv-surface-3)",
          border: "1px solid var(--jv-border-soft)"
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          width: 34,
          height: 34,
          flex: "0 0 34px",
          borderRadius: "var(--r-sm)",
          display: "grid",
          placeItems: "center",
          color: c,
          background: `color-mix(in srgb, ${c} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${c} 32%, transparent)`
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: ic,
        size: 16
      })), /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1,
          minWidth: 0
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          font: "var(--fw-semibold) 13px var(--font-body)",
          color: "var(--jv-text)"
        }
      }, n), /*#__PURE__*/React.createElement("div", {
        style: {
          font: "var(--fw-regular) 11px var(--font-body)",
          color: "var(--jv-text-muted)",
          marginTop: 1
        }
      }, role)), /*#__PURE__*/React.createElement("span", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 5,
          font: "var(--fw-medium) 10px var(--font-hud)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: c
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: c,
          boxShadow: `0 0 6px ${c}`
        }
      }), t === "optimal" ? "Active" : "Standby"));
    }));
  }
  function CommandCenter({
    tweaks = {}
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: "100%"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement(StatusStrip, null), /*#__PURE__*/React.createElement(QuickBar, null)), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: "grid",
        gridTemplateColumns: "300px 1fr 340px",
        gap: 16,
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement(AgentsList, null), /*#__PURE__*/React.createElement(VoiceCore, {
      tweaks: tweaks
    }), /*#__PURE__*/React.createElement(Panel, {
      title: "Live Intelligence Feed",
      eyebrow: true,
      action: /*#__PURE__*/React.createElement(Badge, {
        status: "live",
        solid: true
      }, "Live"),
      active: true,
      style: {
        height: "100%"
      }
    }, /*#__PURE__*/React.createElement(Feed, null), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        marginTop: 12
      }
    }, /*#__PURE__*/React.createElement(ViewAll, null, "View All Intelligence")))));
  }
  Object.assign(window, {
    CommandCenter
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/CommandCenter.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/SystemMonitor.jsx
try { (() => {
// SystemMonitor — telemetry view: gauges, slow turns and the live log tail.
(function () {
  const {
    Panel,
    Badge,
    ProgressRing,
    Button,
    Icon
  } = window.JARVISDesignSystem_547efc;
  const LOGS = [["07:32:01.482 pm", "INFO", "jarvis.agent.loop", "turn.completed conversation=c_8821 turns=1 duration_ms=2841"], ["07:31:59.140 pm", "INFO", "jarvis.tools.dispatch", "tool_completed name=web_search duration_ms=412 success=true"], ["07:31:52.003 pm", "INFO", "jarvis.llm.router", "llm.response provider=anthropic model=claude-opus-4-8 tokens_in=1840"], ["07:31:48.771 pm", "DEBUG", "jarvis.memory.vector", "query.embedded dim=768 matches=12 latency_ms=37"], ["07:31:40.218 pm", "WARN", "jarvis.tools.whatsapp", "rate_limit approaching window=60s used=54"]];
  const LVL = {
    INFO: "var(--jv-green)",
    DEBUG: "var(--jv-cyan-300)",
    WARN: "var(--jv-amber)",
    ERROR: "var(--jv-red)"
  };
  function SlowTurn({
    q,
    meta,
    t
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 0",
        borderBottom: "1px solid var(--jv-hairline)"
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-semibold) 13px var(--font-body)",
        color: "var(--jv-text)"
      }
    }, q), /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-regular) 11px var(--font-mono)",
        color: "var(--jv-text-muted)",
        marginTop: 3
      }
    }, meta)), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--fw-bold) 14px var(--font-display)",
        color: "var(--jv-amber)"
      }
    }, t));
  }
  function SystemMonitor() {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1.4fr",
        gap: 16,
        alignItems: "start"
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      title: "System Monitor",
      eyebrow: true,
      brackets: true
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-around"
      }
    }, /*#__PURE__*/React.createElement(ProgressRing, {
      value: 15,
      label: "CPU"
    }), /*#__PURE__*/React.createElement(ProgressRing, {
      value: 54,
      label: "RAM",
      tone: "warn"
    }), /*#__PURE__*/React.createElement(ProgressRing, {
      value: 40,
      label: "Disk"
    }))), /*#__PURE__*/React.createElement(Panel, {
      title: "Slow Turns (last 24 h)",
      eyebrow: true
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: "var(--r-sm)",
        background: "color-mix(in srgb, var(--jv-amber) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--jv-amber) 30%, transparent)",
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "alert-triangle",
      size: 16,
      color: "var(--jv-amber)"
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--fw-semibold) 12px var(--font-body)",
        color: "var(--jv-text)"
      }
    }, "Slow turns"), /*#__PURE__*/React.createElement("div", {
      style: {
        font: "11px var(--font-mono)",
        color: "var(--jv-text-muted)"
      }
    }, "floor: p95 7.20s + 2\u03C3 700ms = 8.60s"))), /*#__PURE__*/React.createElement(SlowTurn, {
      q: "Summarise my unread email and draft replies to the urgent ones",
      meta: "claude-opus-4-8 \xB7 6 tools \xB7 4 llm \xB7 req_d41c",
      t: "14.82s"
    }), /*#__PURE__*/React.createElement(SlowTurn, {
      q: "Cross-reference my Jira board with this week's calendar and flag conflicts",
      meta: "claude-opus-4-8 \xB7 5 tools \xB7 3 llm \xB7 1 err \xB7 req_8810",
      t: "11.23s"
    }), /*#__PURE__*/React.createElement(SlowTurn, {
      q: "Research pgvector vs Qdrant and recommend one for our scale",
      meta: "claude-sonnet-4-6 \xB7 4 tools \xB7 5 llm \xB7 req_44a0",
      t: "9.87s"
    }))), /*#__PURE__*/React.createElement(Panel, {
      title: "Recent Logs",
      eyebrow: true,
      action: /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Button, {
        size: "sm",
        variant: "secondary",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "play",
          size: 13
        })
      }, "Live tail"), /*#__PURE__*/React.createElement(Button, {
        size: "sm",
        variant: "ghost",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "refresh-cw",
          size: 13
        })
      }, "Refresh"))
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 12,
        flexWrap: "wrap"
      }
    }, ["Turn", "Tool", "LLM", "HTTP", "WS", "Boot", "MCP", "Errors"].map(f => /*#__PURE__*/React.createElement("span", {
      key: f,
      style: {
        padding: "4px 11px",
        borderRadius: "var(--r-pill)",
        border: "1px solid var(--jv-border)",
        font: "var(--fw-medium) 11px var(--font-mono)",
        color: "var(--jv-text-muted)"
      }
    }, f))), /*#__PURE__*/React.createElement("div", {
      style: {
        borderRadius: "var(--r-sm)",
        background: "var(--jv-void)",
        border: "1px solid var(--jv-border-soft)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 7
      }
    }, LOGS.map(([ts, lvl, mod, msg], i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        font: "12px/1.5 var(--font-mono)",
        display: "flex",
        gap: 8,
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--jv-text-muted)"
      }
    }, ts), /*#__PURE__*/React.createElement("span", {
      style: {
        color: LVL[lvl],
        fontWeight: 600
      }
    }, lvl), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--jv-cyan-300)"
      }
    }, mod), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--jv-text-soft)"
      }
    }, msg))))));
  }
  Object.assign(window, {
    SystemMonitor
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/SystemMonitor.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/TasksKanban.jsx
try { (() => {
// TasksKanban — the Tasks view: four status columns of task cards + mission stats.
(function () {
  const {
    Panel,
    Tag,
    StatTile,
    Button,
    Input,
    Icon
  } = window.JARVISDesignSystem_547efc;
  const COLS = [{
    id: "todo",
    label: "To Do",
    icon: "circle-dashed",
    tone: "info",
    count: 4,
    cards: [["Design holographic onboarding tour", "high", ["ux", "onboarding", "hud"], "Unblocks 1"], ["Write voice pipeline integration tests", "medium", ["voice", "testing"], null], ["Audit MSIX capability manifest for mic + camera", "critical", ["msix", "security", "store"], "Unblocks 2"], ["Refactor command-center weather provider failover", "low", ["command-center", "weather"], null]]
  }, {
    id: "progress",
    label: "In Progress",
    icon: "loader",
    tone: "warn",
    count: 3,
    cards: [["Build unified /command_center/today endpoint", "critical", ["command-center", "api", "flagship"], "Unblocks 3"], ["Wire Kokoro + edge-tts cascading TTS fallback", "high", ["voice", "tts"], "Unblocks 1"], ["Reduce Electron cold-boot below 7 seconds", "medium", ["performance", "electron", "boot"], null]]
  }, {
    id: "blocked",
    label: "Blocked",
    icon: "lock",
    tone: "critical",
    count: 2,
    cards: [["Enable email verification in auth-api", "high", ["auth", "email", "verification"], "Waiting on 2"], ["Ship Store trial + license enforcement gate", "critical", ["store", "licensing", "billing"], "Waiting on 1"]]
  }, {
    id: "done",
    label: "Done",
    icon: "check-circle",
    tone: "optimal",
    count: 5,
    cards: [["Fix mic permission handler in Electron + MSIX", "critical", ["voice", "permissions", "electron"], null], ["Split system.py god object into 8 modules", "high", ["refactor", "architecture"], null], ["Reorganize core/ into 7 domain subpackages", "medium", ["refactor", "core"], null], ["Add admin error-reporting dashboard pipeline", "high", ["admin", "observability"], null], ["Migrate task schema to Alembic revision", "low", ["database", "alembic", "tasks"], null]]
  }];
  function Card({
    title,
    priority,
    tags,
    link
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 12,
        borderRadius: "var(--r-sm)",
        background: "var(--jv-surface-3)",
        border: "1px solid var(--jv-border-soft)",
        display: "flex",
        flexDirection: "column",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--fw-semibold) 12.5px/1.35 var(--font-body)",
        color: "var(--jv-text)"
      }
    }, title), /*#__PURE__*/React.createElement(Tag, {
      priority: priority
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 5
      }
    }, tags.map(t => /*#__PURE__*/React.createElement(Tag, {
      key: t
    }, t))), link && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 5,
        font: "var(--fw-medium) 11px var(--font-body)",
        color: link.startsWith("Waiting") ? "var(--jv-red)" : "var(--jv-cyan-300)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: link.startsWith("Waiting") ? "lock" : "git-branch",
      size: 12
    }), link));
  }
  function TasksKanban() {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 300px",
        gap: 16,
        alignItems: "start"
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      title: "Tasks Kanban",
      action: /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Button, {
        size: "sm",
        variant: "secondary",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "plus",
          size: 14
        })
      }, "New Task"))
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 14,
        maxWidth: 320
      }
    }, /*#__PURE__*/React.createElement(Input, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "filter",
        size: 15
      }),
      placeholder: "Filter tasks\u2026"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12
      }
    }, COLS.map(c => /*#__PURE__*/React.createElement("div", {
      key: c.id
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
        paddingBottom: 8,
        borderBottom: `1px solid color-mix(in srgb, var(--jv-${c.tone === "info" ? "cyan" : c.tone === "warn" ? "amber" : c.tone === "critical" ? "red" : "green"}) 30%, transparent)`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        font: "var(--fw-semibold) 11px var(--font-hud)",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: `var(--jv-${c.tone === "info" ? "cyan" : c.tone === "warn" ? "amber" : c.tone === "critical" ? "red" : "green"})`
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: c.icon,
      size: 14
    }), c.label), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--fw-bold) 11px var(--font-mono)",
        color: "var(--jv-text-muted)"
      }
    }, c.count)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 10
      }
    }, c.cards.map((cd, i) => /*#__PURE__*/React.createElement(Card, {
      key: i,
      title: cd[0],
      priority: cd[1],
      tags: cd[2],
      link: cd[3]
    }))))))), /*#__PURE__*/React.createElement(Panel, {
      title: "Mission Stats",
      eyebrow: true
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(StatTile, {
      value: 4,
      label: "Ready",
      tone: "info"
    }), /*#__PURE__*/React.createElement(StatTile, {
      value: 3,
      label: "In Progress",
      tone: "warn"
    }), /*#__PURE__*/React.createElement(StatTile, {
      value: 2,
      label: "Blocked",
      tone: "critical"
    }), /*#__PURE__*/React.createElement(StatTile, {
      value: 5,
      label: "Done",
      tone: "optimal"
    }))));
  }
  Object.assign(window, {
    TasksKanban
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/TasksKanban.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/tweaks-panel.jsx
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)

/* BEGIN USAGE */
// tweaks-panel.jsx
// Reusable Tweaks shell + form-control helpers.
// Exports (to window): useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider,
//   TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton.
//
// Owns the host protocol (listens for __activate_edit_mode / __deactivate_edit_mode,
// posts __edit_mode_available / __edit_mode_set_keys / __edit_mode_dismissed) so
// individual prototypes don't re-roll it. Ships a consistent set of controls so you
// don't hand-draw <input type="range">, segmented radios, steppers, etc.
//
// Usage (in an HTML file that loads React + Babel):
//
//   const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
//     "primaryColor": "#D97757",
//     "palette": ["#D97757", "#29261b", "#f6f4ef"],
//     "fontSize": 16,
//     "density": "regular",
//     "dark": false
//   }/*EDITMODE-END*/;
//
//   function App() {
//     const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
//     return (
//       <div style={{ fontSize: t.fontSize, color: t.primaryColor }}>
//         Hello
//         <TweaksPanel>
//           <TweakSection label="Typography" />
//           <TweakSlider label="Font size" value={t.fontSize} min={10} max={32} unit="px"
//                        onChange={(v) => setTweak('fontSize', v)} />
//           <TweakRadio  label="Density" value={t.density}
//                        options={['compact', 'regular', 'comfy']}
//                        onChange={(v) => setTweak('density', v)} />
//           <TweakSection label="Theme" />
//           <TweakColor  label="Primary" value={t.primaryColor}
//                        options={['#D97757', '#2A6FDB', '#1F8A5B', '#7A5AE0']}
//                        onChange={(v) => setTweak('primaryColor', v)} />
//           <TweakColor  label="Palette" value={t.palette}
//                        options={[['#D97757', '#29261b', '#f6f4ef'],
//                                  ['#475569', '#0f172a', '#f1f5f9']]}
//                        onChange={(v) => setTweak('palette', v)} />
//           <TweakToggle label="Dark mode" value={t.dark}
//                        onChange={(v) => setTweak('dark', v)} />
//         </TweaksPanel>
//       </div>
//     );
//   }
//
// TweakRadio is the segmented control for 2–3 short options (auto-falls-back to
// TweakSelect past ~16/~10 chars per label); reach for TweakSelect directly when
// options are many or long. For color tweaks always curate 3-4 options rather than
// a free picker; an option can also be a whole 2–5 color palette (the stored value
// is the array). The Tweak* controls are a floor, not a ceiling — build custom
// controls inside the panel if a tweak calls for UI they don't cover.
/* END USAGE */
// ─────────────────────────────────────────────────────────────────────────────

const __TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    transform:scale(var(--dc-inv-zoom,1));transform-origin:bottom right;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:default;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}

  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}

  .twk-field{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}

  .twk-slider{appearance:none;-webkit-appearance:none;width:100%;height:4px;margin:6px 0;
    border-radius:999px;background:rgba(0,0,0,.12);outline:none}
  .twk-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
    width:14px;height:14px;border-radius:50%;background:#fff;
    border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}
  .twk-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
    background:#fff;border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}

  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:default;padding:4px 6px;line-height:1.2;
    overflow-wrap:anywhere}

  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:default;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}

  .twk-num{display:flex;align-items:center;box-sizing:border-box;min-width:0;height:26px;padding:0 0 0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;background:rgba(255,255,255,.6)}
  .twk-num-lbl{font-weight:500;color:rgba(41,38,27,.6);cursor:ew-resize;
    user-select:none;padding-right:8px}
  .twk-num input{flex:1;min-width:0;height:100%;border:0;background:transparent;
    font:inherit;font-variant-numeric:tabular-nums;text-align:right;padding:0 8px 0 0;
    outline:none;color:inherit;-moz-appearance:textfield}
  .twk-num input::-webkit-inner-spin-button,.twk-num input::-webkit-outer-spin-button{
    -webkit-appearance:none;margin:0}
  .twk-num-unit{padding-right:8px;color:rgba(41,38,27,.45)}

  .twk-btn{appearance:none;height:26px;padding:0 12px;border:0;border-radius:7px;
    background:rgba(0,0,0,.78);color:#fff;font:inherit;font-weight:500;cursor:default}
  .twk-btn:hover{background:rgba(0,0,0,.88)}
  .twk-btn.secondary{background:rgba(0,0,0,.06);color:inherit}
  .twk-btn.secondary:hover{background:rgba(0,0,0,.1)}

  .twk-swatch{appearance:none;-webkit-appearance:none;width:56px;height:22px;
    border:.5px solid rgba(0,0,0,.1);border-radius:6px;padding:0;cursor:default;
    background:transparent;flex-shrink:0}
  .twk-swatch::-webkit-color-swatch-wrapper{padding:0}
  .twk-swatch::-webkit-color-swatch{border:0;border-radius:5.5px}
  .twk-swatch::-moz-color-swatch{border:0;border-radius:5.5px}

  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:default;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip>span{position:absolute;top:0;bottom:0;right:0;width:34%;
    display:flex;flex-direction:column;box-shadow:-1px 0 0 rgba(0,0,0,.1)}
  .twk-chip>span>i{flex:1;box-shadow:0 -1px 0 rgba(0,0,0,.1)}
  .twk-chip>span>i:first-child{box-shadow:none}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
`;

// ── useTweaks ───────────────────────────────────────────────────────────────
// Single source of truth for tweak values. setTweak persists via the host
// (__edit_mode_set_keys → host rewrites the EDITMODE block on disk).
function useTweaks(defaults) {
  const [values, setValues] = React.useState(defaults);
  // Accepts either setTweak('key', value) or setTweak({ key: value, ... }) so a
  // useState-style call doesn't write a "[object Object]" key into the persisted
  // JSON block.
  const setTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null ? keyOrEdits : {
      [keyOrEdits]: val
    };
    setValues(prev => ({
      ...prev,
      ...edits
    }));
    window.parent.postMessage({
      type: '__edit_mode_set_keys',
      edits
    }, '*');
    // Same-window signal so in-page listeners (deck-stage rail thumbnails)
    // can react — the parent message only reaches the host, not peers.
    window.dispatchEvent(new CustomEvent('tweakchange', {
      detail: edits
    }));
  }, []);
  return [values, setTweak];
}

// ── TweaksPanel ─────────────────────────────────────────────────────────────
// Floating shell. Registers the protocol listener BEFORE announcing
// availability — if the announce ran first, the host's activate could land
// before our handler exists and the toolbar toggle would silently no-op.
// The close button posts __edit_mode_dismissed so the host's toolbar toggle
// flips off in lockstep; the host echoes __deactivate_edit_mode back which
// is what actually hides the panel.
function TweaksPanel({
  title = 'Tweaks',
  children
}) {
  const [open, setOpen] = React.useState(false);
  const dragRef = React.useRef(null);
  const offsetRef = React.useRef({
    x: 16,
    y: 16
  });
  const PAD = 16;
  const clampToViewport = React.useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth,
      h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y))
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  }, []);
  React.useEffect(() => {
    if (!open) return;
    clampToViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampToViewport);
      return () => window.removeEventListener('resize', clampToViewport);
    }
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clampToViewport]);
  React.useEffect(() => {
    const onMsg = e => {
      const t = e?.data?.type;
      if (t === '__activate_edit_mode') setOpen(true);else if (t === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({
      type: '__edit_mode_available'
    }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const dismiss = () => {
    setOpen(false);
    window.parent.postMessage({
      type: '__edit_mode_dismissed'
    }, '*');
  };
  const onDragStart = e => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX,
      sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = ev => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy)
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  if (!open) return null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("style", null, __TWEAKS_STYLE), /*#__PURE__*/React.createElement("div", {
    ref: dragRef,
    className: "twk-panel",
    "data-omelette-chrome": "",
    style: {
      right: offsetRef.current.x,
      bottom: offsetRef.current.y
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-hd",
    onMouseDown: onDragStart
  }, /*#__PURE__*/React.createElement("b", null, title), /*#__PURE__*/React.createElement("button", {
    className: "twk-x",
    "aria-label": "Close tweaks",
    onMouseDown: e => e.stopPropagation(),
    onClick: dismiss
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    className: "twk-body"
  }, children)));
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function TweakSection({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "twk-sect"
  }, label), children);
}
function TweakRow({
  label,
  value,
  children,
  inline = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: inline ? 'twk-row twk-row-h' : 'twk-row'
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-lbl"
  }, /*#__PURE__*/React.createElement("span", null, label), value != null && /*#__PURE__*/React.createElement("span", {
    className: "twk-val"
  }, value)), children);
}

// ── Controls ────────────────────────────────────────────────────────────────

function TweakSlider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label,
    value: `${value}${unit}`
  }, /*#__PURE__*/React.createElement("input", {
    type: "range",
    className: "twk-slider",
    min: min,
    max: max,
    step: step,
    value: value,
    onChange: e => onChange(Number(e.target.value))
  }));
}
function TweakToggle({
  label,
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "twk-row twk-row-h"
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-lbl"
  }, /*#__PURE__*/React.createElement("span", null, label)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "twk-toggle",
    "data-on": value ? '1' : '0',
    role: "switch",
    "aria-checked": !!value,
    onClick: () => onChange(!value)
  }, /*#__PURE__*/React.createElement("i", null)));
}
function TweakRadio({
  label,
  value,
  options,
  onChange
}) {
  const trackRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);
  // The active value is read by pointer-move handlers attached for the lifetime
  // of a drag — ref it so a stale closure doesn't fire onChange for every move.
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // Segments wrap mid-word once per-segment width runs out. The track is
  // ~248px (280 panel − 28 body pad − 4 seg pad), each button loses 12px
  // to its own padding, and 11.5px system-ui averages ~6.3px/char — so 2
  // options fit ~16 chars each, 3 fit ~10. Past that (or >3 options), fall
  // back to a dropdown rather than wrap.
  const labelLen = o => String(typeof o === 'object' ? o.label : o).length;
  const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0);
  const fitsAsSegments = maxLen <= ({
    2: 16,
    3: 10
  }[options.length] ?? 0);
  if (!fitsAsSegments) {
    // <select> emits strings — map back to the original option value so the
    // fallback stays type-preserving (numbers, booleans) like the segment path.
    const resolve = s => {
      const m = options.find(o => String(typeof o === 'object' ? o.value : o) === s);
      return m === undefined ? s : typeof m === 'object' ? m.value : m;
    };
    return /*#__PURE__*/React.createElement(TweakSelect, {
      label: label,
      value: value,
      options: options,
      onChange: s => onChange(resolve(s))
    });
  }
  const opts = options.map(o => typeof o === 'object' ? o : {
    value: o,
    label: o
  });
  const idx = Math.max(0, opts.findIndex(o => o.value === value));
  const n = opts.length;
  const segAt = clientX => {
    const r = trackRef.current.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor((clientX - r.left - 2) / inner * n);
    return opts[Math.max(0, Math.min(n - 1, i))].value;
  };
  const onPointerDown = e => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = ev => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("div", {
    ref: trackRef,
    role: "radiogroup",
    onPointerDown: onPointerDown,
    className: dragging ? 'twk-seg dragging' : 'twk-seg'
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-seg-thumb",
    style: {
      left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
      width: `calc((100% - 4px) / ${n})`
    }
  }), opts.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.value,
    type: "button",
    role: "radio",
    "aria-checked": o.value === value
  }, o.label))));
}
function TweakSelect({
  label,
  value,
  options,
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("select", {
    className: "twk-field",
    value: value,
    onChange: e => onChange(e.target.value)
  }, options.map(o => {
    const v = typeof o === 'object' ? o.value : o;
    const l = typeof o === 'object' ? o.label : o;
    return /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v
    }, l);
  })));
}
function TweakText({
  label,
  value,
  placeholder,
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("input", {
    className: "twk-field",
    type: "text",
    value: value,
    placeholder: placeholder,
    onChange: e => onChange(e.target.value)
  }));
}
function TweakNumber({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange
}) {
  const clamp = n => {
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };
  const startRef = React.useRef({
    x: 0,
    val: 0
  });
  const onScrubStart = e => {
    e.preventDefault();
    startRef.current = {
      x: e.clientX,
      val: value
    };
    const decimals = (String(step).split('.')[1] || '').length;
    const move = ev => {
      const dx = ev.clientX - startRef.current.x;
      const raw = startRef.current.val + dx * step;
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(Number(snapped.toFixed(decimals))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "twk-num"
  }, /*#__PURE__*/React.createElement("span", {
    className: "twk-num-lbl",
    onPointerDown: onScrubStart
  }, label), /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: value,
    min: min,
    max: max,
    step: step,
    onChange: e => onChange(clamp(Number(e.target.value)))
  }), unit && /*#__PURE__*/React.createElement("span", {
    className: "twk-num-unit"
  }, unit));
}

// Relative-luminance contrast pick — checkmarks drawn over a swatch need to
// read on both #111 and #fafafa without per-option configuration. Hex input
// only (#rgb / #rrggbb); named or rgb()/hsl() colors fall through to "light".
function __twkIsLight(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, c => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = n >> 16 & 255,
    g = n >> 8 & 255,
    b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}
const __TwkCheck = ({
  light
}) => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 14 14",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "M3 7.2 5.8 10 11 4.2",
  fill: "none",
  strokeWidth: "2.2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  stroke: light ? 'rgba(0,0,0,.78)' : '#fff'
}));

// TweakColor — curated color/palette picker. Each option is either a single
// hex string or an array of 1-5 hex strings; the card adapts — a lone color
// renders solid, a palette renders colors[0] as the hero (left ~2/3) with the
// rest stacked in a sharp column on the right. onChange emits the
// option in the shape it was passed (string stays string, array stays array).
// Without options it falls back to the native color input for back-compat.
function TweakColor({
  label,
  value,
  options,
  onChange
}) {
  if (!options || !options.length) {
    return /*#__PURE__*/React.createElement("div", {
      className: "twk-row twk-row-h"
    }, /*#__PURE__*/React.createElement("div", {
      className: "twk-lbl"
    }, /*#__PURE__*/React.createElement("span", null, label)), /*#__PURE__*/React.createElement("input", {
      type: "color",
      className: "twk-swatch",
      value: value,
      onChange: e => onChange(e.target.value)
    }));
  }
  // Native <input type=color> emits lowercase hex per the HTML spec, so
  // compare case-insensitively. String() guards JSON.stringify(undefined),
  // which returns the primitive undefined (no .toLowerCase).
  const key = o => String(JSON.stringify(o)).toLowerCase();
  const cur = key(value);
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-chips",
    role: "radiogroup"
  }, options.map((o, i) => {
    const colors = Array.isArray(o) ? o : [o];
    const [hero, ...rest] = colors;
    const sup = rest.slice(0, 4);
    const on = key(o) === cur;
    return /*#__PURE__*/React.createElement("button", {
      key: i,
      type: "button",
      className: "twk-chip",
      role: "radio",
      "aria-checked": on,
      "data-on": on ? '1' : '0',
      "aria-label": colors.join(', '),
      title: colors.join(' · '),
      style: {
        background: hero
      },
      onClick: () => onChange(o)
    }, sup.length > 0 && /*#__PURE__*/React.createElement("span", null, sup.map((c, j) => /*#__PURE__*/React.createElement("i", {
      key: j,
      style: {
        background: c
      }
    }))), on && /*#__PURE__*/React.createElement(__TwkCheck, {
      light: __twkIsLight(hero)
    }));
  })));
}
function TweakButton({
  label,
  onClick,
  secondary = false
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: secondary ? 'twk-btn secondary' : 'twk-btn',
    onClick: onClick
  }, label);
}
Object.assign(window, {
  useTweaks,
  TweaksPanel,
  TweakSection,
  TweakRow,
  TweakSlider,
  TweakToggle,
  TweakRadio,
  TweakSelect,
  TweakText,
  TweakNumber,
  TweakColor,
  TweakButton
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/tweaks-panel.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.NavItem = __ds_scope.NavItem;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.StatTile = __ds_scope.StatTile;

__ds_ns.StatusRow = __ds_scope.StatusRow;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.ProgressRing = __ds_scope.ProgressRing;

__ds_ns.VoiceOrb = __ds_scope.VoiceOrb;

__ds_ns.Waveform = __ds_scope.Waveform;

})();
