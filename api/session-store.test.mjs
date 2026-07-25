import assert from "node:assert/strict";
import { test } from "node:test";

import { MemorySessionStore } from "../lib/runtime/session-store.js";

test("memory session store expires records after TTL", async () => {
  let now = 1_000;
  const store = new MemorySessionStore({
    namespace: `ttl-test-${Math.random()}`,
    defaultTtlSeconds: 10,
    now: () => now,
  });

  await store.set("session", 1, { step: "date" });
  assert.deepEqual(await store.get("session", 1), { step: "date" });

  now += 10_001;
  assert.equal(await store.get("session", 1), null);
});

test("setIfAbsent atomically rejects a duplicate key", async () => {
  const store = new MemorySessionStore({
    namespace: `dedupe-test-${Math.random()}`,
  });

  const claims = await Promise.all([
    store.setIfAbsent("update", 99, true, 60),
    store.setIfAbsent("update", 99, true, 60),
  ]);

  assert.deepEqual(claims.sort(), [false, true]);
});
