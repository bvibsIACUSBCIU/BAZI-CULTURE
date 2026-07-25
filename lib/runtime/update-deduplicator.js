// Uses the configured store so update claims can span instances when Redis is enabled.
export class UpdateDeduplicator {
  constructor({ store, ttlSeconds = 24 * 60 * 60 }) {
    this.store = store;
    this.ttlSeconds = ttlSeconds;
  }

  async claim(updateId) {
    if (!Number.isInteger(updateId)) return true;
    return this.store.setIfAbsent(
      "telegram-update",
      updateId,
      { received: true },
      this.ttlSeconds,
    );
  }
}
