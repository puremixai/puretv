

import { logger } from '@/lib/logger';

import { TOKEN_CONFIG } from './token-config';
import type { IStorage } from './types';

// Re-export TOKEN_CONFIG for backward compatibility
export { TOKEN_CONFIG };

// Lazy import to avoid Edge Runtime issues in middleware
interface RefreshTokenAdapter {
  hSet(key: string, field: string, value: string): Promise<unknown>;
  hGet(key: string, field: string): Promise<string | null>;
  hDel(key: string, field: string): Promise<unknown>;
  hCompareAndSet(key: string, field: string, expected: string, value: string): Promise<boolean>;
  hGetAll(key: string): Promise<Record<string, string>>;
  del(key: string): Promise<unknown>;
}

type RefreshTokenStorage = IStorage & { adapter?: RefreshTokenAdapter };

let getStorage: (() => IStorage) | null = null;

async function loadStorage(): Promise<RefreshTokenStorage> {
  if (!getStorage) {
    const db = await import('./db');
    getStorage = db.getStorage;
  }
  return getStorage() as RefreshTokenStorage;
}

interface TokenData {
  token: string;
  deviceInfo: string;
  createdAt: number;
  expiresAt: number;
  lastUsed: number;
}

// 生成随机 Token ID
export function generateTokenId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// 生成随机 Refresh Token
export function generateRefreshToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// 存储 Refresh Token（使用 Redis Hash）
export async function storeRefreshToken(
  username: string,
  tokenId: string,
  tokenData: TokenData
): Promise<void> {
  const hashKey = `user_tokens:${username}`;
  const adapter = (await loadStorage()).adapter;

  if (!adapter || typeof adapter.hSet !== 'function') {
    throw new Error('The configured storage does not support persistent sessions');
  }

  try {
    await adapter.hSet(
      hashKey,
      tokenId,
      JSON.stringify(tokenData)
    );
    logger.debug(`Stored refresh token for ${username}:${tokenId}`);
  } catch (error) {
    logger.error('Failed to store refresh token:', error);
    throw error;
  }
}

// 验证 Refresh Token
export async function verifyRefreshToken(
  username: string,
  tokenId: string,
  refreshToken: string,
  updateLastUsed = true
): Promise<boolean> {
  const hashKey = `user_tokens:${username}`;
  const adapter = (await loadStorage()).adapter;

  if (!adapter || typeof adapter.hGet !== 'function') {
    logger.warn('Redis Hash not supported');
    return false;
  }

  try {
    const dataStr = await adapter.hGet(hashKey, tokenId);

    if (typeof dataStr !== 'string' || !dataStr) {
      return false;
    }

    const tokenData: TokenData = JSON.parse(dataStr);

    // 检查是否过期
    if (!Number.isFinite(tokenData.expiresAt) || Date.now() >= tokenData.expiresAt) {
      // 过期了，删除
      await adapter.hDel(hashKey, tokenId);
      return false;
    }

    // 验证 Token
    if (tokenData.token !== refreshToken) {
      return false;
    }

    // 更新最后使用时间
    if (updateLastUsed && typeof adapter.hCompareAndSet === 'function') {
      tokenData.lastUsed = Date.now();
      // Never recreate a device session deleted while the refresh request was reading it.
      if (!(await adapter.hCompareAndSet(hashKey, tokenId, dataStr, JSON.stringify(tokenData)))) return false;
    }

    return true;
  } catch (error) {
    logger.error('Failed to verify refresh token:', error);
    return false;
  }
}

// 撤销单个 Token
export async function revokeRefreshToken(
  username: string,
  tokenId: string
): Promise<void> {
  const hashKey = `user_tokens:${username}`;
  const adapter = (await loadStorage()).adapter;

  if (!adapter || typeof adapter.hDel !== 'function') {
    logger.warn('Redis Hash not supported');
    return;
  }

  try {
    await adapter.hDel(hashKey, tokenId);
    logger.debug(`Revoked refresh token for ${username}:${tokenId}`);
  } catch (error) {
    logger.error('Failed to revoke refresh token:', error);
  }
}

// 获取用户的所有设备
export async function getUserDevices(username: string): Promise<Array<{
  tokenId: string;
  deviceInfo: string;
  createdAt: number;
  lastUsed: number;
  expiresAt: number;
}>> {
  const hashKey = `user_tokens:${username}`;
  const adapter = (await loadStorage()).adapter;

  if (!adapter || typeof adapter.hGetAll !== 'function') {
    logger.warn('Redis Hash not supported');
    return [];
  }

  try {
    const allTokens = await adapter.hGetAll(hashKey);

    if (!allTokens || typeof allTokens !== 'object') {
      return [];
    }

    const devices = [];
    const now = Date.now();

    for (const [tokenId, dataStr] of Object.entries(allTokens)) {
      try {
        const tokenData: TokenData = JSON.parse(dataStr as string);

        // 检查是否过期
        if (now > tokenData.expiresAt) {
          // 过期了，删除
          await adapter.hDel(hashKey, tokenId);
          continue;
        }

        devices.push({
          tokenId,
          deviceInfo: tokenData.deviceInfo,
          createdAt: tokenData.createdAt,
          lastUsed: tokenData.lastUsed,
          expiresAt: tokenData.expiresAt,
        });
      } catch (err) {
        logger.error(`Failed to parse token data for ${tokenId}:`, err);
      }
    }

    return devices;
  } catch (error) {
    logger.error('Failed to get user devices:', error);
    return [];
  }
}

// 撤销所有 Token
export async function revokeAllRefreshTokens(username: string): Promise<void> {
  const hashKey = `user_tokens:${username}`;
  const adapter = (await loadStorage()).adapter;

  if (!adapter || typeof adapter.del !== 'function') {
    logger.warn('Redis Hash not supported');
    return;
  }

  try {
    await adapter.del(hashKey);
    logger.debug(`Revoked all refresh tokens for ${username}`);
  } catch (error) {
    logger.error('Failed to revoke all refresh tokens:', error);
  }
}

// 清理过期的 Token（定期任务）
export async function cleanupExpiredTokens(username: string): Promise<number> {
  const hashKey = `user_tokens:${username}`;
  const adapter = (await loadStorage()).adapter;

  if (!adapter || typeof adapter.hGetAll !== 'function') {
    return 0;
  }

  try {
    const allTokens = await adapter.hGetAll(hashKey);

    if (!allTokens || typeof allTokens !== 'object') {
      return 0;
    }

    const now = Date.now();
    let cleanedCount = 0;

    for (const [tokenId, dataStr] of Object.entries(allTokens)) {
      try {
        const tokenData: TokenData = JSON.parse(dataStr as string);

        if (now > tokenData.expiresAt) {
          await adapter.hDel(hashKey, tokenId);
          cleanedCount++;
        }
      } catch (err) {
        logger.error(`Failed to parse token data for ${tokenId}:`, err);
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} expired tokens for ${username}`);
    }

    return cleanedCount;
  } catch (error) {
    logger.error('Failed to cleanup expired tokens:', error);
    return 0;
  }
}
