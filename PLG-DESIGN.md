# PLG viral system — design (2026-07-19)

Wow-triggered referral / bring-a-friend / viral loops for After Human's self-serve
launch. Decided with Eylon 2026-07-19: **build all three loops**, reward = **free
clone-month, DOUBLE-SIDED**. Read [[afterhuman-platform-map]] rules before editing.

## The insight
After Human's wow moment IS a live AI conversation — inherently forwardable. The
shared object can BE the wow (a live Ava/clone demo), not a discount code. That
re-triggers the identical wow in the recipient. This is the core advantage.

## The three wow moments (share triggers)
1. Talk-to-Ava (pre-signup, landing) — cold-shareable, no account needed.
2. Watch YOUR clone (post-signup, activation) — personal, intense.
3. Clone goes live / hits 70 (money moment) — best for bragging content.

## The three loops (all on ONE backbone)
- **A · Send-to-Ava** — after a wow, one-click "let a colleague meet Ava" →
  attributed ref link → recipient lands in a live Ava demo → signup carries ref.
  loop='ava'.
- **B · Clone-your-team** — in-app "invite a teammate to get cloned" → org
  expansion (more seats = more MRR + stickier org). loop='team'.
- **C · Brag-a-clip** — after a strong rehearsal/live call, a shareable card/clip
  → LinkedIn (where the ICP lives). loop='clip'.

## Reward model (double-sided free clone-month)
- Unit: `reward_grants` row, kind='free_clone_month', months=1 → +1 COMPED clone
  slot for 30d, honored by billing.ts effective-slot math (paid + comped).
- CONVERSION = referred org's FIRST paid subscription (billing subscription_created).
  NOT signup (a $2k reward can't fire on a free signup — gameable/unaffordable).
  On conversion: grant referrer (role='referrer') + referred (role='referred').
- Margin: comped live-call COGS ~$0.14/min; the "free month" is mostly forgone
  revenue on a customer we wouldn't have had. CAC-positive.
- Anti-abuse: unique(referred_org) so an org is attributed once; self-referral
  blocked (referrer_org != referred_org); reward only on real payment.

## Backbone (Milestone 0)
- migration 003_referrals.sql: orgs.ref_code (unique), referrals, reward_grants.
- lib/referrals.ts: ensureRefCode, resolveRefCode, recordShare, attachSignup,
  convertReferral, listForOrg (stats), countCompedSlots.
- routes/referrals.ts (authed): GET /api/referrals/me, POST /api/referrals/share.
- HOOKS: auth.ts signup → ensureRefCode + attachSignup(if attribution.ref);
  billing.ts subscription_created → convertReferral(org);
  billing lib orgCanGoLive → + countCompedSlots in the slot check;
  demo.ts /start → accept ref so an Ava share carries the referrer to signup.
- FE attribution: capture ?ref= into the attribution blob (alongside src/utm).

## Status
- [x] M0 backbone — SHIPPED + VERIFIED 2026-07-19 (bff rebuilt, migration on boot,
      14/14 backbone assertions pass, both API endpoints live). Files:
      db/migrations/003_referrals.sql, lib/referrals.ts, routes/referrals.ts;
      hooks in routes/auth.ts (signup), routes/billing.ts (subscription_created →
      convertReferral), lib/billing.ts (orgCanGoLive + comped slots). NOTE:
      BILLING_GATE_ENFORCED=false today, so comped slots have no live effect until
      the gate is flipped on — ledger + math are correct and code-verified.
- [x] M1 loops SHIPPED 2026-07-20 — ReferralShare component (all 3 loops) + ref capture + mounts + invited banner (verified)
- [ ] M2 Loop B (Clone-your-team)
- [ ] M3 Loop C (Brag-a-clip)
- [ ] M4 Referrals dashboard + reward redemption UI + nurture emails
