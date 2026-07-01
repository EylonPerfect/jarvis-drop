# J.A.R.V.I.S. Design System

A design system for **J.A.R.V.I.S.** — *"Just A Rather Very Intelligent System"* — a
voice-activated, Iron-Man-style **AI operating system** for the desktop. JARVIS is a
local-first AI assistant (Electron app, Windows) that presents a sci-fi **HUD command
center**: a left nav rail, glowing data panels, an orbital "AI Core" globe, live system
gauges, a multi-agent runtime, a memory/vector store, and an always-listening voice orb
("TALK TO JARVIS").

> **Product:** J.A.R.V.I.S. v3.x — desktop AI assistant / agent runtime.
> **Tagline:** *Just A Rather Very Intelligent System.*
> **Maker:** Independently designed & built by a solo developer (Adrees Umer).

## Sources

This system was reconstructed from **9 product screenshots** supplied by the user
(`uploads/Screenshot 2026-07-01 at 2.21.45–2.22.16.png`), covering: Command Center
dashboard, AI Core / provider setup, Agents (multi-agent executions), Tasks Kanban,
Calendar/Reminders, Memory & Personal Intelligence, Conversations, System Monitor/Logs,
and the desktop About modal. No codebase, Figma file, or font binaries were provided.

> **No source code or Figma was available** — values (colors, radii, type) are matched by
> eye from the screenshots. If you have the real source, share it and these can be made
> exact. Fonts are **substitutions** (see Visual Foundations → Type).

---

## Content fundamentals

**Voice & tone.** Confident, calm, technical-but-human. JARVIS speaks like a senior
engineer's assistant: direct, concise, never chatty. Copy favors **operator language** —
"Command Center", "Mission Timeline", "Active Agents", "Quick Commands", "Execute",
"Operator / Commander". The product addresses the user as the **Commander/Operator** and
refers to itself in the first person ("How can I assist you?", "I am listening…").

- **Casing.** Section/panel labels are **UPPERCASE, widely tracked** ("AI CORE OVERVIEW",
  "VOICE STATUS", "QUICK COMMANDS"). Card titles and body use **sentence case**
  ("Build unified /command_center/today endpoint"). Status words are uppercase pills
  ("OPTIMAL", "LIVE", "CRITICAL", "HIGH").
- **Person.** JARVIS = "I" ("How can I assist you?", "I am listening…"). The user is "you"
  / "Operator" / "Commander".
- **Numbers & precision.** Loves concrete telemetry: "3,380 memories across 42
  conversations", "p95 7.20s + 2σ 700ms = 8.60s", "tokens_in=1840", "$0.7421". Precision is
  part of the brand — show real-looking metrics, never round-vague.
- **Microcopy.** Action-first and short: "Tap to Speak", "Refresh models", "Save provider
  keys", "View All Intelligence ›", "Run Workflow". Chevrons (`›`) trail "view more" links.
- **Modes.** The assistant exposes modes as verbs: **Compose · Research · Execute · Debug ·
  Brainstorm**, each with a one-line gloss ("Write and create", "Deep analysis").
- **Emoji.** **None.** The brand uses line icons (Lucide-style), never emoji. Avoid them.
- **Vibe.** Mission-control / flight-deck. Everything reads as a live system status. Empty
  states are encouraging and actionable ("Capture your first task to start the…").

**Examples (verbatim from product):**
- "Connect provider keys, choose the model Jarvis uses in chat, and keep expert routing
  controls available without making setup feel technical."
- "Every tool call with retry / fallback / verification status." (Live Action Ledger)
- "Just A Rather Very Intelligent System."

---

## Visual foundations

**Overall.** A dark **sci-fi HUD**: deep-navy "void" canvas, electric-cyan signal color,
glowing edges, chamfered/bracketed panels, and a constant sense of live telemetry. Think
flight-deck / arc-reactor, not consumer SaaS.

**Color.**
- **Canvas** is a cool near-black navy with a subtle radial top-glow
  (`--grad-app`): void `#050a12` → bg `#070e1a`. Never pure black, always blue-shifted.
- **Cyan `#29d3f5`** is *the* brand signal — used for the wordmark, clock, active nav,
  primary buttons, focus rings, links, gauges and glows. Use it intentionally; it always
  reads as "live / active / JARVIS".
- **Status spectrum:** green `#34d399` (optimal/active/connected), amber `#fbbf24`
  (warn/medium/standby), red `#fb5b6e` (overdue/critical/error/LIVE), violet `#a78bfa`
  (agents/standby/system), magenta `#ec4899` (brainstorm + CRITICAL tag), blue `#3b82f6`
  (info/focus).
- **Priority tags:** CRITICAL = magenta, HIGH = amber, MEDIUM = cyan, LOW = muted.
- **Text** is cool-white `#e9f4fb` → slate `#51708c`. No warm grays.

**Type (SUBSTITUTED — real fonts not provided).**
- **Orbitron** → brand wordmark "JARVIS", the live clock, big HUD numerals. Wide, geometric,
  techy; the wordmark is tracked `.28em`.
- **Rajdhani** → tracked uppercase panel eyebrows & nav ("AI CORE OVERVIEW", "VOICE STATUS").
  Angular, narrow, HUD-feel.
- **Inter** → body copy, card titles, descriptions, tables. (Faithful match to the app's UI
  sans; replace if the real font differs.)
- **JetBrains Mono** → logs, terminal output, IDs, keys, metrics.
- Scale is **small and dense** (base 13px; labels 10–11px) befitting a control surface.

**Backgrounds.** Flat navy gradients + a faint **dotted grid** and **orbital sphere** motif
in the AI Core hero (`assets/globe-motif.png`). No photography. Decorative glows, scanlines,
and constellation/point-cloud graphics (Memory Map). Subtle, never noisy.

