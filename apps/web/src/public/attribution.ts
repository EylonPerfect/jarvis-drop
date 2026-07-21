// ============================================================
// After Human — outbound demo-link attribution (source → demo → signup → paid).
//
// Captures attribution params from the URL on public-site load and persists them
// to localStorage so they survive hash navigation (#/ava → #/auth signup). The
// captured blob is sent to:
//   POST /api/demo/start   (the `utm` text field — a compact JSON string)
//   POST /api/auth/signup  (the `attribution` field — persisted on the new org)
//
// Link formats supported (BOTH are parsed, params merged):
//   .../site#/ava?src=<campaign>                    simple — param inside the hash
//   .../site?utm_source=..&utm_campaign=..#/ava     standard UTM — param before hash
// ============================================================

const STORAGE_KEY = "ah_attribution";
const FIELDS = ["src", "utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term", "ref", "ref_loop", "ref_wow"] as const;
export type Attribution = Partial<Record<(typeof FIELDS)[number], string>> & { ts?: string };

// Merge params from BOTH the pre-hash query string and any `?...` embedded in the
// hash (e.g. `#/ava?src=x`), since the outbound link puts `?src=` after the hash.
function paramsFromUrl(): URLSearchParams {
  const out = new URLSearchParams();
  try { new URLSearchParams(window.location.search).forEach((v, k) => out.set(k, v)); } catch { /* noop */ }
  const hash = window.location.hash || "";
  const qi = hash.indexOf("?");
  if (qi > -1) { try { new URLSearchParams(hash.slice(qi + 1)).forEach((v, k) => out.set(k, v)); } catch { /* noop */ } }
  return out;
}

/**
 * Capture attribution from the URL on load and persist it if any known field is
 * present. A fresh campaign link overwrites (last-touch); plain in-site
 * navigation (no params) preserves whatever was captured on the entry click.
 * Returns the effective attribution (freshly captured or previously persisted).
 */
export function captureAttribution(): Attribution {
  const p = paramsFromUrl();
  const found: Attribution = {};
  for (const f of FIELDS) { const v = p.get(f); if (v) found[f] = v.slice(0, 120); }
  if (Object.keys(found).length > 0) {
    found.ts = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(found)); } catch { /* noop */ }
    return found;
  }
  return getAttribution();
}

/** Read persisted attribution (empty object if none / unavailable). */
export function getAttribution(): Attribution {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw) as Attribution; } catch { /* noop */ }
  return {};
}

/** Compact JSON string for the demo `utm` text column; "" when nothing captured. */
export function attributionString(): string {
  const a = getAttribution();
  return Object.keys(a).length ? JSON.stringify(a) : "";
}
