CREATE TABLE report_versions (
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

INSERT INTO report_versions (
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
FROM reports;

CREATE INDEX report_versions_by_conversation ON report_versions(conversation_id, version_number DESC);
CREATE INDEX report_versions_by_user_updated ON report_versions(user_id, updated_at DESC);

CREATE TRIGGER report_versions_sync_legacy_insert
AFTER INSERT ON reports
BEGIN
  INSERT INTO report_versions (
    id, conversation_id, user_id, version_number, summary, report_markdown,
    chart_summary, chart_json, completed_at, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.conversation_id, NEW.user_id, 1, NEW.summary, NEW.report_markdown,
    NEW.chart_summary, NEW.chart_json, NEW.completed_at, NEW.created_at, NEW.updated_at
  ) ON CONFLICT(conversation_id, version_number) DO UPDATE SET
    summary = excluded.summary,
    report_markdown = excluded.report_markdown,
    chart_summary = excluded.chart_summary,
    chart_json = excluded.chart_json,
    completed_at = excluded.completed_at,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER report_versions_sync_legacy_update
AFTER UPDATE ON reports
BEGIN
  INSERT INTO report_versions (
    id, conversation_id, user_id, version_number, summary, report_markdown,
    chart_summary, chart_json, completed_at, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.conversation_id, NEW.user_id, 1, NEW.summary, NEW.report_markdown,
    NEW.chart_summary, NEW.chart_json, NEW.completed_at, NEW.created_at, NEW.updated_at
  ) ON CONFLICT(conversation_id, version_number) DO UPDATE SET
    summary = excluded.summary,
    report_markdown = excluded.report_markdown,
    chart_summary = excluded.chart_summary,
    chart_json = excluded.chart_json,
    completed_at = excluded.completed_at,
    updated_at = excluded.updated_at;
END;