**Panels & cards.** The workhorse is a **gradient-navy panel** (`--grad-panel`, 160°) with a
1px cool border, inner edge-light (`inset` highlight) and a soft drop shadow. Variants:
**corner brackets** (4 L-shaped cyan ticks), **chamfered corners** (`clip-path`, cut
top-right/bottom-left), and an **active** state (cyan edge + glow). Radii are **small**
(panels 10px, controls 6px, chips 3px); pills are fully round. Cards do **not** use heavy
rounding or colored left-borders.

**Glows & shadows.** The signature is the **colored glow** (`box-shadow` halo in the element's
status color). Cyan glow on active/primary; status-colored glows on dots, gauges, tiles.
Drop shadows are deep and cool (`rgba(0,0,0,.45)`). Inner edge-lights give panels a "screen"
quality.

**Borders.** Thin (1px), cool, low-alpha by default (`rgba(60,122,158,.28)`); brighten to
cyan (`rgba(41,211,245,.45)`) on active/focus. Hairlines separate list rows.

**Transparency & blur.** Glassy: panels sit over the void with subtle inner glow; modals and
popovers use **backdrop blur** (`--blur-modal`). Tinted fills use `color-mix` of the status
color at ~12–16% alpha.

**Motion.** Restrained and purposeful. **Pulsing** status dots and LIVE badges; **breathing**
glow on the voice orb; **equalizer** waveforms for voice activity; gentle **fades/slides** on
enter (`--ease-hud`, `cubic-bezier(.16,1,.3,1)`). Gauges animate their arc. No bounce, no
playful spring. Respect `prefers-reduced-motion`.

**States.**
- *Hover:* brighten (`filter: brightness(1.12)`) or a faint cyan tint wash; never a hard
  color swap.
- *Press:* slight `translateY(1px) scale(.99)`.
- *Focus:* cyan ring (`0 0 0 3px rgba(41,211,245,.10)`) + brighter border.
- *Active/selected:* cyan fill/outline + left indicator bar + inner glow.
- *Disabled:* `opacity .45`.

**Layout.** Fixed **260px left nav rail** (logo, nav, Voice Status, Focus Mode), a **64px top
bar** (status pill, centered live clock, search + model picker + icons + Operator chip), a
dense **multi-panel grid** body, and a fixed bottom **"TALK TO JARVIS" dock** (72px) centered
with flanking waveforms. Panel gaps 16px.

---

## Iconography

- **System:** **Lucide** (open-source, MIT) line icons — 1.75px stroke, round caps, 24px
  grid. This is the closest match to the app's clean monoline icons and is used throughout
  the kit. *(Substitution note: the app's exact icon set wasn't provided; Lucide matches the
  observed stroke/style.)* Loaded from CDN (`unpkg.com/lucide`); the `Icon` component wraps it.
- **Common glyphs:** `layout-grid` (Command Center), `cpu`/`circuit-board` (AI Core), `bot`
  (Agents), `list-checks` (Tasks), `calendar`, `database` (Memory), `message-square`
  (Conversations), `network` (Knowledge Base), `wrench` (Tools & Skills), `workflow`,
  `gauge` (System Monitor), `mic` (Voice), `bell`, `settings`, `search`, `maximize`, `user`.
- **Status dots:** small filled circles with a colored glow (not icons).
- **Emoji / Unicode icons:** **not used.** The only non-icon glyph is the trailing `›`
  chevron on "view more" links.
- **Brand mark:** the **arc-reactor emblem** — a glowing triangular reactor core inside a
  segmented coil ring and an outer rotating dashed ring — paired with the "JARVIS / COMMAND
  CENTER" wordmark. It is now a crisp **vector React component** (`components/brand/Logo`),
  recolorable and animatable, replacing the earlier raster crop. Legacy raster crops remain
  in `assets/` (`jarvis-emblem.png`, `jarvis-lockup.png`) for reference only.

---

## Index / manifest

**Root**
- `styles.css` — global entry point (consumers link this). `@import`s only.
- `readme.md` — this guide.
- `SKILL.md` — Agent-Skill front-matter for use in Claude Code.

**`tokens/`** — CSS custom properties + fonts
- `colors.css` · `typography.css` · `spacing.css` · `effects.css` (glows, gradients,
  chamfer clip-paths, keyframes) · `fonts.css` (Google Fonts) · `base.css` (resets, helper
  classes `.jv-panel`, `.jv-label`, `.jv-dot`, scrollbars).

**`components/core/`** — primitives
- `Button`, `Icon`, `Badge`, `Tag`, `Panel`, `NavItem`, `StatTile`, `StatusRow`, `Input`,
  `Switch`.

**`components/brand/`** — brand
- `Logo` (vector arc-reactor emblem + optional wordmark lockup).

**`components/hud/`** — signature HUD pieces
- `ProgressRing` (donut gauge), `Waveform` (voice bars), `VoiceOrb` (mic orb).

**`guidelines/`** — foundation specimen cards (Design System tab): Colors, Type, Spacing,
Brand groups.

**`ui_kits/command-center/`** — interactive HUD recreation. The **Command Center** dashboard
puts the **Voice Core** (large orb + live waveform + rolling transcript — "speak with
JARVIS") at the visual center; Tasks and System Monitor views also included. See its
`README.md`.

**`assets/`** — `jarvis-emblem.png`, `jarvis-lockup.png`, `globe-motif.png`.

**Namespace:** components are exposed at `window.JARVISDesignSystem_547efc.<Name>` after the
generated `_ds_bundle.js` loads.
