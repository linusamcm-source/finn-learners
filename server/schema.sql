-- learner-dash storage. Two tables, exactly as the spec calls for.
--
-- Spaced repetition is derived from `answers` rather than kept in its own
-- table: every scheduling decision the feed makes is a function of when an
-- item was last answered and whether it was right, so a separate schedule
-- table would only be a cache that can fall out of step with the answers.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  startedAt TEXT    NOT NULL,
  endedAt   TEXT,
  itemCount INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS answers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  itemId         TEXT    NOT NULL,
  topic          TEXT    NOT NULL,
  correct        INTEGER NOT NULL CHECK (correct IN (0, 1)),
  responseTimeMs INTEGER NOT NULL,
  answeredAt     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_answers_session  ON answers (sessionId);
CREATE INDEX IF NOT EXISTS idx_answers_item     ON answers (itemId, answeredAt);
CREATE INDEX IF NOT EXISTS idx_answers_topic    ON answers (topic, answeredAt);
CREATE INDEX IF NOT EXISTS idx_answers_answered ON answers (answeredAt);
