export function createRepositories(db, { now = () => new Date().toISOString(), createId = defaultCreateId } = {}) {
  const users = createUserRepository(db, { now, createId });
  const profiles = createProfileRepository(db, { now, createId });
  const conversations = createConversationRepository(db, { now, createId });
  const messages = createMessageRepository(db, { now, createId });
  const preferences = createPreferenceRepository(db, { now });
  const credits = createCreditRepository(db, { now, createId });
  const sessions = createSessionRepository(db, { now, createId });
  const hasReportVersions = createReportVersionSchemaCheck(db);
  const reportVersions = createReportVersionRepository(db, { now, createId });
  const reports = createReportRepository(db, { now, createId, hasReportVersions, reportVersions });
  const checkins = createCheckinRepository(db, { now });

  return { users, profiles, conversations, messages, preferences, credits, sessions, reports, reportVersions, checkins };
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
  async function requireOwnedProfile(userId, profileId) {
    if (!profileId) return null;
    const profile = await db.prepare(
      'SELECT id FROM profiles WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    ).bind(profileId, userId).first();
    if (!profile) throw codedError('PROFILE_NOT_FOUND');
    return profile;
  }

  async function insert(userId, input) {
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
    await requireOwnedProfile(userId, conversation.profileId);
    await db.prepare(
      'INSERT INTO conversations (id, user_id, profile_id, request_id, title, question, topic, bookmarked, generation_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      conversation.id, conversation.userId, conversation.profileId, conversation.requestId,
      conversation.title, conversation.question, conversation.topic, 0, conversation.generationStatus,
      conversation.createdAt, conversation.updatedAt,
    ).run();
    return conversation;
  }

  return {
    async create(userId, input) {
      return insert(userId, input);
    },

    async createForTurn(userId, input) {
      return insert(userId, input);
    },

    async appendTurn(userId, conversationId, input) {
      const conversation = await this.findById(userId, conversationId);
      if (!conversation) throw codedError('SESSION_NOT_FOUND');
      await requireOwnedProfile(userId, input.profileId);
      if (conversation.profileId && input.profileId && conversation.profileId !== input.profileId) {
        throw codedError('PROFILE_MISMATCH');
      }
      const timestamp = now();
      const requestId = boundedText(input.requestId, createId('req'), 120);
      const question = boundedText(input.question, '', 4_000);
      const topic = boundedText(input.topic, conversation.topic || 'overview', 80);
      await db.prepare(
        'UPDATE conversations SET request_id = ?, question = ?, topic = ?, generation_status = \'pending\', updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      ).bind(requestId, question, topic, timestamp, conversationId, userId).run();
      return { ...conversation, requestId, question, topic, generationStatus: 'pending', updatedAt: timestamp };
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

function createMessageRepository(db, { now, createId }) {
  return {
    async append(userId, conversationId, role, content) {
      const conversation = await db.prepare(
        'SELECT id FROM conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      ).bind(conversationId, userId).first();
      if (!conversation) throw codedError('SESSION_NOT_FOUND');
      if (!['user', 'assistant', 'system'].includes(role)) throw codedError('INVALID_MESSAGE_ROLE');
      const next = await db.prepare(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM conversation_messages WHERE conversation_id = ?',
      ).bind(conversationId).first();
      const message = {
        id: createId('msg'),
        conversationId,
        sequence: Number(next.sequence),
        role,
        content: boundedText(content, '', 120_000),
        createdAt: now(),
      };
      await db.prepare(
        'INSERT INTO conversation_messages (id, conversation_id, sequence, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(message.id, message.conversationId, message.sequence, message.role, message.content, message.createdAt).run();
      return message;
    },

    async list(userId, conversationId) {
      const result = await db.prepare(
        'SELECT conversation_messages.id, conversation_messages.conversation_id, conversation_messages.sequence, conversation_messages.role, conversation_messages.content, conversation_messages.created_at FROM conversation_messages JOIN conversations ON conversations.id = conversation_messages.conversation_id WHERE conversations.user_id = ? AND conversation_messages.conversation_id = ? AND conversations.deleted_at IS NULL ORDER BY conversation_messages.sequence ASC',
      ).bind(userId, conversationId).all();
      return result.results.map(mapMessage);
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

function createReportVersionSchemaCheck(db) {
  let present;
  return async () => {
    if (!present) {
      present = db.prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'report_versions'",
      ).first().then(Boolean);
    }
    return present;
  };
}

function createReportVersionRepository(db, { now, createId }) {
  async function requireOwnedConversation(userId, conversationId) {
    const conversation = await db.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    ).bind(conversationId, userId).first();
    if (!conversation) throw codedError('SESSION_NOT_FOUND');
  }

  return {
    async findLatest(userId, conversationId) {
      const row = await db.prepare(
        'SELECT report_versions.id, report_versions.conversation_id, report_versions.version_number, report_versions.summary, report_versions.report_markdown, report_versions.chart_summary, report_versions.chart_json, report_versions.completed_at FROM report_versions JOIN conversations ON conversations.id = report_versions.conversation_id WHERE report_versions.user_id = ? AND report_versions.conversation_id = ? AND conversations.deleted_at IS NULL ORDER BY report_versions.version_number DESC LIMIT 1',
      ).bind(userId, conversationId).first();
      return row ? mapReport(row) : null;
    },

    async listByConversation(userId, conversationId) {
      const result = await db.prepare(
        'SELECT report_versions.id, report_versions.conversation_id, report_versions.version_number, report_versions.summary, report_versions.report_markdown, report_versions.chart_summary, report_versions.chart_json, report_versions.completed_at FROM report_versions JOIN conversations ON conversations.id = report_versions.conversation_id WHERE report_versions.user_id = ? AND report_versions.conversation_id = ? AND conversations.deleted_at IS NULL ORDER BY report_versions.version_number ASC',
      ).bind(userId, conversationId).all();
      return result.results.map(mapReport);
    },

    async complete(userId, conversationId, { summary = '', reportMarkdown = '', chartSummary = '', chart = {}, topic = 'overview' }) {
      await requireOwnedConversation(userId, conversationId);
      const next = await db.prepare(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number FROM report_versions WHERE conversation_id = ?',
      ).bind(conversationId).first();
      const timestamp = now();
      const report = {
        id: createId('rep'),
        conversationId,
        userId,
        versionNumber: Number(next.version_number),
        summary: boundedText(summary, '', 20_000),
        reportMarkdown: boundedText(reportMarkdown, '', 120_000),
        chartSummary: boundedText(chartSummary, '', 2_000),
        chart: chart || {},
        completedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.prepare(
        'INSERT INTO report_versions (id, conversation_id, user_id, version_number, summary, report_markdown, chart_summary, chart_json, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        report.id, report.conversationId, report.userId, report.versionNumber, report.summary, report.reportMarkdown,
        report.chartSummary, JSON.stringify(report.chart), report.completedAt, report.createdAt, report.updatedAt,
      ).run();
      await db.prepare(
        'UPDATE conversations SET generation_status = \'complete\', topic = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      ).bind(boundedText(topic, 'overview', 80), timestamp, conversationId, userId).run();
      return report;
    },
  };
}

function createReportRepository(db, { now, createId, hasReportVersions, reportVersions }) {
  async function findLegacy(userId, conversationId) {
    const row = await db.prepare(
      'SELECT reports.id, reports.conversation_id, reports.summary, reports.report_markdown, reports.chart_summary, reports.chart_json, reports.completed_at FROM reports JOIN conversations ON conversations.id = reports.conversation_id WHERE reports.user_id = ? AND reports.conversation_id = ? AND conversations.deleted_at IS NULL',
    ).bind(userId, conversationId).first();
    return row ? mapReport(row) : null;
  }

  return {
    async findByConversation(userId, conversationId) {
      if (await hasReportVersions()) return reportVersions.findLatest(userId, conversationId);
      return findLegacy(userId, conversationId);
    },

    async listByConversation(userId, conversationId) {
      if (await hasReportVersions()) return reportVersions.listByConversation(userId, conversationId);
      const report = await findLegacy(userId, conversationId);
      return report ? [report] : [];
    },

    async complete(userId, conversationId, { summary = '', reportMarkdown = '', chartSummary = '', chart = {}, topic = 'overview' }) {
      if (await hasReportVersions()) {
        return reportVersions.complete(userId, conversationId, { summary, reportMarkdown, chartSummary, chart, topic });
      }
      const conversation = await db.prepare(
        'SELECT id FROM conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      ).bind(conversationId, userId).first();
      if (!conversation) throw codedError('SESSION_NOT_FOUND');
      const timestamp = now();
      await db.prepare(
        'INSERT INTO reports (id, conversation_id, user_id, summary, report_markdown, chart_summary, chart_json, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET summary = excluded.summary, report_markdown = excluded.report_markdown, chart_summary = excluded.chart_summary, chart_json = excluded.chart_json, completed_at = excluded.completed_at, updated_at = excluded.updated_at',
      ).bind(
        createId('rep'), conversationId, userId, boundedText(summary, '', 20_000), boundedText(reportMarkdown, '', 120_000),
        boundedText(chartSummary, '', 2_000), JSON.stringify(chart || {}), timestamp, timestamp, timestamp,
      ).run();
      await db.prepare(
        'UPDATE conversations SET generation_status = \'complete\', topic = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      ).bind(boundedText(topic, 'overview', 80), timestamp, conversationId, userId).run();
      return this.findByConversation(userId, conversationId);
    },

    async fail(userId, conversationId) {
      await db.prepare(
        'UPDATE conversations SET generation_status = \'failed\', updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      ).bind(now(), conversationId, userId).run();
    },
  };
}

function createCheckinRepository(db, { now }) {
  return {
    async getStatus(userId, date = today(now())) {
      const [todayRecord, count] = await Promise.all([
        db.prepare('SELECT user_id FROM daily_checkins WHERE user_id = ? AND checkin_date = ?').bind(userId, date).first(),
        db.prepare('SELECT COUNT(*) AS count FROM daily_checkins WHERE user_id = ?').bind(userId).first(),
      ]);
      return { checkedInToday: Boolean(todayRecord), totalCheckinDays: Number(count.count) };
    },

    async recordToday(userId, rewardPoints, date = today(now())) {
      try {
        await db.prepare(
          'INSERT INTO daily_checkins (user_id, checkin_date, reward_points, created_at) VALUES (?, ?, ?, ?)',
        ).bind(userId, date, rewardPoints, now()).run();
        return true;
      } catch (error) {
        if (/UNIQUE|constraint/u.test(String(error.message || ''))) return false;
        throw error;
      }
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

function mapReport(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    versionNumber: row.version_number === undefined ? 1 : Number(row.version_number),
    summary: row.summary,
    reportMarkdown: row.report_markdown,
    chartSummary: row.chart_summary,
    chart: parseJsonObject(row.chart_json),
    completedAt: row.completed_at,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequence: Number(row.sequence),
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
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

function today(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}
