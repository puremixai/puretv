
import { NextRequest, NextResponse } from 'next/server';

import { invalidateDeviceAccessToken, invalidateUserAccessTokens } from '@/lib/access-token-invalidation';
import { clearAuthCookies } from '@/lib/auth-response';
import { getStorage } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  getUserDevices,
  revokeAllRefreshTokens,
  revokeRefreshToken,
} from '@/lib/refresh-token';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

// 获取所有设备
export async function GET(request: NextRequest) {
  const authInfo = await getAuthenticatedUser(request, { allowExpiredAccessToken: true });

  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const devices = await getUserDevices(authInfo.username);

    // 标记当前设备
    const devicesWithCurrent = devices.map((device) => ({
      ...device,
      isCurrent: device.tokenId === authInfo.tokenId,
    }));

    return NextResponse.json({ devices: devicesWithCurrent });
  } catch (error) {
    logger.error('Failed to get devices:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// 撤销指定设备
export async function DELETE(request: NextRequest) {
  const authInfo = await getAuthenticatedUser(request, { allowExpiredAccessToken: true });

  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { tokenId } = await request.json();

    if (!tokenId) {
      return NextResponse.json({ error: 'Token ID required' }, { status: 400 });
    }

    invalidateDeviceAccessToken(authInfo.username, tokenId);
    await revokeRefreshToken(authInfo.username, tokenId);
    const storage = getStorage();
    await storage.deletePushSubscriptionsByTokenId?.(authInfo.username, tokenId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('Failed to revoke device:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// 登出所有设备
export async function POST(request: NextRequest) {
  const authInfo = await getAuthenticatedUser(request, { allowExpiredAccessToken: true });

  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    invalidateUserAccessTokens(authInfo.username);
    await revokeAllRefreshTokens(authInfo.username);
    const storage = getStorage();
    await storage.deleteAllPushSubscriptions?.(authInfo.username);

    const response = NextResponse.json({ ok: true });

    // 清除当前设备的 Cookie
    clearAuthCookies(response);

    return response;
  } catch (error) {
    logger.error('Failed to revoke all devices:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
