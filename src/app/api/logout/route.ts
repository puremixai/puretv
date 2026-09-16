import { NextRequest, NextResponse } from 'next/server';

import { invalidateDeviceAccessToken } from '@/lib/access-token-invalidation';
import { clearAuthCookies } from '@/lib/auth-response';
import { getStorage } from '@/lib/db';
import { logger } from '@/lib/logger';
import { revokeRefreshToken } from '@/lib/refresh-token';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const authInfo = await getAuthenticatedUser(request, { allowExpiredAccessToken: true });

  // 撤销当前设备的 Refresh Token
  if (authInfo && authInfo.username && authInfo.tokenId) {
    try {
      invalidateDeviceAccessToken(authInfo.username, authInfo.tokenId);
      await revokeRefreshToken(authInfo.username, authInfo.tokenId);
      const storage = getStorage();
      await storage.deletePushSubscriptionsByTokenId?.(authInfo.username, authInfo.tokenId);
    } catch (error) {
      logger.error('Failed to revoke refresh token:', error);
    }
  }

  const response = NextResponse.json({ ok: true });

  // 清除认证cookie
  clearAuthCookies(response);

  return response;
}
