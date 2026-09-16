import type { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from './auth';
import { verifyAuthSignature } from './auth-signature';
import { db } from './db';
import { verifyRefreshToken } from './refresh-token';

/** Validate credentials and persisted session state, including revoked devices and banned users. */
export async function getAuthenticatedUser(
  request: NextRequest,
  options: { allowExpiredAccessToken?: boolean } = {}
) {
  const auth = getAuthInfoFromCookie(request);
  if (!auth || !(await verifyAuthSignature(auth, options))) return null;
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  )
    return auth;
  try {
    if (
      !(await verifyRefreshToken(
        auth.username!,
        auth.tokenId!,
        auth.refreshToken!,
        false
      ))
    )
      return null;
    if (auth.username === process.env.USERNAME)
      return auth.role === 'owner' ? auth : null;
    const user = await db.getUserInfoV2(auth.username!, true);
    if (!user || user.banned || user.role !== auth.role) return null;
    return auth;
  } catch {
    return null;
  }
}
