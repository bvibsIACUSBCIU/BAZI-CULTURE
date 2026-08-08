CREATE TABLE conversation_turn_requests (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  report_version_number INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (user_id, request_id)
);

INSERT INTO conversation_turn_requests (
  id,
  conversation_id,
  user_id,
  request_id,
  report_version_number,
  created_at,
  completed_at
)
SELECT
  'legacy-turn:' || conversations.id,
  conversations.id,
  conversations.user_id,
  conversations.request_id,
  (
    SELECT MAX(report_versions.version_number)
    FROM report_versions
    WHERE report_versions.conversation_id = conversations.id
  ),
  conversations.created_at,
  conversations.updated_at
FROM conversations
WHERE conversations.deleted_at IS NULL;

CREATE INDEX conversation_turn_requests_by_conversation
ON conversation_turn_requests(conversation_id, created_at ASC);
