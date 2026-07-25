// Fixed-window limits protect both Telegram and the public AI endpoint.
export class RateLimitError extends Error {
  constructor(message = "请求过于频繁，请稍后再试。") {
    super(message);
    this.name = "RateLimitError";
    this.code = "RATE_LIMITED";
  }
}

export class FixedWindowRateLimiter {
  constructor({ store, scope, limit, windowSeconds }) {
    this.store = store;
    this.scope = scope;
    this.limit = limit;
    this.windowSeconds = windowSeconds;
  }

  async consume(identity) {
    const bucket = Math.floor(Date.now() / (this.windowSeconds * 1000));
    const count = await this.store.increment(
      this.scope,
      `${identity}:${bucket}`,
      this.windowSeconds + 5,
    );
    if (count > this.limit) throw new RateLimitError();
    return { remaining: Math.max(0, this.limit - count) };
  }
}
