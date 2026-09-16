import { NextRequest, NextResponse } from 'next/server';

import { getAuthenticatedUser } from '@/lib/session';
import { isTVModeEnabled } from '@/lib/tv-mode';
import { sendTVRemoteCommand } from '@/lib/tv-remote-hub';
import type { TVRemoteKeyCommand } from '@/lib/tv-remote-types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isTVModeEnabled()) {
    return NextResponse.json({ error: 'TV 模式未启用' }, { status: 404 });
  }

  const authInfo = await getAuthenticatedUser(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as {
    deviceId?: string;
    command?: TVRemoteKeyCommand;
  } | null;

  if (!body?.deviceId || !body.command?.key) {
    return NextResponse.json({ error: '参数不完整' }, { status: 400 });
  }

  const result = sendTVRemoteCommand(
    authInfo.username,
    body.deviceId,
    'tv-remote:key',
    body.command
  );

  return NextResponse.json(result, { status: result.success ? 200 : 404 });
}
