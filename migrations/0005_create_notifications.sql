-- Migration: 0005_create_notifications
-- Description: Creates the notifications table for in-app plant care reminders and alerts
-- Target: PostgreSQL 15+ (Neon)
-- Dependencies: 0001_create_auth_tables (users)

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ NULL,
    dedup_key TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT notifications_type_check CHECK (type IN ('care_task', 'environmental', 'lifecycle', 'system')),
    CONSTRAINT notifications_title_length_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 255),
    CONSTRAINT notifications_message_length_check CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000),
    CONSTRAINT notifications_link_safety_check CHECK (link IS NULL OR (link LIKE '/%' AND link NOT LIKE '//%')),
    CONSTRAINT notifications_read_at_consistency_check CHECK ((is_read = true AND read_at IS NOT NULL) OR (is_read = false AND read_at IS NULL))
);

-- Unique partial index for deterministic deduplication per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedup
    ON notifications(user_id, dedup_key)
    WHERE dedup_key IS NOT NULL;

-- Index for fast user listing and unread count queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications(user_id, is_read, created_at DESC);

-- Index for ordered user notification listing
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications(user_id, created_at DESC);

COMMENT ON TABLE notifications IS 'In-app user notifications, care reminders, and environmental alerts';
COMMENT ON COLUMN notifications.id IS 'Internal unique notification ID (UUID v4)';
COMMENT ON COLUMN notifications.user_id IS 'Owner of the notification; references users(id)';
COMMENT ON COLUMN notifications.type IS 'Category of notification: care_task, environmental, lifecycle, system';
COMMENT ON COLUMN notifications.title IS 'Short human-readable notification subject';
COMMENT ON COLUMN notifications.message IS 'Detailed explanation or care instruction';
COMMENT ON COLUMN notifications.link IS 'Safe internal relative application link (e.g. /dashboard/tasks/...)';
COMMENT ON COLUMN notifications.is_read IS 'Read state flag';
COMMENT ON COLUMN notifications.read_at IS 'Timestamp when notification was read; strictly consistent with is_read';
COMMENT ON COLUMN notifications.dedup_key IS 'Idempotent deduplication key per user (e.g. overdue-task-uuid-2026-10-24)';
COMMENT ON COLUMN notifications.created_at IS 'Creation timestamp';
