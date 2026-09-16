import { NextRequest, NextResponse } from 'next/server';

import { generateAuthCookieValue } from '@/lib/auth-cookie';
import { getQrLoginSession, saveQrLoginSession } from '@/lib/qr-login/store';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const { token } = await request.json();
  const session = await getQrLoginSession(token);
  if (!session || session.status === 'expired') return NextResponse.json({ error: '二维码已过期' }, { status: 410 });
  if (session.status === 'cancelled' || session.status === 'used') return NextResponse.json({ error: '二维码不可用' }, { status: 400 });

  const authInfo = await getAuthenticatedUser(request);
  if (!authInfo?.username) return NextResponse.json({ error: '请先在手机端登录后再确认' }, { status: 401 });

  session.status = 'confirmed';
  session.authToken = await generateAuthCookieValue({ username: authInfo.username, role: authInfo.role, deviceInfo: 'QR login' });
  session.userAgent = request.headers.get('user-agent') || '';
  await saveQrLoginSession(session);
  return NextResponse.json({ ok: true, status: 'confirmed' });
}
