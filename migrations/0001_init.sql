-- 何时何地 · 初始表结构
-- 注意：这份 SQL 必须和 src/server/schema.ts 保持一致，改一个就改另一个。

CREATE TABLE IF NOT EXISTS events (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  range_start          INTEGER NOT NULL,
  range_end            INTEGER NOT NULL,
  timezone             TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  granularity          TEXT NOT NULL DEFAULT 'day',
  collect_destinations INTEGER NOT NULL DEFAULT 1,
  budget_enabled       INTEGER NOT NULL DEFAULT 0,
  core_only            INTEGER NOT NULL DEFAULT 0,
  anonymity            TEXT NOT NULL DEFAULT 'open',
  admin_key_hash       TEXT NOT NULL,
  finalized_plan       TEXT,
  created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  is_core       INTEGER NOT NULL DEFAULT 0,
  availability  TEXT NOT NULL DEFAULT '',
  responded_at  INTEGER,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS participants_event_idx ON participants(event_id);

CREATE TABLE IF NOT EXISTS destinations (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  days_needed  INTEGER NOT NULL,
  budget_level INTEGER,
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS destinations_event_idx ON destinations(event_id);

CREATE TABLE IF NOT EXISTS votes (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  level          INTEGER NOT NULL,
  PRIMARY KEY (participant_id, destination_id)
);
