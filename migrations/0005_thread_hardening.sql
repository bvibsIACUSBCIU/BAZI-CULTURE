-- Counters make message and report allocation serial per conversation. The
-- legacy reports table remains writable; its version-one projection is still
-- mutable through the migration triggers in 0003.
CREATE TABLE conversation_sequences (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
  next_message_sequence INTEGER NOT NULL CHECK (next_message_sequence > 0),
  next_report_version INTEGER NOT NULL CHECK (next_report_version > 0)
);

CREATE TABLE conversation_turn_completions (
  turn_request_id TEXT PRIMARY KEY REFERENCES conversation_turn_requests(id),
  created_at TEXT NOT NULL
);

INSERT INTO conversation_turn_completions (turn_request_id, created_at)
SELECT id, COALESCE(completed_at, created_at)
FROM conversation_turn_requests
WHERE completed_at IS NOT NULL;

INSERT INTO conversation_sequences (conversation_id, next_message_sequence, next_report_version)
SELECT
  conversations.id,
  COALESCE((SELECT MAX(sequence) FROM conversation_messages WHERE conversation_id = conversations.id), 0) + 1,
  COALESCE((SELECT MAX(version_number) FROM report_versions WHERE conversation_id = conversations.id), 0) + 1
FROM conversations
WHERE conversations.deleted_at IS NULL;

CREATE TRIGGER report_versions_immutable_update
BEFORE UPDATE ON report_versions
WHEN OLD.version_number > 1
BEGIN
  SELECT RAISE(ABORT, 'report_versions_immutable');
END;

CREATE TRIGGER report_versions_immutable_delete
BEFORE DELETE ON report_versions
WHEN OLD.version_number > 1
BEGIN
  SELECT RAISE(ABORT, 'report_versions_immutable');
END;

CREATE TRIGGER credit_ledger_prevent_negative_balance
BEFORE INSERT ON credit_ledger
WHEN NEW.balance_after < 0
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_CREDITS');
END;
