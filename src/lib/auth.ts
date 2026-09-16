import { NextRequest } from 'next/server';

import { logger } from '@/lib/logger';

import { isAccessTokenInvalidated } from './access-token-invalidation';

export type AuthInfo = {
  version?: number;
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
  tokenId?: string;
  refreshToken?: string;
  refreshExpires?: number;
};

function getAuthTokenFromHeader(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const bearerMatch = trimmed.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    return bearerMatch[1].trim();
  }

  const tokenMatch = trimmed.match(/^Token\s+(.+)$/i);
  if (tokenMatch) {
    return tokenMatch[1].trim();
  }

  return trimmed;
}

export function parseAuthInfo(value?: string | null): AuthInfo | null {
  if (!value) {
    return null;
  }

  let decoded = value;

  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    decoded = value;
  }

  if (decoded.includes('%')) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      decoded = value;
    }
  }

  try {
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AuthInfo : null;
  } catch {
    return null;
  }
}

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(request: NextRequest): AuthInfo | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const headerValue = getAuthTokenFromHeader(authHeader);
    const headerAuthInfo = parseAuthInfo(headerValue);
    if (headerAuthInfo) {
      return isAccessTokenInvalidated(headerAuthInfo) ? null : headerAuthInfo;
    }
  }

  const authCookie = request.cookies.get('auth');

  if (!authCookie) {
    return null;
  }

  const authInfo = parseAuthInfo(authCookie.value);
  return isAccessTokenInvalidated(authInfo) ? null : authInfo;
}

// 从cookie获取认证信息 (客户端使用)
export function getAuthInfoFromBrowserCookie(): AuthInfo | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // 解析 document.cookie
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const trimmed = cookie.trim();
      const firstEqualIndex = trimmed.indexOf('=');

      if (firstEqualIndex > 0) {
        const key = trimmed.substring(0, firstEqualIndex);
        const value = trimmed.substring(firstEqualIndex + 1);
        if (key && value) {
          acc[key] = value;
        }
      }

      return acc;
    }, {} as Record<string, string>);

    const authCookie = cookies['auth_info'];
    if (!authCookie) {
      return null;
    }

    return parseAuthInfo(authCookie);
  } catch {
    return null;
  }
}

// 清除浏览器中的认证cookie (客户端使用)
export function clearAuthCookie(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    // 清除 auth cookie，设置过期时间为过去
    document.cookie = 'auth_info=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    // 如果有其他域名或路径的cookie，也尝试清除
    document.cookie = 'auth_info=; path=/; domain=' + window.location.hostname + '; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  } catch (error) {
    logger.error('[Auth] Failed to clear cookie:', error);
  }
}
