import { NextRequest, NextResponse } from 'next/server';

import { setAuthCookies } from '@/lib/auth-response';
import { getQrLoginSession, saveQrLoginSession } from '@/lib/qr-login/store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token');
  const session = await getQrLoginSession(token);
  if (!session) return NextResponse.json({ status: 'expired' });

  if (session.status === 'confirmed' && session.authToken) {
    session.status = 'used';
    await saveQrLoginSession(session);
    const response = NextResponse.json({ status: 'confirmed' });
    const expires = new Date();
    expires.setDate(expires.getDate() + 60);
    setAuthCookies(response, session.authToken, request);
    return response;
  }

  return NextResponse.json({ status: session.status, expiresAt: session.expiresAt });
}
