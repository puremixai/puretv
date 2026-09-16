import type { AuthInfo } from './auth';
import { signAuthData } from './auth-signature';
import {
  generateRefreshToken,
  generateTokenId,
  storeRefreshToken,
  TOKEN_CONFIG,
} from './refresh-token';

const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | 'd1'
    | 'postgres'
    | undefined) || 'localstorage';

export async function generateAuthSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function getDeviceInfoFromUserAgent(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  if (ua.includes('puretv')) return 'PureTV APP';
  if (ua.includes('oriontv')) return 'OrionTV';
  if (ua.includes('chrome')) return 'Chrome';
  if (ua.includes('firefox')) return 'Firefox';
  if (ua.includes('safari')) return 'Safari';
  if (ua.includes('edge')) return 'Edge';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('iphone') || ua.includes('ios')) return 'iOS';
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('mac')) return 'macOS';
  if (ua.includes('linux')) return 'Linux';

  return 'Unknown Device';
}

export async function generateAuthCookieValue(input: {
  username?: string;
  password?: string;
  role?: 'owner' | 'admin' | 'user';
  includePassword?: boolean;
  deviceInfo?: string;
}): Promise<string> {
  if (!input.username || !process.env.PASSWORD) throw new Error('Authentication is not configured');
  const now = Date.now();
  const authData: AuthInfo = {
    version: 2, username: input.username, role: input.role || 'user', timestamp: now,
    refreshExpires: now + TOKEN_CONFIG.REFRESH_TOKEN_AGE,
  };
  if (STORAGE_TYPE !== 'localstorage') {
    authData.tokenId = generateTokenId();
    authData.refreshToken = generateRefreshToken();
    await storeRefreshToken(input.username, authData.tokenId, {
      token: authData.refreshToken,
      deviceInfo: input.deviceInfo || 'Unknown Device',
      createdAt: now, expiresAt: authData.refreshExpires!, lastUsed: now,
    });
  }
  authData.signature = await signAuthData(authData);
  return encodeURIComponent(JSON.stringify(authData));
}

export function generateAuthCookie(
  username?: string, password?: string, role?: 'owner' | 'admin' | 'user',
  includePassword = false, deviceInfo?: string
) {
  return generateAuthCookieValue({ username, password, role, includePassword, deviceInfo });
}
