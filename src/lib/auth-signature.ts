import type { AuthInfo } from './auth';
import { TOKEN_CONFIG } from './token-config';

export function authSigningPayload(auth: AuthInfo): string {
  return JSON.stringify({
    version: auth.version,
    username: auth.username,
    role: auth.role,
    timestamp: auth.timestamp,
    tokenId: auth.tokenId,
    refreshToken: auth.refreshToken,
    refreshExpires: auth.refreshExpires,
  });
}

export async function signAuthData(auth: AuthInfo): Promise<string> {
  const secret = process.env.AUTH_SECRET || process.env.PASSWORD;
  if (!secret) throw new Error('Authentication secret is not configured');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(authSigningPayload(auth))
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export async function verifyAuthSignature(
  auth: AuthInfo | null,
  { allowExpiredAccessToken = false } = {}
): Promise<boolean> {
  const secret = process.env.AUTH_SECRET || process.env.PASSWORD;
  if (!secret || !process.env.PASSWORD || !auth || auth.version !== 2)
    return false;
  if (
    typeof auth.username !== 'string' ||
    !auth.username ||
    !['owner', 'admin', 'user'].includes(auth.role || '') ||
    typeof auth.signature !== 'string' ||
    !/^[a-f0-9]{64}$/.test(auth.signature) ||
    typeof auth.timestamp !== 'number' ||
    !Number.isSafeInteger(auth.timestamp) ||
    typeof auth.refreshExpires !== 'number' ||
    !Number.isSafeInteger(auth.refreshExpires)
  )
    return false;
  const now = Date.now();
  if (
    auth.timestamp > now + 30_000 ||
    auth.timestamp <= 0 ||
    auth.refreshExpires <= now
  )
    return false;

  const local =
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage';
  if (local) {
    if (
      auth.username !== (process.env.USERNAME || 'default') ||
      auth.role !== 'owner'
    )
      return false;
    if (now - auth.timestamp > TOKEN_CONFIG.REFRESH_TOKEN_AGE) return false;
  } else {
    if (
      typeof auth.tokenId !== 'string' ||
      !/^[a-f0-9]{32}$/.test(auth.tokenId) ||
      typeof auth.refreshToken !== 'string' ||
      !/^[a-f0-9]{64}$/.test(auth.refreshToken)
    )
      return false;
    if (
      !allowExpiredAccessToken &&
      now - auth.timestamp >= TOKEN_CONFIG.ACCESS_TOKEN_AGE
    )
      return false;
  }

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const bytes = new Uint8Array(
      auth.signature.match(/../g)!.map((hex) => parseInt(hex, 16))
    );
    return await crypto.subtle.verify(
      'HMAC',
      key,
      bytes,
      encoder.encode(authSigningPayload(auth))
    );
  } catch {
    return false;
  }
}
