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

export const POST = withConfigMutation(async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ensured = await ensureAdmin(request);
  if (ensured instanceof NextResponse) return ensured;
  const { id } = await context.params;
  try {
    const config = await getConfig(true);
    checkMutationVersion(config.ConfigVersion || 0);
    const opds = config.OPDSConfig || { Enabled: false, Sources: [], LegadoSubscriptions: [], CacheTTL: 10 * 60 * 1000 };
    const current = (opds.LegadoSubscriptions || []).find((item) => item.id === id);
    if (!current) return NextResponse.json({ success: false, error: '订阅不存在' }, { status: 404 });
    const meta = await legadoSubscriptionStore.sync({ id: current.id, name: current.name, url: current.url });
    const nextConfig = legadoSubscriptionStore.mergeMeta(config, { ...current, ...meta, enabled: current.enabled !== false });
    await db.saveAdminConfig(nextConfig);
    await setCachedConfig(nextConfig);
    return NextResponse.json({ success: true, subscription: { ...current, ...meta, enabled: current.enabled !== false } });
  } catch (error) {
    const config = await getConfig(true);
    checkMutationVersion(config.ConfigVersion || 0);
    const opds = config.OPDSConfig || { Enabled: false, Sources: [], LegadoSubscriptions: [], CacheTTL: 10 * 60 * 1000 };
    const now = Date.now();
    const message = error instanceof Error ? error.message : '刷新 Legado 订阅失败';
    const nextSubscriptions = (opds.LegadoSubscriptions || []).map((item) => item.id === id ? { ...item, lastSyncAt: now, lastError: message } : item);
    const nextConfig = { ...config, OPDSConfig: { ...opds, LegadoSubscriptions: nextSubscriptions } };
    await db.saveAdminConfig(nextConfig);
    await setCachedConfig(nextConfig);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
});
