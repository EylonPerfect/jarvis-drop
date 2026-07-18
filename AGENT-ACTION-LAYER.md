# Agent action layer — making the no-API clone reliable on ANY product

Thesis: drop a note-taker transcript in, the clone operates the real product like a human — **no integration, no API, no per-product wiring**. That makes robust UI operation the whole game. Rehearsal-all-day is the tax of the no-integration bet; the way to lower it is a robust, product-agnostic perceive → act → verify loop.

## Step 1 — verified click layer  ✅ (done 2026-07-16)
`window.__ahClick(el)` (in OVERLAY): real pointer/mouse sequence, since GoPerfect primary buttons ignore bare `.click()`. All primary/submit/nav/skip clicks route through it. Retires the card-submit / autopilot / Email whack-a-mole.

## Step 2 — product-agnostic PERCEPTION (the real unlock)  ⬜
Today perception is secretly GoPerfect-specific: `QCARD_READ` keys on `[class*=ChatAgentQuestionsArtifact]`, counts on `match-card`. Those classes don't exist on any other product, so it isn't yet "magic on any UI." Replace CSS-class scraping with two integration-free perception sources:

1. **Accessibility tree (primary).** CDP `Accessibility.getFullAXTree` — the same semantic view screen readers use: roles (button/option/textbox/dialog), names ("Email", "Start Autopilot"), states (disabled/selected). Locate targets by **role + name**, not class. Standard, zero integration, works on any accessible web app.
2. **Vision fallback (when the a11y tree is thin).** Screenshot → vision model locates the target by description ("the Email channel tile", "the enabled submit arrow") → coordinates → `__ahClick` / CDP `Input`. Covers canvas/opaque UIs.

## Step 3 — verify-after-act contract  ⬜
Every action: act → re-perceive → confirm the expected change (dialog closed, count changed, new element) → retry / adapt / escalate. Never narrate blind success (kills the "autopilot is running"/"29 candidates"/"email connected" hallucinations).

## Refactor shape
Replace hand-written JS snippets (QCARD_READ, click_option_js, CLICK_JS, match-card counts) with generic primitives:
- `perceive()` → structured a11y snapshot (+ optional screenshot)
- `findTarget(intent)` → resolve "the Email option" via a11y match, vision fallback
- `act(target)` → `__ahClick` / type via CDP Input (trusted events)
- `verify(expectation)` → re-perceive, confirm
Clone tools become semantic (`click("Email")`, `answer_question(choice)`, `read_screen()`), backed by perceive/find/act/verify — **no product-specific selectors**.

## Honest ceiling
This is a computer-use agent — the hard frontier; never literally 100%. But a11y + vision + verify is the highest-reliability path that stays true to "no API," and it moves rehearsal from a precondition to a background spot-check. Each new product needs **zero** new selectors.

## Sequence
(1) verified-click layer ✅ → (2) a11y perception → (3) vision fallback → (4) verify-after-act on every tool. Persona/judgment tuning comes after mechanics are boring.
