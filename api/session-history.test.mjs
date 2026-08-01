import assert from "node:assert/strict";
import test from "node:test";
import sessionHistoryHandler from "./session-history.js";

test("Session History API - GET returns sessions list and bookmarks", async () => {
  const req = {
    method: "GET",
    url: "http://localhost/api/session-history?wallet=test_session_1",
    headers: new Map()
  };

  const response = await sessionHistoryHandler(req);
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.ok(Array.isArray(data.sessions));
  assert.ok(Array.isArray(data.bookmarks));
  assert.ok(data.sessions.length >= 1);
});

test("Session History API - POST bookmark toggles session bookmarked state", async () => {
  const req = {
    method: "POST",
    url: "http://localhost/api/session-history?wallet=test_session_bookmark",
    headers: new Map(),
    body: {
      action: "bookmark",
      sessionId: "sess-001"
    }
  };

  const response = await sessionHistoryHandler(req);
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.equal(data.session.id, "sess-001");
  // sess-001 was initially bookmarked=true, toggling makes it false
  assert.equal(data.session.bookmarked, false);
});

test("Session History API - POST add creates new session", async () => {
  const req = {
    method: "POST",
    url: "http://localhost/api/session-history?wallet=test_session_add",
    headers: new Map(),
    body: {
      action: "add",
      profileId: "prof-hanli",
      title: "流年运势大运分析",
      topic: "career"
    }
  };

  const response = await sessionHistoryHandler(req);
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.equal(data.session.title, "流年运势大运分析");
  assert.equal(data.session.topic, "career");
});
