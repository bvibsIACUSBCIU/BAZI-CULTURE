import { getAddress, verifyMessage } from 'ethers';

const CHALLENGE_TTL_SECONDS = 10 * 60;

export function createChallengeService({ kv, canonicalOrigin, now = () => Date.now(), createId = defaultCreateId } = {}) {
  if (!kv) throw new Error('AUTH_KV_REQUIRED');
  const expectedOrigin = normalizeOrigin(canonicalOrigin);

  return {
    async issue({ walletAddress, operation, origin }) {
      const wallet = normalizeWallet(walletAddress);
      const normalizedOperation = normalizeOperation(operation);
      assertOrigin(origin, expectedOrigin);
      const challengeId = createId('chl');
      const issuedAt = now();
      const record = {
        walletAddress: wallet,
        operation: normalizedOperation,
        origin: expectedOrigin,
        issuedAt,
        expiresAt: issuedAt + CHALLENGE_TTL_SECONDS * 1000,
      };
      const message = buildMessage({ challengeId, ...record });
      await kv.put(challengeKey(challengeId), JSON.stringify({ ...record, message }), {
        expirationTtl: CHALLENGE_TTL_SECONDS,
      });
      return { challengeId, message, expiresAt: record.expiresAt };
    },

    async consume({ challengeId, walletAddress, signature, operation, origin }) {
      const raw = await kv.get(challengeKey(challengeId));
      if (!raw) throw codedError('SIGNATURE_VERIFICATION_FAILED');
      const record = parseRecord(raw);
      const wallet = normalizeWallet(walletAddress);
      const normalizedOperation = normalizeOperation(operation);
      if (
        record.expiresAt <= now()
        || record.walletAddress !== wallet
        || record.operation !== normalizedOperation
        || record.origin !== normalizeOrigin(origin)
      ) {
        throw codedError('SIGNATURE_VERIFICATION_FAILED');
      }

      let recovered;
      try {
        recovered = getAddress(verifyMessage(record.message, String(signature))).toLowerCase();
      } catch {
        throw codedError('SIGNATURE_VERIFICATION_FAILED');
      }
      if (recovered !== record.walletAddress) throw codedError('SIGNATURE_VERIFICATION_FAILED');
      await kv.delete(challengeKey(challengeId));
      return { walletAddress: record.walletAddress, operation: record.operation };
    },
  };
}

function buildMessage({ challengeId, walletAddress, operation, origin, issuedAt }) {
  return [
    'Liangyi Bazi Wallet Authentication',
    'Version: 1',
    `Operation: ${operation}`,
    `Wallet: ${walletAddress}`,
    `Origin: ${origin}`,
    `Nonce: ${challengeId}`,
    `Issued At: ${new Date(issuedAt).toISOString()}`,
  ].join('\n');
}

function parseRecord(raw) {
  try {
    const record = JSON.parse(raw);
    if (!record?.walletAddress || !record?.message || !Number.isFinite(record.expiresAt)) throw new Error();
    return record;
  } catch {
    throw codedError('SIGNATURE_VERIFICATION_FAILED');
  }
}

function challengeKey(challengeId) {
  return `auth:challenge:${String(challengeId)}`;
}

function normalizeWallet(walletAddress) {
  try {
    return getAddress(String(walletAddress)).toLowerCase();
  } catch {
    throw codedError('INVALID_WALLET_ADDRESS');
  }
}

function normalizeOperation(operation) {
  const normalized = String(operation || '').toLowerCase();
  if (!['register', 'login', 'authenticate'].includes(normalized)) throw codedError('INVALID_AUTH_OPERATION');
  return normalized;
}

function normalizeOrigin(origin) {
  try {
    return new URL(String(origin)).origin;
  } catch {
    throw codedError('INVALID_AUTH_ORIGIN');
  }
}

function assertOrigin(origin, expectedOrigin) {
  if (normalizeOrigin(origin) !== expectedOrigin) throw codedError('INVALID_AUTH_ORIGIN');
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function defaultCreateId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}
