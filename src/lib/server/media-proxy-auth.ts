import type { NextRequest } from 'next/server';

import type { AuthInfo } from '../auth';
import { db, getStorage } from '../db';
import { getAuthenticatedUser } from '../session';

const TOKEN_AGE = 6 * 60 * 60 * 1000;

async function signingKey() {
  const secret = process.env.AUTH_SECRET || process.env.PASSWORD;
  if (!secret) throw new Error('Authentication is not configured');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createMediaProxyToken(auth: AuthInfo): Promise<string> {
  if (!auth.username) throw new Error('Unauthorized');
  const payload = Buffer.from(
    JSON.stringify({
      purpose: 'media-proxy',
      username: auth.username,
      tokenId: auth.tokenId,
      expires: Math.min(
        Date.now() + TOKEN_AGE,
        auth.refreshExpires || Date.now() + TOKEN_AGE
      ),
    })
  ).toString('base64url');
  const data = new TextEncoder().encode(`mp1.${payload}`);
  const signature = Buffer.from(
    await crypto.subtle.sign('HMAC', await signingKey(), data)
  ).toString('base64url');
  return `mp1.${payload}.${signature}`;
}

async function activeUsername(username: string): Promise<boolean> {
  if (username === process.env.USERNAME) return true;
  const user = await db.getUserInfoV2(username, true);
  return !!user && !user.banned;
}

export async function isMediaProxyAuthorized(
  request: NextRequest
): Promise<boolean> {
  if (await getAuthenticatedUser(request)) return true;
  const token = request.nextUrl.searchParams.get('token');
  if (!token || token.length > 2048) return false;
  try {
    // Only server-side configuration can grant a shared credential; NEXT_PUBLIC_* is not a secret.
    if (process.env.PROXY_M3U8_TOKEN && token === process.env.PROXY_M3U8_TOKEN)
      return true;
    if (token.startsWith('mp1.')) {
      const parts = token.split('.');
      if (
        parts.length !== 3 ||
        !/^[\w-]+$/.test(parts[1]) ||
        !/^[\w-]{43}$/.test(parts[2])
      )
        return false;
      if (
        !(await crypto.subtle.verify(
          'HMAC',
          await signingKey(),
          Buffer.from(parts[2], 'base64url'),
          new TextEncoder().encode(`mp1.${parts[1]}`)
        ))
      )
        return false;
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8')
      );
      if (
        payload.purpose !== 'media-proxy' ||
        typeof payload.username !== 'string' ||
        !Number.isSafeInteger(payload.expires) ||
        payload.expires <= Date.now()
      )
        return false;
      if (
        (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') ===
        'localstorage'
      )
        return payload.username === (process.env.USERNAME || 'default');
      if (typeof payload.tokenId !== 'string') return false;
      const storage = getStorage() as unknown as {
        adapter: { hGet(key: string, field: string): Promise<string | null> };
      };
      const raw = await storage.adapter.hGet(
        `user_tokens:${payload.username}`,
        payload.tokenId
      );
      if (!raw) return false;
      const session = JSON.parse(raw);
      return (
        session.expiresAt > Date.now() &&
        (await activeUsername(payload.username))
      );
    }
    // TVBox subscription URLs already carry a separate media-only credential.
    if (
      process.env.TVBOX_SUBSCRIBE_TOKEN &&
      token === process.env.TVBOX_SUBSCRIBE_TOKEN
    )
      return true;
    if (
      (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') ===
      'localstorage'
    )
      return false;
    const username = await db.getUsernameByTvboxToken(token);
    return !!username && (await activeUsername(username));
  } catch {
    return false;
  }
}
