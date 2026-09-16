import type { AuthInfo } from './auth';

const userInvalidBefore = new Map<string, number>();
const deviceInvalidBefore = new Map<string, number>();

function makeDeviceKey(username: string, tokenId: string): string {
  return `${username}:${tokenId}`;
}

export function invalidateUserAccessTokens(username: string, invalidatedAt = Date.now()): void {
  const current = userInvalidBefore.get(username) || 0;
  if (invalidatedAt > current) {
    userInvalidBefore.set(username, invalidatedAt);
  }
}

export function invalidateDeviceAccessToken(
  username: string,
  tokenId: string,
  invalidatedAt = Date.now()
): void {
  const key = makeDeviceKey(username, tokenId);
  const current = deviceInvalidBefore.get(key) || 0;
  if (invalidatedAt > current) {
    deviceInvalidBefore.set(key, invalidatedAt);
  }
}

export function isAccessTokenInvalidated(authInfo: AuthInfo | null): boolean {
  if (!authInfo?.username || !authInfo.timestamp) {
    return false;
  }

  const userInvalidatedAt = userInvalidBefore.get(authInfo.username);
  if (userInvalidatedAt && authInfo.timestamp <= userInvalidatedAt) {
    return true;
  }

  if (authInfo.tokenId) {
    const deviceInvalidatedAt = deviceInvalidBefore.get(
      makeDeviceKey(authInfo.username, authInfo.tokenId)
    );
    if (deviceInvalidatedAt && authInfo.timestamp <= deviceInvalidatedAt) {
      return true;
    }
  }

  return false;
}

export function getAccessTokenInvalidationState() {
  return {
    userInvalidBefore,
    deviceInvalidBefore,
  };
}
