import { NextRequest, NextResponse } from 'next/server';

import { generateAuthCookieValue } from '@/lib/auth-cookie';
import { authResponse, setAuthCookies } from '@/lib/auth-response';
import { refreshAccessToken } from '@/lib/middleware-auth';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser(request, { allowExpiredAccessToken: true });
  if (!auth?.username) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const local = (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage';
  const token = local
    ? await generateAuthCookieValue({ username: auth.username, role: auth.role })
    : await refreshAccessToken(auth.username, auth.role!, auth.tokenId!, auth.refreshToken!, auth.refreshExpires!);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const response = authResponse(request, token);
  setAuthCookies(response, token, request);
  return response;
}
