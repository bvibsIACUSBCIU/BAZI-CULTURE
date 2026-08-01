import assert from "node:assert/strict";
import test from "node:test";
import quotaHandler from "./quota.js";

test("Quota API - GET returns default 1580 points and 3/5 progress", async () => {
  const req = {
    method: "GET",
    url: "http://localhost/api/quota?wallet=test_quota_1",
    headers: new Map()
  };

  const response = await quotaHandler(req);
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.equal(data.points, 1580);
  assert.equal(data.checkinTaskProgress, 3);
  assert.equal(data.totalCheckinDays, 5);
  assert.equal(data.checkedInToday, false);
});

test("Quota API - POST checkin increases progress and points reward", async () => {
  const req = {
    method: "POST",
    url: "http://localhost/api/quota?wallet=test_quota_checkin",
    headers: new Map(),
    body: {
      action: "checkin"
    }
  };

  const response = await quotaHandler(req);
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.equal(data.checkinTaskProgress, 4);
  assert.equal(data.points, 1680);
  assert.equal(data.checkedInToday, true);

  // Attempt duplicate checkin
  const dupResponse = await quotaHandler(req);
  const dupData = await dupResponse.json();
  assert.equal(dupData.ok, false);
  assert.equal(dupData.error, "ALREADY_CHECKED_IN");
});
