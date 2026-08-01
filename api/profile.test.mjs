import assert from "node:assert/strict";
import test from "node:test";
import profileHandler from "./profile.js";
import { defaultProfileService } from "../lib/runtime/profile-service.js";

test("Profile API - GET returns default profile containing 韩立", async () => {
  const req = {
    method: "GET",
    url: "http://localhost/api/profile?wallet=test_wallet_1",
    headers: new Map()
  };

  const response = await profileHandler(req);
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.profiles));
  assert.ok(data.profiles.some(p => p.name === "韩立"));
  assert.equal(data.activeProfile.name, "韩立");
});

test("Profile API - POST switch updates active profile", async () => {
  // First create a second profile
  const userKey = "test_wallet_switch";
  const newProf = defaultProfileService.addProfile(userKey, {
    name: "张三",
    date: "1995-10-20",
    time: "08:00",
    gender: "male"
  });

  const req = {
    method: "POST",
    url: "http://localhost/api/profile?wallet=test_wallet_switch",
    headers: new Map(),
    body: {
      action: "switch",
      profileId: newProf.id
    }
  };

  const response = await profileHandler(req);
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.equal(data.activeProfile.id, newProf.id);
  assert.equal(data.activeProfile.name, "张三");
});

test("Profile API - POST add creates new profile and sets active", async () => {
  const req = {
    method: "POST",
    url: "http://localhost/api/profile?wallet=test_wallet_add",
    headers: new Map(),
    body: {
      action: "add",
      name: "李四",
      date: "1988-03-12",
      time: "18:45",
      gender: "female"
    }
  };

  const response = await profileHandler(req);
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.equal(data.profile.name, "李四");
  assert.equal(data.profile.gender, "female");
  assert.equal(data.activeProfile.name, "李四");
});

test("Profile API - GET search filters profiles by name", async () => {
  const userKey = "test_wallet_search";
  defaultProfileService.addProfile(userKey, { name: "王五", date: "1992-01-01" });

  const req = {
    method: "GET",
    url: "http://localhost/api/profile?wallet=test_wallet_search&q=王",
    headers: new Map()
  };

  const response = await profileHandler(req);
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.equal(data.profiles.length, 1);
  assert.equal(data.profiles[0].name, "王五");
});
