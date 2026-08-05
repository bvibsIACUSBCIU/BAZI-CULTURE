/**
 * Session History & Bookmark Management Service
 * Manages chat sessions, historical dialogue flow, and starred bookmarks.
 */

export class SessionHistoryService {
  constructor() {
    // sessionsMap: Map<userKey, Array<Session>>
    this.sessionsMap = new Map();
    // Default initial demo sessions
    this.defaultSessions = [
      {
        id: 'sess-001',
        profileId: 'prof-hanli',
        profileName: '韩立',
        title: '八字详批 - 庚午年格局分析',
        topic: 'overview',
        timestamp: '2026-07-30T10:15:00.000Z',
        bookmarked: true,
        summary: '日主偏旺，食伤吐秀，官星调候。'
      },
      {
        id: 'sess-002',
        profileId: 'prof-hanli',
        profileName: '韩立',
        title: '事业运势 - 丙午流年推演',
        topic: 'career',
        timestamp: '2026-07-31T14:20:00.000Z',
        bookmarked: false,
        summary: '事业官印相生，宜积极进取。'
      }
    ];
  }

  _getKey(key) {
    return (key || 'default_user').toLowerCase();
  }

  /**
   * Get all sessions for a user, optionally filtered by profileId
   * @param {string} walletAddress 
   * @param {string} [profileId] 
   * @returns {Array<Session>}
   */
  getSessions(walletAddress = 'default_user', profileId = null) {
    const k = this._getKey(walletAddress);
    if (!this.sessionsMap.has(k)) {
      this.sessionsMap.set(k, this.defaultSessions.map(s => ({ ...s })));
    }
    const list = this.sessionsMap.get(k);
    if (profileId) {
      return list.filter(s => s.profileId === profileId);
    }
    return list;
  }

  /**
   * Get bookmarked sessions for a user
   * @param {string} walletAddress 
   * @returns {Array<Session>}
   */
  getBookmarks(walletAddress = 'default_user') {
    const sessions = this.getSessions(walletAddress);
    return sessions.filter(s => s.bookmarked);
  }

  /**
   * Toggle bookmark state of a session
   * @param {string} walletAddress 
   * @param {string} sessionId 
   * @returns {Session}
   */
  toggleBookmark(walletAddress = 'default_user', sessionId) {
    const sessions = this.getSessions(walletAddress);
    const target = sessions.find(s => s.id === sessionId);
    if (!target) {
      const err = new Error('SESSION_NOT_FOUND');
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }
    target.bookmarked = !target.bookmarked;
    return target;
  }

  /**
   * Add a new session
   * @param {string} walletAddress 
   * @param {Object} sessionData 
   * @returns {string} sessionId
   */
  addSession(walletAddress = 'default_user', sessionData) {
    if (!sessionData || !sessionData.title) {
      const err = new Error('INVALID_SESSION_DATA');
      err.code = 'INVALID_SESSION_DATA';
      throw err;
    }

    const sessions = this.getSessions(walletAddress);
    const newSession = {
      id: `sess-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      profileId: sessionData.profileId || 'prof-hanli',
      profileName: sessionData.profileName || '韩立',
      title: String(sessionData.title).trim(),
      topic: sessionData.topic || 'overview',
      timestamp: new Date().toISOString(),
      bookmarked: Boolean(sessionData.bookmarked),
      summary: sessionData.summary || ''
    };

    sessions.unshift(newSession); // top of list
    return newSession.id;
  }
}

export const defaultSessionHistoryService = new SessionHistoryService();
