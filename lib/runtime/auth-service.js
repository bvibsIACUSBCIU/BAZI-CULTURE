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
  }

  /**
   * 生成登录挑战 Nonce (Challenge)
   * @param {string} walletAddress 
   * @returns {{ challengeId: string, challenge: string, expiresAt: number }}
   */
  generateChallenge(walletAddress) {
    if (!walletAddress || typeof walletAddress !== 'string') {
      throw new Error('INVALID_WALLET_ADDRESS');
    }
    const cleanAddress = walletAddress.toLowerCase();
    const challengeId = crypto.randomUUID();
    const timestamp = Date.now();
    const challenge = `Tianfu-Bazi Auth Challenge\nWallet: ${cleanAddress}\nNonce: ${challengeId}\nTimestamp: ${timestamp}`;
    const expiresAt = timestamp + 10 * 60 * 1000; // 10分钟有效

    this.challenges.set(challengeId, {
      walletAddress: cleanAddress,
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
  verifySignature(challengeId, walletAddress, signature) {
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
  loginOrRegister(walletAddress, clientIp = '127.0.0.1') {
    const cleanAddress = walletAddress.toLowerCase();
    const cleanIp = clientIp || '127.0.0.1';

    // 如果账户已存在，直接返回
    if (this.accounts.has(cleanAddress)) {
      return this.accounts.get(cleanAddress);
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
      usageCount: 0        // 使用次数统计
    };

    registeredWallets.add(cleanAddress);
    this.ipToWallets.set(cleanIp, registeredWallets);
    this.accounts.set(cleanAddress, newAccount);

    return newAccount;
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
    const cleanUsername = String(username || '').trim();
    if (!account || !cleanUsername || cleanUsername.length > 40) {
      const err = new Error('INVALID_USERNAME');
      err.code = 'INVALID_USERNAME';
      throw err;
    }
    account.username = cleanUsername;
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
