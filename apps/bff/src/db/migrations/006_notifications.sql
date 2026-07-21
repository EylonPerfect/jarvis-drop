-- ============================================================
-- IN-APP NOTIFICATION CENTER — enrich the existing org_notifications table
-- (kind + body) into a full notification store: title, deep-link href, severity,
-- and an icon. Additive + idempotent; existing writers (super-admin transparency)
-- keep working (title/href/icon null, severity defaults to 'info').
-- ============================================================
ALTER TABLE org_notifications ADD COLUMN IF NOT EXISTS title    TEXT;
ALTER TABLE org_notifications ADD COLUMN IF NOT EXISTS href     TEXT;
ALTER TABLE org_notifications ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';
ALTER TABLE org_notifications ADD COLUMN IF NOT EXISTS icon     TEXT;
CREATE INDEX IF NOT EXISTS org_notifications_unread_idx ON org_notifications (org_id) WHERE read_at IS NULL;
