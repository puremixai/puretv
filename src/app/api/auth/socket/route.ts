import { NextRequest, NextResponse } from 'next/server';

import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (!auth?.username)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(
    { username: auth.username },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
