const DEFAULT_TTL_SECONDS = 6 * 60 * 60;

export function createSessionService({
  sessions,
  environment = 'development',
  cookieName = 'liangyi_session',
  ttlSeconds = DEFAULT_TTL_SECONDS,
  now = () => Date.now(),
} = {}) {
  if (!sessions) throw new Error('AUTH_SESSION_REPOSITORY_REQUIRED');

  return {
    async issue({ userId, userAgent = '', clientIp = '' }) {
      const token = createToken();
      const timestamp = now();
      const expiresAt = new Date(timestamp + Number(ttlSeconds) * 1000).toISOString();
      const session = await sessions.create({
        userId,
        secretHash: await sha256(token),
        expiresAt,
        userAgentHash: userAgent ? await sha256(userAgent) : null,
        ipHash: clientIp ? await sha256(clientIp) : null,
      });
      return { token, session, cookie: serializeCookie(cookieName, token, ttlSeconds, environment) };
    },

    async resolve(request) {
      const token = readCookie(request.headers.get('cookie'), cookieName);
      if (!token) return null;
      return sessions.findActiveByHash(await sha256(token), new Date(now()).toISOString());
    },

    async revoke(request) {
      const token = readCookie(request.headers.get('cookie'), cookieName);
      if (!token) return false;
      return sessions.revoke(await sha256(token));
    },

    clearCookie() {
      return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${environment === 'production' ? '; Secure' : ''}`;
    },
  };
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function readCookie(header, name) {
  if (!header) return null;
  const prefix = `${name}=`;
  for (const part of header.split(';')) {
    const value = part.trim();
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return null;
}

function serializeCookie(name, token, ttlSeconds, environment) {
  const attributes = [
    `${name}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Number(ttlSeconds)}`,
  ];
  if (environment === 'production') attributes.push('Secure');
  return attributes.join('; ');
}
