import crypto from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';

/**
 * 内存与持久化结合的账户与 IP 限流存储引擎
 */
export class AuthService {
  constructor() {
    // ipToWallets: Map<ipString, Set<walletAddress>>
    this.ipToWallets = new Map();
    // accounts: Map<walletAddress, AccountRecord>
    // AccountRecord: { walletAddress, createdAt, ip, masterProfile: null | Profile, credits: 100, usageCount: 0 }
    this.accounts = new Map();
    // activeChallenges: Map<challengeId, { walletAddress, challenge, expiresAt }>
    this.challenges = new Map();
    // usernameToWallets: Map<normalizedUsername, walletAddress>
    this.usernameToWallets = new Map();
  }

  /**
   * 生成登录挑战 Nonce (Challenge)
   * @param {string} walletAddress 
   * @returns {{ challengeId: string, challenge: string, expiresAt: number }}
   */
  generateChallenge(walletAddress, { operation, username, origin } = {}) {
    if (!walletAddress || typeof walletAddress !== 'string') {
      throw new Error('INVALID_WALLET_ADDRESS');
    }
    const cleanOperation = String(operation || '').toLowerCase();
    if (!['register', 'login'].includes(cleanOperation)) {
      const err = new Error('INVALID_AUTH_OPERATION');
      err.code = 'INVALID_AUTH_OPERATION';
      throw err;
    }
    const cleanUsername = this.normalizeUsername(username);
    const cleanOrigin = this.normalizeOrigin(origin);
    const cleanAddress = walletAddress.toLowerCase();
    const challengeId = crypto.randomUUID();
    const timestamp = Date.now();
    const challenge = `Tianfu-Bazi Auth Challenge\nOperation: ${cleanOperation.toUpperCase()}\nUsername: ${cleanUsername}\nWallet: ${cleanAddress}\nOrigin: ${cleanOrigin}\nNonce: ${challengeId}\nTimestamp: ${timestamp}`;
    const expiresAt = timestamp + 10 * 60 * 1000; // 10分钟有效

    this.challenges.set(challengeId, {
      walletAddress: cleanAddress,
      operation: cleanOperation,
      username: cleanUsername,
      origin: cleanOrigin,
      challenge,
      expiresAt
    });

    return { challengeId, challenge, expiresAt };
  }

  /**
   * 恢复或校验签名地址 (兼容以太坊 personal_sign 与标准校验)
   * @param {string} challengeId 
   * @param {string} walletAddress 
   * @param {string} signature 
   * @returns {boolean}
   */
  verifySignature(challengeId, walletAddress, signature, { operation, username, origin } = {}) {
    if (!challengeId || !walletAddress || !signature) {
      return false;
    }
    const record = this.challenges.get(challengeId);
    if (!record) {
      return false;
    }
    if (Date.now() > record.expiresAt) {
      this.challenges.delete(challengeId);
      return false;
    }
    if (record.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return false;
    }
    try {
      if (record.operation !== String(operation || '').toLowerCase()) return false;
      if (record.username !== this.normalizeUsername(username)) return false;
      if (record.origin !== this.normalizeOrigin(origin)) return false;
    } catch {
      return false;
    }

    let recoveredAddress;
    try {
      recoveredAddress = getAddress(verifyMessage(record.challenge, signature));
    } catch {
      return false;
    }

    if (recoveredAddress.toLowerCase() !== record.walletAddress) return false;

    // 校验通过后销毁使用过的 Challenge 保证防重放攻击
    this.challenges.delete(challengeId);
    return true;
  }

  /**
   * 执行钱包登录/注册
   * 同一个 IP 最多只允许创建 3 个钱包账户
   * @param {string} walletAddress 
   * @param {string} clientIp 
   * @returns {AccountRecord}
   */
  register(walletAddress, username, clientIp = '127.0.0.1') {
    const cleanAddress = walletAddress.toLowerCase();
    const cleanIp = clientIp || '127.0.0.1';
    const cleanUsername = this.normalizeUsername(username);
    const usernameKey = cleanUsername.toLocaleLowerCase();

    if (this.accounts.has(cleanAddress)) {
      const err = new Error('ACCOUNT_ALREADY_REGISTERED');
      err.code = 'ACCOUNT_ALREADY_REGISTERED';
      throw err;
    }
    if (this.usernameToWallets.has(usernameKey)) {
      const err = new Error('USERNAME_TAKEN');
      err.code = 'USERNAME_TAKEN';
      throw err;
    }

    // 新账户注册：检查 IP 下已绑定的钱包数量
    const registeredWallets = this.ipToWallets.get(cleanIp) || new Set();
    if (registeredWallets.size >= 3) {
      const err = new Error('IP_REGISTRATION_LIMIT_EXCEEDED');
      err.code = 'IP_REGISTRATION_LIMIT_EXCEEDED';
      err.details = `同一 IP (${cleanIp}) 最多只能创建 3 个钱包账户。`;
      throw err;
    }

    // 创建新账户
    const newAccount = {
      walletAddress: cleanAddress,
      registeredIp: cleanIp,
      createdAt: new Date().toISOString(),
      masterProfile: null, // 命主信息，只能设置一次或编辑唯一命主
      credits: 100,        // 默认赋能 100 AI 积分
      usageCount: 0,       // 使用次数统计
      username: cleanUsername
    };

    registeredWallets.add(cleanAddress);
    this.ipToWallets.set(cleanIp, registeredWallets);
    this.accounts.set(cleanAddress, newAccount);
    this.usernameToWallets.set(usernameKey, cleanAddress);

    return newAccount;
  }

