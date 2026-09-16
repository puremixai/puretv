import { NextRequest, NextResponse } from 'next/server';

import { setAuthCookies } from '@/lib/auth-response';
import {
  consumeConfirmedTelegramLogin,
  getTelegramLoginSession,
} from '@/lib/telegram';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token');
  const session = await getTelegramLoginSession(token);
  if (!session) return NextResponse.json({ status: 'expired' });

  if (session.status === 'confirmed' && session.authToken) {
    const consumed = await consumeConfirmedTelegramLogin(session.token);
    const response = NextResponse.json({ status: 'confirmed', username: consumed?.username });
    const expires = new Date();
    expires.setDate(expires.getDate() + 60);
    setAuthCookies(response, session.authToken, request);
    return response;
  }

  return NextResponse.json({
    status: session.status,
    expiresAt: session.expiresAt,
  });
}
