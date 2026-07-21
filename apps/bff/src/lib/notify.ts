import { query, one } from "../db/pool.js";
import { newId } from "./auth.js";
import { config } from "../config.js";
import { sendEmail, renderNotificationEmail, emailConfigured } from "./email.js";

// ============================================================================
// lib/notify.ts — the in-app notification center. Writes to org_notifications
// (the first, dependency-free channel; Slack + email layer on later). Every
// write is best-effort — a notification must NEVER break the flow that fired it.
// ============================================================================

export type Severity = "info" | "success" | "warning" | "critical";
export interface NotifyInput {
  kind: string;            // machine key, e.g. clone_certified | call_reported | payment_failed
  title: string;           // one-line headline
  body: string;            // supporting sentence
  href?: string | null;    // in-app deep link (hash route), e.g. "#/readiness"
  severity?: Severity;
  icon?: string | null;    // material-symbols name
  email?: boolean;         // ALSO email the org owner (re-engagement / billing / wow)
  ctaLabel?: string;       // email button label (default "Open in AfterHuman")
}

export async function notify(orgId: string | null | undefined, n: NotifyInput): Promise<void> {
  if (!orgId) return;
  try {
    await query(
      `INSERT INTO org_notifications (id, org_id, kind, title, body, href, severity, icon)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [newId("ntf"), orgId, n.kind, n.title, n.body, n.href ?? null, n.severity ?? "info", n.icon ?? null],
    );
  } catch { /* never let a notification break its caller */ }
  // Optional email fan-out — only when the notification asks for it AND a provider
  // is configured. Fire-and-forget so email latency never blocks the caller.
  if (n.email && emailConfigured()) void emailOrgOwner(orgId, n).catch(() => {});
}

async function emailOrgOwner(orgId: string, n: NotifyInput): Promise<void> {
  const row = await one<{ email: string }>(
    `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1 ORDER BY (m.role='owner') DESC, m.created_at ASC LIMIT 1`, [orgId],
  );
  const to = row?.email;
  if (!to) return;
  const ctaUrl = n.href ? `${config.email.appUrl}/${n.href.replace(/^\//, "")}` : undefined;
  const { html, text } = renderNotificationEmail({
    title: n.title, body: n.body, ctaLabel: n.ctaLabel ?? "Open in AfterHuman", ctaUrl, severity: n.severity,
  });
  await sendEmail(to, n.title, html, text);
}

// Fire a notification at most once per (org, kind, dedupeKey) — for once-ever
// events like the FIRST live call, or once-per-period thresholds.
export async function notifyOnce(orgId: string, dedupeKind: string, n: NotifyInput): Promise<void> {
  if (!orgId) return;
  try {
    const seen = await one<{ id: string }>(`SELECT id FROM org_notifications WHERE org_id=$1 AND kind=$2 LIMIT 1`, [orgId, dedupeKind]);
    if (seen) return;
    await notify(orgId, { ...n, kind: dedupeKind });
  } catch { /* best-effort */ }
}

export interface NotificationRow {
  id: string; kind: string; title: string | null; body: string;
  href: string | null; severity: string; icon: string | null;
  created_at: string; read_at: string | null;
}

export async function listNotifications(orgId: string, limit = 40): Promise<{ notifications: NotificationRow[]; unread: number }> {
  const notifications = await query<NotificationRow>(
    `SELECT id, kind, title, body, href, severity, icon, created_at, read_at
       FROM org_notifications WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`, [orgId, limit],
  );
  const u = await one<{ n: string }>(`SELECT COUNT(*)::text AS n FROM org_notifications WHERE org_id=$1 AND read_at IS NULL`, [orgId]);
  return { notifications, unread: Number(u?.n ?? 0) };
}

export async function markRead(orgId: string, id?: string): Promise<void> {
  if (id) await query(`UPDATE org_notifications SET read_at=now() WHERE org_id=$1 AND id=$2 AND read_at IS NULL`, [orgId, id]).catch(() => {});
  else await query(`UPDATE org_notifications SET read_at=now() WHERE org_id=$1 AND read_at IS NULL`, [orgId]).catch(() => {});
}
