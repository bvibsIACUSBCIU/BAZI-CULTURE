import { DatabaseSync } from 'node:sqlite';

export function createD1TestDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');

  return {
    exec(sql) {
      sqlite.exec(sql);
      return Promise.resolve();
    },
    prepare(sql) {
      return new TestD1Statement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      sqlite.close();
    },
  };
}

class TestD1Statement {
  constructor(sqlite, sql, values = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.sqlite, this.sql, values);
  }

  async run() {
    const statement = this.sqlite.prepare(this.sql);
    statement.run(...this.values);
    return { success: true, meta: { changes: this.sqlite.prepare('SELECT changes() AS changes').get().changes } };
  }

  async first() {
    return this.sqlite.prepare(this.sql).get(...this.values) ?? null;
  }

  async all() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.values) };
  }
}
