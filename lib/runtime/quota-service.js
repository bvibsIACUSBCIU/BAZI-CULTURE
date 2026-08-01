/**
 * Points Quota & Newcomer Check-in Task Service
 * Manages quota balance (default 1580 Free points) and newcomer check-in progress (3/5).
 */

export class QuotaService {
  constructor() {
    // quotaMap: Map<userKey, QuotaRecord>
    // QuotaRecord: { points: 1580, checkinTaskProgress: 3, totalCheckinDays: 5, checkedInToday: false, lastCheckinTime: null }
    this.quotaMap = new Map();
    this.DEFAULT_POINTS = 1580;
    this.DEFAULT_CHECKIN_PROGRESS = 3;
    this.TOTAL_CHECKIN_DAYS = 5;
    this.CHECKIN_REWARD_POINTS = 100;
  }

  _getKey(key) {
    return (key || 'default_user').toLowerCase();
  }

  /**
   * Get quota status for a user
   * @param {string} userKey 
   * @returns {{ points: number, checkinTaskProgress: number, totalCheckinDays: number, checkedInToday: boolean }}
   */
  getQuota(userKey = 'default_user') {
    const k = this._getKey(userKey);
    if (!this.quotaMap.has(k)) {
      this.quotaMap.set(k, {
        points: this.DEFAULT_POINTS,
        checkinTaskProgress: this.DEFAULT_CHECKIN_PROGRESS,
        totalCheckinDays: this.TOTAL_CHECKIN_DAYS,
        checkedInToday: false,
        lastCheckinTime: null
      });
    }
    const record = this.quotaMap.get(k);
    return {
      points: record.points,
      checkinTaskProgress: record.checkinTaskProgress,
      totalCheckinDays: record.totalCheckinDays,
      checkedInToday: record.checkedInToday
    };
  }

  /**
   * Perform daily check-in
   * @param {string} userKey 
   * @returns {{ points: number, checkinTaskProgress: number, totalCheckinDays: number, checkedInToday: boolean, rewardPoints: number }}
   */
  performCheckin(userKey = 'default_user') {
    const k = this._getKey(userKey);
    const quota = this.getQuota(k);
    const record = this.quotaMap.get(k);

    if (record.checkedInToday) {
      const err = new Error('ALREADY_CHECKED_IN');
      err.code = 'ALREADY_CHECKED_IN';
      err.details = '今日已完成打卡，请明天再来。';
      throw err;
    }

    if (record.checkinTaskProgress < record.totalCheckinDays) {
      record.checkinTaskProgress += 1;
    }
    record.points += this.CHECKIN_REWARD_POINTS;
    record.checkedInToday = true;
    record.lastCheckinTime = new Date().toISOString();

    return {
      points: record.points,
      checkinTaskProgress: record.checkinTaskProgress,
      totalCheckinDays: record.totalCheckinDays,
      checkedInToday: true,
      rewardPoints: this.CHECKIN_REWARD_POINTS
    };
  }

  /**
   * Deduct points for analysis or service usage
   * @param {string} userKey 
   * @param {number} amount 
   * @returns {{ points: number }}
   */
  deductPoints(userKey = 'default_user', amount = 10) {
    const k = this._getKey(userKey);
    const record = this.quotaMap.get(k) || this.getQuota(k);
    if (record.points < amount) {
      const err = new Error('INSUFFICIENT_POINTS');
      err.code = 'INSUFFICIENT_POINTS';
      err.details = `积分不足，剩余 ${record.points} 点，需要 ${amount} 点。`;
      throw err;
    }
    record.points -= amount;
    return { points: record.points };
  }
}

export const defaultQuotaService = new QuotaService();