  login(walletAddress, username) {
    const cleanAddress = walletAddress.toLowerCase();
    const cleanUsername = this.normalizeUsername(username);
    const account = this.accounts.get(cleanAddress);
    if (!account) {
      const err = new Error('ACCOUNT_NOT_FOUND');
      err.code = 'ACCOUNT_NOT_FOUND';
      throw err;
    }
    if (account.username !== cleanUsername) {
      const err = new Error('USERNAME_WALLET_MISMATCH');
      err.code = 'USERNAME_WALLET_MISMATCH';
      throw err;
    }
    return account;
  }

  normalizeUsername(username) {
    const cleanUsername = String(username || '').trim();
    if (!cleanUsername || cleanUsername.length > 40) {
      const err = new Error('INVALID_USERNAME');
      err.code = 'INVALID_USERNAME';
      throw err;
    }
    return cleanUsername;
  }

  normalizeOrigin(origin) {
    try {
      return new URL(String(origin || '')).origin;
    } catch {
      const err = new Error('INVALID_AUTH_ORIGIN');
      err.code = 'INVALID_AUTH_ORIGIN';
      throw err;
    }
  }

  /**
   * 设置或更新唯一命主 Profile (每个账户限制 1 个命主)
   * @param {string} walletAddress 
   * @param {{ name: string, gender: string, birthYear: number, birthMonth: number, birthDay: number, birthHour?: number, birthplace?: string }} profile 
   * @returns {AccountRecord}
   */
  setMasterProfile(walletAddress, profile) {
    const cleanAddress = walletAddress.toLowerCase();
    const account = this.accounts.get(cleanAddress);
    if (!account) {
      const err = new Error('ACCOUNT_NOT_FOUND');
      err.code = 'ACCOUNT_NOT_FOUND';
      throw err;
    }

    if (!profile || !profile.name || !profile.birthYear || !profile.birthMonth || !profile.birthDay) {
      const err = new Error('INVALID_MASTER_PROFILE');
      err.code = 'INVALID_MASTER_PROFILE';
      throw err;
    }

    account.masterProfile = {
      name: String(profile.name).trim(),
      gender: profile.gender === 'female' ? 'female' : 'male',
      birthYear: Number(profile.birthYear),
      birthMonth: Number(profile.birthMonth),
      birthDay: Number(profile.birthDay),
      birthHour: profile.birthHour !== undefined && profile.birthHour !== null ? Number(profile.birthHour) : null,
      birthplace: profile.birthplace ? String(profile.birthplace).trim() : ''
    };

    return account;
  }

  setUsername(walletAddress, username) {
    const account = this.getAccount(walletAddress);
    const cleanUsername = this.normalizeUsername(username);
    if (!account) {
      const err = new Error('INVALID_USERNAME');
      err.code = 'INVALID_USERNAME';
      throw err;
    }
    const usernameKey = cleanUsername.toLocaleLowerCase();
    const currentKey = account.username?.toLocaleLowerCase();
    const owner = this.usernameToWallets.get(usernameKey);
    if (owner && owner !== account.walletAddress) {
      const err = new Error('USERNAME_TAKEN');
      err.code = 'USERNAME_TAKEN';
      throw err;
    }
    if (currentKey && currentKey !== usernameKey) this.usernameToWallets.delete(currentKey);
    account.username = cleanUsername;
    this.usernameToWallets.set(usernameKey, account.walletAddress);
    return account;
  }

  /**
   * 消费 AI 对话积分（单次扣除 10 积分）
   * @param {string} walletAddress 
   * @param {number} cost 默认 10 积分
   * @returns {{ remainingCredits: number, remainingDialogues: number }}
   */
  deductCredits(walletAddress, cost = 10) {
    const cleanAddress = walletAddress.toLowerCase();
    const account = this.accounts.get(cleanAddress);
    if (!account) {
      const err = new Error('ACCOUNT_NOT_FOUND');
      err.code = 'ACCOUNT_NOT_FOUND';
      throw err;
    }

    if (account.credits < cost) {
      const err = new Error('INSUFFICIENT_CREDITS');
      err.code = 'INSUFFICIENT_CREDITS';
      err.details = `AI 积分不足。当前剩余 ${account.credits} 积分，本次分析需要 ${cost} 积分。`;
      throw err;
    }

    account.credits -= cost;
    account.usageCount += 1;

    return {
      remainingCredits: account.credits,
      remainingDialogues: Math.floor(account.credits / 10)
    };
  }

  /**
   * 查询账户状态
   * @param {string} walletAddress 
   * @returns {AccountRecord | null}
   */
  getAccount(walletAddress) {
    if (!walletAddress) return null;
    return this.accounts.get(walletAddress.toLowerCase()) || null;
  }
}

// 导出全局单例句柄
export const defaultAuthService = new AuthService();
