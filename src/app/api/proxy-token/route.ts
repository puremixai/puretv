import { NextRequest, NextResponse } from 'next/server';

import { createMediaProxyToken } from '@/lib/server/media-proxy-auth';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (!auth)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(
    { token: await createMediaProxyToken(auth) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
