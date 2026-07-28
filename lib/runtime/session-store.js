import { getEnv } from "./env.js";

// Shared storage primitives live outside api/ so Vercel does not deploy them as routes.

const DEFAULT_SESSION_TTL_SECONDS = 6 * 60 * 60;
const memoryRecords = new Map();

export function createSessionStore({
  redisUrl =
    getEnv().UPSTASH_REDIS_REST_URL || getEnv().KV_REST_API_URL,
  redisToken =
    getEnv().UPSTASH_REDIS_REST_TOKEN || getEnv().KV_REST_API_TOKEN,
  namespace = getEnv().SESSION_NAMESPACE || "liangyi-mvp",
  defaultTtlSeconds = numberFromEnv(
    getEnv().SESSION_TTL_SECONDS,
    DEFAULT_SESSION_TTL_SECONDS,
  ),
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  if (redisUrl && redisToken) {
    return new RedisSessionStore({
      redisUrl,
      redisToken,
      namespace,
      defaultTtlSeconds,
      fetchImpl,
    });
  }
  return new MemorySessionStore({ namespace, defaultTtlSeconds, now });
}

export class MemorySessionStore {
  constructor({
    namespace = "liangyi-mvp",
    defaultTtlSeconds = DEFAULT_SESSION_TTL_SECONDS,
    now = () => Date.now(),
  } = {}) {
    this.namespace = namespace;
    this.defaultTtlSeconds = defaultTtlSeconds;
    this.now = now;
    this.mode = "memory";
  }

  async get(scope, identity) {
    const key = this.key(scope, identity);
    const record = memoryRecords.get(key);
    if (!record) return null;
    if (record.expiresAt <= this.now()) {
      memoryRecords.delete(key);
      return null;
    }
    return clone(record.value);
  }

  async set(scope, identity, value, ttlSeconds = this.defaultTtlSeconds) {
    memoryRecords.set(this.key(scope, identity), {
      value: clone(value),
      expiresAt: this.now() + ttlSeconds * 1000,
    });
  }

  async delete(scope, identity) {
    memoryRecords.delete(this.key(scope, identity));
  }

  async setIfAbsent(scope, identity, value, ttlSeconds) {
    const key = this.key(scope, identity);
    const existing = memoryRecords.get(key);
    if (existing && existing.expiresAt > this.now()) return false;
    memoryRecords.set(key, {
      value: clone(value),
      expiresAt: this.now() + ttlSeconds * 1000,
    });
    return true;
  }

  async increment(scope, identity, ttlSeconds) {
    const key = this.key(scope, identity);
    const existing = memoryRecords.get(key);
    const current =
      Number(existing && existing.expiresAt > this.now() ? existing.value : 0) + 1;
    memoryRecords.set(key, {
      value: current,
      expiresAt: this.now() + ttlSeconds * 1000,
    });
    return current;
  }

  key(scope, identity) {
    return `${this.namespace}:${scope}:${hashIdentity(identity)}`;
  }
}

export class RedisSessionStore {
  constructor({
    redisUrl,
    redisToken,
    namespace,
    defaultTtlSeconds,
    fetchImpl,
  }) {
    this.redisUrl = String(redisUrl).replace(/\/+$/u, "");
    this.redisToken = redisToken;
    this.namespace = namespace;
    this.defaultTtlSeconds = defaultTtlSeconds;
    this.fetchImpl = fetchImpl;
    this.mode = "redis";
  }

  async get(scope, identity) {
    const result = await this.command(["GET", this.key(scope, identity)]);
    return result === null ? null : JSON.parse(result);
  }

  async set(scope, identity, value, ttlSeconds = this.defaultTtlSeconds) {
    await this.command([
      "SET",
      this.key(scope, identity),
      JSON.stringify(value),
      "EX",
      ttlSeconds,
    ]);
  }

  async delete(scope, identity) {
    await this.command(["DEL", this.key(scope, identity)]);
  }

  async setIfAbsent(scope, identity, value, ttlSeconds) {
    const result = await this.command([
      "SET",
      this.key(scope, identity),
      JSON.stringify(value),
      "EX",
      ttlSeconds,
      "NX",
    ]);
    return result === "OK";
  }

  async increment(scope, identity, ttlSeconds) {
    const key = this.key(scope, identity);
    const result = await this.pipeline([
      ["INCR", key],
      ["EXPIRE", key, ttlSeconds],
    ]);
    return Number(result[0]);
  }

  key(scope, identity) {
    return `${this.namespace}:${scope}:${hashIdentity(identity)}`;
  }

  async command(command) {
    const response = await this.fetchImpl(this.redisUrl, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      throw new Error("Session storage is temporarily unavailable");
    }
    return payload.result;
  }

  async pipeline(commands) {
    const response = await this.fetchImpl(`${this.redisUrl}/pipeline`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(payload)) {
      throw new Error("Session storage is temporarily unavailable");
    }
    const failed = payload.find((item) => item?.error);
    if (failed) throw new Error("Session storage is temporarily unavailable");
    return payload.map((item) => item.result);
  }

  headers() {
    return {
      Authorization: `Bearer ${this.redisToken}`,
      "Content-Type": "application/json",
    };
  }
}

function hashIdentity(identity) {
  let hash = 2166136261;
  const value = String(identity);
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(4).slice(0, 32);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function numberFromEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
