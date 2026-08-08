# Threaded Conversation and Report Versions Design

## Goal

Make each history entry a persistent, wallet-owned conversation thread. Every
new question in that thread appends a user message and an assistant response;
every successful turn creates an immutable, numbered report version.

## Scope

- A user starts a new thread only with **新建对话**.
- Sending another question while a thread is active appends to that same
  thread, including the streamed analysis card and final assistant message.
- The report panel exposes **版本 1**, **版本 2**, and later versions in
  chronological order. Selecting one changes only the displayed report.
- Reloading the page, reopening history, and signing in on another device
  restore the messages and all report versions for the authenticated wallet.
- Existing one-question conversations remain readable as a thread containing
  one user message, one assistant response, and one report version.

## Data model

The existing `conversations` table becomes the thread header. It retains its
owner, profile, title, bookmark state, and update timestamp, but no longer
represents one report-generation request.

`conversation_messages` stores the ordered transcript. Each row has a
conversation ID, contiguous sequence number, role, and content. The server
adds the user question before starting the pipeline and adds the final
assistant summary after the pipeline completes.

The existing `reports` table remains a compatibility projection containing the
latest legacy-format report. A new `report_versions` table stores immutable
versions with a positive `version_number`; `(conversation_id,
version_number)` is unique. The migration copies existing reports into version
1 and installs temporary synchronization triggers so old Worker writes made
during rollout keep version 1 current. Once the new Worker is deployed, it
writes only `report_versions`; new turns never mutate an earlier version. All
queries remain scoped to the signed-in user.

## API and streaming flow

`POST /api/chat` accepts an optional `conversationId`.

- Without it, the server creates a thread, writes the first user message, and
  emits `session_start` with that thread ID.
- With it, the server first verifies ownership and profile match, appends the
  next user message, then streams the same six-stage pipeline into that thread.
- Pipeline completion writes one assistant message and one new report version,
  then emits the report version metadata with the existing completion events.
- Request IDs remain per-turn idempotency keys, so a retried request cannot
  create a duplicate debit, message, or report version.

`GET /api/session-history` returns lightweight thread summaries for the left
column. `GET /api/session-history?sessionId=<id>` returns the selected thread,
its ordered messages, and all version metadata plus report Markdown. The API
never accepts a wallet identity as authorization.

## Frontend behavior

The client keeps `activeConversationId` separately from `currentReport`.
When the user sends a question, it renders the new user bubble and a new
assistant analysis card below existing messages. It sends the active thread ID
to the server and saves the emitted ID when the first turn starts.

Loading a history item clears the visible chat only to rebuild that thread's
full transcript in sequence; it does not synthesize a new conversation.
The report panel renders a version selector. After a completed turn, it adds
and selects the newly created version while preserving all earlier choices.
Starting a new conversation clears only the active thread state and starts a
new empty visual transcript.

## Failure handling

If generation fails, the persisted user message remains visible and the
thread's generation state becomes `failed`; no report version is added. A
later user question can continue the thread. If a thread or report version
does not belong to the signed-in wallet, the API returns not found rather than
leaking its existence.

## Verification

- Repository tests prove ordered messages, report numbering, ownership
  isolation, and idempotent repeat requests.
- API tests prove a second question with the same conversation ID appends one
  turn and creates version 2 without overwriting version 1.
- Frontend contract tests prove the active conversation ID is sent, historical
  messages are rendered in order, and version controls are present.
- Run `npm test` and `node --env-file=.env scripts/test-simulation.mjs` after
  implementation, then perform an authenticated browser flow with two
  questions in one thread and a reload.
