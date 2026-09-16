import { NextRequest, NextResponse } from 'next/server';

import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { legadoSubscriptionStore } from '@/lib/legado/subscription-store';
import { checkMutationVersion, withConfigMutation } from '@/lib/server/config-mutation';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

async function ensureAdmin(request: NextRequest) {
  const authInfo = await getAuthenticatedUser(request);
  if (!authInfo?.username) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (authInfo.username !== process.env.USERNAME) {
    const userInfo = await db.getUserInfoV2(authInfo.username);
    if (!userInfo || (userInfo.role !== 'admin' && userInfo.role !== 'owner') || userInfo.banned) return NextResponse.json({ error: '权限不足' }, { status: 401 });
  }
  return authInfo.username;
}

export const DELETE = withConfigMutation(async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ensured = await ensureAdmin(request);
  if (ensured instanceof NextResponse) return ensured;
  const { id } = await context.params;
  try {
    const config = await getConfig(true);
    checkMutationVersion(config.ConfigVersion || 0);
    const opds = config.OPDSConfig || { Enabled: false, Sources: [], LegadoSubscriptions: [], CacheTTL: 10 * 60 * 1000 };
    const nextConfig = { ...config, OPDSConfig: { ...opds, LegadoSubscriptions: (opds.LegadoSubscriptions || []).filter((item) => item.id !== id) } };
    await legadoSubscriptionStore.delete(id);
    await db.saveAdminConfig(nextConfig);
    await setCachedConfig(nextConfig);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '删除 Legado 订阅失败' }, { status: 400 });
  }
});
