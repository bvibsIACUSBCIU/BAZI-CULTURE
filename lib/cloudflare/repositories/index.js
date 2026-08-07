export function createRepositories(db, { now = () => new Date().toISOString(), createId = defaultCreateId } = {}) {
  const users = createUserRepository(db, { now, createId });
  const profiles = createProfileRepository(db, { now, createId });
  const conversations = createConversationRepository(db, { now, createId });
  const preferences = createPreferenceRepository(db, { now });
  const credits = createCreditRepository(db, { now, createId });
  const sessions = createSessionRepository(db, { now, createId });

  return { users, profiles, conversations, preferences, credits, sessions };
}

function createUserRepository(db, { now, createId }) {
  return {
    async findOrCreate(walletAddress, { username = null } = {}) {
      const normalizedWallet = normalizeWallet(walletAddress);
      const existing = await db.prepare(
        'SELECT id, wallet_address, username, created_at, updated_at, status FROM users WHERE wallet_address = ?',
      ).bind(normalizedWallet).first();
      if (existing) return mapUser(existing);

      const timestamp = now();
      const user = {
        id: createId('usr'),
        walletAddress: normalizedWallet,
        username: normalizeUsername(username),
        createdAt: timestamp,
        updatedAt: timestamp,
        status: 'active',
      };
      await db.prepare(
        'INSERT INTO users (id, wallet_address, username, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(user.id, user.walletAddress, user.username, user.createdAt, user.updatedAt, user.status).run();
      return user;
    },

    async findByWallet(walletAddress) {
      const row = await db.prepare(
        'SELECT id, wallet_address, username, created_at, updated_at, status FROM users WHERE wallet_address = ?',
      ).bind(normalizeWallet(walletAddress)).first();
      return row ? mapUser(row) : null;
    },
  };
}

function createProfileRepository(db, { now, createId }) {
  return {
    async create(userId, input) {
      const timestamp = now();
      const profile = {
        id: createId('pro'),
        userId,
        name: boundedText(input.name, '新命主', 80),
        date: validDate(input.date),
        time: validTime(input.time),
        gender: input.gender === 'female' ? 'female' : 'male',
        timeKnown: input.timeKnown !== false,
        birthplace: boundedText(input.birthplace, '', 120),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.prepare(
        'INSERT INTO profiles (id, user_id, name, birth_date, birth_time, gender, time_known, birthplace, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        profile.id, profile.userId, profile.name, profile.date, profile.time, profile.gender,
        profile.timeKnown ? 1 : 0, profile.birthplace, profile.createdAt, profile.updatedAt,
      ).run();
      return profile;
    },

    async findById(userId, profileId) {
      const row = await db.prepare(
        'SELECT id, user_id, name, birth_date, birth_time, gender, time_known, birthplace, created_at, updated_at FROM profiles WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      ).bind(profileId, userId).first();
      return row ? mapProfile(row) : null;
    },

    async list(userId) {
      const result = await db.prepare(
        'SELECT id, user_id, name, birth_date, birth_time, gender, time_known, birthplace, created_at, updated_at FROM profiles WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC',
      ).bind(userId).all();
      return result.results.map(mapProfile);
    },

    async remove(userId, profileId) {
      const result = await db.prepare(
        'UPDATE profiles SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      ).bind(now(), now(), profileId, userId).run();
      return result.meta.changes > 0;
    },
  };
}

function createConversationRepository(db, { now, createId }) {
  return {
    async create(userId, input) {
      const timestamp = now();
      const conversation = {
        id: createId('con'),
        userId,
        profileId: input.profileId || null,
        requestId: boundedText(input.requestId, createId('req'), 120),
        title: boundedText(input.title, '新对话', 160),
        question: boundedText(input.question, '', 4_000),
        topic: boundedText(input.topic, 'overview', 80),
        bookmarked: false,
        generationStatus: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (conversation.profileId) {
        const profile = await db.prepare(
          'SELECT id FROM profiles WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
        ).bind(conversation.profileId, userId).first();
        if (!profile) throw codedError('PROFILE_NOT_FOUND');
      }
      await db.prepare(
        'INSERT INTO conversations (id, user_id, profile_id, request_id, title, question, topic, bookmarked, generation_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        conversation.id, conversation.userId, conversation.profileId, conversation.requestId,
        conversation.title, conversation.question, conversation.topic, 0, conversation.generationStatus,
        conversation.createdAt, conversation.updatedAt,
      ).run();
      return conversation;
    },

    async findById(userId, conversationId) {
      const row = await db.prepare(
        'SELECT id, user_id, profile_id, request_id, title, question, topic, bookmarked, generation_status, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      ).bind(conversationId, userId).first();
      return row ? mapConversation(row) : null;
    },

    async findByRequestId(userId, requestId) {
      const row = await db.prepare(
        'SELECT id, user_id, profile_id, request_id, title, question, topic, bookmarked, generation_status, created_at, updated_at FROM conversations WHERE user_id = ? AND request_id = ? AND deleted_at IS NULL',
      ).bind(userId, requestId).first();
      return row ? mapConversation(row) : null;
    },

    async list(userId) {
      const result = await db.prepare(
        'SELECT id, user_id, profile_id, request_id, title, question, topic, bookmarked, generation_status, created_at, updated_at FROM conversations WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC',
      ).bind(userId).all();
      return result.results.map(mapConversation);
    },

    async remove(userId, conversationId) {
      const timestamp = now();
      const result = await db.prepare(
        'UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      ).bind(timestamp, timestamp, conversationId, userId).run();
      return result.meta.changes > 0;
    },

    async toggleBookmark(userId, conversationId) {
      const conversation = await this.findById(userId, conversationId);
      if (!conversation) return null;
      const bookmarked = !conversation.bookmarked;
      await db.prepare(
        'UPDATE conversations SET bookmarked = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      ).bind(bookmarked ? 1 : 0, now(), conversationId, userId).run();
      return { ...conversation, bookmarked, updatedAt: now() };
    },
  };
}

function createPreferenceRepository(db, { now }) {
  return {
    async get(userId) {
      const row = await db.prepare(
        'SELECT active_profile_id, settings_json FROM user_preferences WHERE user_id = ?',
      ).bind(userId).first();
      return row ? { activeProfileId: row.active_profile_id, settings: parseJsonObject(row.settings_json) } : { activeProfileId: null, settings: {} };
    },

    async save(userId, { activeProfileId = null, settings = {} }) {
      const serializedSettings = JSON.stringify(normalizeSettings(settings));
      await db.prepare(
        'INSERT INTO user_preferences (user_id, active_profile_id, settings_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET active_profile_id = excluded.active_profile_id, settings_json = excluded.settings_json, updated_at = excluded.updated_at',
      ).bind(userId, activeProfileId, serializedSettings, now()).run();
      return { activeProfileId, settings: parseJsonObject(serializedSettings) };
    },
  };
}

function createCreditRepository(db, { now, createId }) {
  return {
    async getBalance(userId) {
      const row = await db.prepare(
        'SELECT balance_after FROM credit_ledger WHERE user_id = ? ORDER BY rowid DESC LIMIT 1',
      ).bind(userId).first();
      return row ? Number(row.balance_after) : 0;
    },

    async countByIdempotencyKey(userId, idempotencyKey) {
      const row = await db.prepare(
        'SELECT COUNT(*) AS count FROM credit_ledger WHERE user_id = ? AND idempotency_key = ?',
      ).bind(userId, idempotencyKey).first();
      return Number(row.count);
    },

    async recordOnce({ userId, amount, reason, idempotencyKey }) {
      const existing = await db.prepare(
        'SELECT balance_after FROM credit_ledger WHERE user_id = ? AND idempotency_key = ?',
      ).bind(userId, idempotencyKey).first();
      if (existing) return { balance: Number(existing.balance_after), replayed: true };

      const currentBalance = await this.getBalance(userId);
      const normalizedAmount = Number(amount);
      if (!Number.isInteger(normalizedAmount) || normalizedAmount === 0) throw codedError('INVALID_CREDIT_AMOUNT');
      const nextBalance = currentBalance + normalizedAmount;
      if (nextBalance < 0) throw codedError('INSUFFICIENT_CREDITS');
      await db.prepare(
        'INSERT INTO credit_ledger (id, user_id, amount, reason, idempotency_key, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(createId('led'), userId, normalizedAmount, boundedText(reason, 'adjustment', 80), boundedText(idempotencyKey, '', 160), nextBalance, now()).run();
      return { balance: nextBalance, replayed: false };
    },
  };
}

function createSessionRepository(db, { now, createId }) {
  return {
    async create({ userId, secretHash, expiresAt, userAgentHash = null, ipHash = null }) {
      const timestamp = now();
      const session = { id: createId('ses'), userId, secretHash, createdAt: timestamp, expiresAt, lastSeenAt: timestamp, revokedAt: null };
      await db.prepare(
        'INSERT INTO auth_sessions (id, user_id, secret_hash, created_at, expires_at, last_seen_at, user_agent_hash, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(session.id, session.userId, session.secretHash, session.createdAt, session.expiresAt, session.lastSeenAt, userAgentHash, ipHash).run();
      return session;
    },

    async findActiveByHash(secretHash, at = now()) {
      const row = await db.prepare(
        'SELECT auth_sessions.id, auth_sessions.user_id, auth_sessions.secret_hash, auth_sessions.created_at, auth_sessions.expires_at, auth_sessions.last_seen_at, users.wallet_address FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id WHERE auth_sessions.secret_hash = ? AND auth_sessions.revoked_at IS NULL AND auth_sessions.expires_at > ? AND users.status = \'active\'',
      ).bind(secretHash, at).first();
      return row ? {
        id: row.id, userId: row.user_id, secretHash: row.secret_hash, createdAt: row.created_at,
        expiresAt: row.expires_at, lastSeenAt: row.last_seen_at, walletAddress: row.wallet_address,
      } : null;
    },

    async revoke(secretHash) {
      const result = await db.prepare(
        'UPDATE auth_sessions SET revoked_at = ? WHERE secret_hash = ? AND revoked_at IS NULL',
      ).bind(now(), secretHash).run();
      return result.meta.changes > 0;
    },
  };
}

function mapUser(row) {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
  };
}

function mapProfile(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    date: row.birth_date,
    time: row.birth_time,
    gender: row.gender,
    timeKnown: Boolean(row.time_known),
    birthplace: row.birthplace,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConversation(row) {
  return {
    id: row.id,
    userId: row.user_id,
    profileId: row.profile_id,
    requestId: row.request_id,
    title: row.title,
    question: row.question,
    topic: row.topic,
    bookmarked: Boolean(row.bookmarked),
    generationStatus: row.generation_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    timestamp: row.created_at,
  };
}

function normalizeWallet(walletAddress) {
  const value = String(walletAddress || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{1,64}$/u.test(value)) throw codedError('INVALID_WALLET_ADDRESS');
  return value;
}

function normalizeUsername(username) {
  if (username === null || username === undefined || username === '') return null;
  return boundedText(username, '', 40);
}

function boundedText(value, fallback, maximum) {
  const normalized = String(value ?? fallback).trim();
  if (!normalized) return fallback;
  if (normalized.length > maximum) throw codedError('INPUT_TOO_LONG');
  return normalized;
}

function validDate(value) {
  const date = String(value || '1995-01-01');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw codedError('INVALID_PROFILE_DATE');
  return date;
}

function validTime(value) {
  const time = String(value || '12:00');
  if (!/^\d{2}:\d{2}$/u.test(time)) throw codedError('INVALID_PROFILE_TIME');
  return time;
}

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw codedError('INVALID_PREFERENCES');
  const serialized = JSON.stringify(value);
  if (serialized.length > 20_000) throw codedError('INPUT_TOO_LONG');
  return JSON.parse(serialized);
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function defaultCreateId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}
