import { NextRequest, NextResponse } from 'next/server';

import { configSelfCheck,getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { checkMutationVersion, withConfigMutation } from '@/lib/server/config-mutation';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';
async function isOwner(request: NextRequest) {
 const auth = await getAuthenticatedUser(request);
 return !!auth && auth.username === process.env.USERNAME;
}
export async function GET(request: NextRequest) {
 if (!await isOwner(request)) return NextResponse.json({ error: '仅站长可查看配置历史' }, { status: 403 });
 const history = await db.getConfigHistory();
 return NextResponse.json({ history: history.map(({ version, savedAt }) => ({ version, savedAt })) }, { headers: { 'Cache-Control': 'no-store' } });
}
export const POST = withConfigMutation(async (request: NextRequest) => {
 if (!await isOwner(request)) return NextResponse.json({ error: '仅站长可恢复配置' }, { status: 403 });
 try {
  const { version } = await request.json();
  const entry = (await db.getConfigHistory()).find(item => item.version === version);
  if (!entry) return NextResponse.json({ error: '此版本已超出历史保留范围' }, { status: 404 });
  const current = await getConfig(true);
    checkMutationVersion(current.ConfigVersion || 0);
  const restored = configSelfCheck({ ...entry.config, ConfigVersion: current.ConfigVersion });
  await db.saveAdminConfig(restored);
  return NextResponse.json({ success: true, version: restored.ConfigVersion });
 } catch { return NextResponse.json({ error: '恢复配置失败' }, { status: 500 }); }
});
