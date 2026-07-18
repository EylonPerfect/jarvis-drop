# After Human — Live-Call COGS & Overage Pricing Floor

**Phase 3, task 5.** COGS breakdown per **live-call-minute** (the billable/overage
unit), a worked example for a typical ~15-minute call, and the resulting pricing
floor for the hybrid overage.

> All rates are **current public list prices as of mid-2026** and are labelled
> **ESTIMATES** where a spec/usage assumption is involved. They seed the
> `config.metering.*` defaults; the ledger (`usage_events`) always stores the
> *actual computed* cost per event, so real COGS is measured, not assumed.
> Sources are listed at the bottom.

---

## 1. Unit rates (inputs)

| Driver | Public rate (2026) | Notes |
|---|---|---|
| **E2B desktop sandbox** | vCPU **$0.0504 / vCPU-hr**, RAM **$0.0162 / GiB-hr**, billed per-second wall-clock | Desktop GUI assumed **2 vCPU / 4 GiB** ⇒ `2·0.0504 + 4·0.0162 = $0.1656/hr ≈ $0.00276/min` (ESTIMATE — depends on template size). |
| **OpenAI Realtime voice** (`gpt-realtime`) | Audio **$32 / $64** per M input/output tokens; cached text input **$0.40/M** | Audio encodes duration: user ≈ 1 tok/100ms, assistant ≈ 1 tok/50ms. Measured all-in **$0.18–$0.46/min uncached**, **~$0.056/min with prompt caching**, production avg **~$0.087/min**. |
| **Tool / computer-use model** (`providers.ts`, e.g. GPT‑4o class) | **$2.50 / $10.00** per M input/output tokens (`$0.0025 / $0.01` per 1k) | Vision screenshots + operator-loop reasoning during the call. |
| **ElevenLabs TTS** (`eleven_turbo_v2_5`) | **$0.05 / 1,000 chars** (`$0.00005/char`); Multilingual v2/v3 = $0.10/1k | Only on the **Zoom/Recall narration path**; the realtime demo call uses OpenAI audio instead (not double-counted). |
| **Cheaper non-live tier** (`gpt-*-mini`) | ~1/3 of flagship | Used for extraction / persona-compile / verify / redteam / playbook (task 4). Not part of live COGS. |

---

## 2. Worked example — typical **15-minute** live demo call

Path = the realtime demo call (`call.ts`): OpenAI Realtime for voice, one E2B
desktop for the shared screen, tool model driving computer-use. ~60% customer /
40% agent talk split.

| Component | Calc | Cost |
|---|---|---|
| E2B desktop sandbox | ~16 min (incl. ~1 min boot) × $0.00276/min | **$0.044** |
| OpenAI Realtime voice — **uncached typical** | 15 min × ~$0.125/min (measured breakdown) | **$1.88** |
| Tool / computer-use model | ~30 operator steps × (~1.5k in + 0.3k out) ≈ 30 × $0.0068 | **$0.20** |
| ElevenLabs TTS | realtime path uses OpenAI audio ⇒ $0 | **$0.00** |
| **Total (uncached typical)** | | **≈ $2.12** |
| **Per live-call-minute** | $2.12 / 15 | **≈ $0.14/min** |

**Sensitivity (dominated by realtime audio):**

| Scenario | Realtime $/min | 15-min total | Per-min COGS |
|---|---|---|---|
| **Cached** (stable persona prompt, 90%+ hit) | ~$0.056 | ~$1.09 | **~$0.073/min** |
| **Uncached typical** (base case) | ~$0.125 | ~$2.12 | **~$0.14/min** |
| **Heavy / worst-case** | ~$0.46 | ~$7.15 | **~$0.48/min** |

---

## 3. Resulting pricing floor for the hybrid overage

- **COGS floor per live-call-minute ≈ $0.07 (cached) → $0.14 (typical) → up to ~$0.48 (worst case).**
- Use the **typical uncached ~$0.15/min** as the planning COGS floor
  (`METER_LIVE_CALL_USD_PER_MIN` default `0.15`). This is the *break-even* — the
  overage price must clear it.
- Target gross margin ⇒ overage price:

  | Target GM | Overage price = COGS / (1 − GM) |
  |---|---|
  | 70% | $0.50/min |
  | 80% | $0.75/min |
  | 90% | $1.50/min |

- **Recommended overage price: $1.50 / live-call-minute** (`METER_OVERAGE_PER_MIN`
  default `1.50`) — ~90% GM at typical COGS, and still positive (~$1.02/min, ~68% GM)
  even in the worst-case realtime scenario. This protects margin against the one
  volatile driver (realtime audio) without needing per-call caching guarantees.
- **Hybrid structure:** per-org **seat fee** + **included allowance** (soft cap,
  e.g. 500 min/org/mo) at the seat price; minutes beyond it bill at the overage
  price; a **hard cap** (e.g. 750 min) pauses new calls; a global **runaway
  circuit breaker** ($/window) is the platform backstop. All are config-driven
  (`config.metering.*` / `org_billing_config`).

### Biggest lever
Realtime audio is **~85–90% of COGS**. **Prompt caching on the (large, stable)
persona system prompt** roughly halves total call cost ($0.14 → $0.073/min).
That single optimization matters more than any other cost control here.

---

## Sources & assumptions
- E2B pricing (per-second vCPU/RAM, desktop sandbox): e2b.dev/pricing, beam.cloud, morphllm.com — *2026*.
- OpenAI Realtime audio pricing + measured $/min: developers.openai.com/api/docs/pricing; callsphere.ai (11 real call profiles: $0.18–$0.46/min uncached, ~$0.056 cached, ~$0.087 prod avg); tokenmix.ai; hackernoon (4,000 measured sessions) — *2026*.
- ElevenLabs API $/1k chars: elevenlabs.io/pricing/api, bigvu.tv — *2026*.
- **Assumptions (estimates):** desktop = 2 vCPU/4 GiB; 15-min call, 60/40 talk split; ~30 operator steps; tool model = GPT-4o-class. Actuals are captured per event in `usage_events`, so these defaults should be re-tuned from real ledger data after launch.
