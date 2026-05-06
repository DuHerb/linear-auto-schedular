-- scheduler-state schema. Idempotent — safe to re-apply on every boot.
-- Source of truth: PLANNING.md §"SQLite schema". Do not deviate.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Signals: pre-built for v2 webhooks. Empty in v1.
CREATE TABLE IF NOT EXISTS signals (
  signal_id      TEXT PRIMARY KEY,
  source         TEXT NOT NULL,
  kind           TEXT NOT NULL,
  payload        TEXT NOT NULL,
  received_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at   TIMESTAMP,
  resolution     TEXT
);
CREATE INDEX IF NOT EXISTS idx_signals_unprocessed
  ON signals(received_at) WHERE processed_at IS NULL;

-- Plans: each /plan-week run produces one row. /apply-plan reads the latest.
CREATE TABLE IF NOT EXISTS plans (
  plan_id        TEXT PRIMARY KEY,
  generated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at     TIMESTAMP,
  content        TEXT NOT NULL
);

-- Mappings: the heart of the system. Linear issue ↔ calendar event(s).
CREATE TABLE IF NOT EXISTS mappings (
  mapping_id              TEXT PRIMARY KEY,
  linear_issue_id         TEXT NOT NULL,
  linear_issue_identifier TEXT NOT NULL,
  calendar_event_id       TEXT NOT NULL,
  calendar_id             TEXT NOT NULL,
  session_index           INTEGER NOT NULL,
  total_sessions          INTEGER NOT NULL,
  planned_start           TIMESTAMP NOT NULL,
  planned_end             TIMESTAMP NOT NULL,
  status                  TEXT NOT NULL,
  plan_id                 TEXT REFERENCES plans(plan_id),
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mappings_issue ON mappings(linear_issue_id);
CREATE INDEX IF NOT EXISTS idx_mappings_event ON mappings(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_mappings_active ON mappings(status)
  WHERE status IN ('scheduled', 'in_progress');
