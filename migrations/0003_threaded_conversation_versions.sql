ALTER TABLE reports RENAME TO reports_legacy;

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  summary TEXT NOT NULL DEFAULT '',
  report_markdown TEXT NOT NULL DEFAULT '',
  chart_summary TEXT NOT NULL DEFAULT '',
  chart_json TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (conversation_id, version_number)
);

INSERT INTO reports (
  id,
  conversation_id,
  user_id,
  version_number,
  summary,
  report_markdown,
  chart_summary,
  chart_json,
  completed_at,
  created_at,
  updated_at
)
SELECT
  id,
  conversation_id,
  user_id,
  1,
  summary,
  report_markdown,
  chart_summary,
  chart_json,
  completed_at,
  created_at,
  updated_at
FROM reports_legacy;

DROP TABLE reports_legacy;

CREATE INDEX reports_by_conversation_version ON reports(conversation_id, version_number DESC);
CREATE INDEX reports_by_user_updated ON reports(user_id, updated_at DESC);
