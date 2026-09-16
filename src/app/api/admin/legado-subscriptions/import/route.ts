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

export const POST = withConfigMutation(async function POST(request: NextRequest) {
  const ensured = await ensureAdmin(request);
  if (ensured instanceof NextResponse) return ensured;
  try {
    const body = await request.json();
    const url = String(body?.url || '').trim();
    const name = String(body?.name || '').trim() || 'Legado 订阅';
    const meta = await legadoSubscriptionStore.sync({ name, url });
    const config = await getConfig(true);
    checkMutationVersion(config.ConfigVersion || 0);
    const nextConfig = legadoSubscriptionStore.mergeMeta(config, meta);
    await db.saveAdminConfig(nextConfig);
    await setCachedConfig(nextConfig);
    return NextResponse.json({ success: true, subscription: meta });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '导入 Legado 订阅失败' }, { status: 400 });
  }
});
