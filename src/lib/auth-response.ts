import { NextRequest, NextResponse } from 'next/server';

import { parseAuthInfo } from './auth';

export function publicAuthInfo(token: string) {
  const auth = parseAuthInfo(token);
  if (!auth) throw new Error('Invalid authentication token');
  const { username, role, timestamp, tokenId, refreshExpires } = auth;
  return { username, role, timestamp, tokenId, refreshExpires };
}

export function setAuthCookies(
  response: NextResponse,
  token: string,
  request: NextRequest
) {
  const profile = publicAuthInfo(token);
  const options = {
    path: '/',
    expires: new Date(profile.refreshExpires || Date.now()),
    sameSite: 'lax' as const,
    secure:
      request.nextUrl.protocol === 'https:' ||
      request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ===
        'https',
  };
  response.cookies.set('auth', token, { ...options, httpOnly: true });
  // UI metadata never contains a signature, password, or refresh credential.
  response.cookies.set(
    'auth_info',
    encodeURIComponent(JSON.stringify(profile)),
    { ...options, httpOnly: false }
  );
  response.headers.set('Cache-Control', 'no-store');
}

export function clearAuthCookies(response: NextResponse) {
  for (const name of ['auth', 'auth_info']) {
    response.cookies.set(name, '', {
      path: '/',
      expires: new Date(0),
      sameSite: 'lax',
      httpOnly: name === 'auth',
    });
  }
  response.headers.set('Cache-Control', 'no-store');
}

export function authResponse(request: NextRequest, token?: string | null) {
  const body: Record<string, unknown> = { ok: true };
  if (token) {
    body.auth = publicAuthInfo(token);
    // Native API clients retain their token response. Browser fetch metadata is browser-controlled.
    if (!request.headers.has('sec-fetch-site')) body.token = token;
  }
  const response = NextResponse.json(body);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
