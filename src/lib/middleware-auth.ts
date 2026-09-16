import { logger } from '@/lib/logger';

import { signAuthData } from './auth-signature';
import { TOKEN_CONFIG, verifyRefreshToken } from './refresh-token';

// 生成签名
export async function generateSignatureForMiddleware(
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

// 刷新 Access Token
export async function refreshAccessToken(
  username: string,
  role: string,
  tokenId: string,
  refreshToken: string,
  refreshExpires: number
): Promise<string | null> {
  // 验证 Refresh Token
  const isValid = await verifyRefreshToken(username, tokenId, refreshToken);

  if (!isValid) {
    logger.debug(`Refresh token invalid for ${username}:${tokenId}`);
    return null;
  }

  const now = Date.now();

  const authData = {
    version: 2, username, role: role as 'owner' | 'admin' | 'user', timestamp: now,
    tokenId, refreshToken, refreshExpires, signature: '',
  };
  authData.signature = await signAuthData(authData);

  logger.debug(`Refreshed access token for ${username}`);

  return encodeURIComponent(JSON.stringify(authData));
}

// 检查是否需要续期
export function shouldRenewToken(timestamp: number): boolean {
  const age = Date.now() - timestamp;
  const remaining = TOKEN_CONFIG.ACCESS_TOKEN_AGE - age;

  return remaining < TOKEN_CONFIG.RENEWAL_THRESHOLD && remaining > 0;
}
