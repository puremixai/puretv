import type { OIDCProviderConfig } from '@/lib/oidc';

export const OIDC_SESSION_MAX_AGE = 600;

interface OIDCSessionBase {
  providerId: string;
  fingerprint: string;
  timestamp: number;
}

export interface OIDCTransaction extends OIDCSessionBase {
  state: string;
}

export interface OIDCRegistration extends OIDCSessionBase {
  sub: string;
  email?: string;
  name?: string;
  trust_level: number;
}

type SessionPurpose = 'transaction' | 'registration';

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function signingKey(usage: 'sign' | 'verify') {
  const secret = process.env.AUTH_SECRET || process.env.PASSWORD;
  if (!secret) throw new Error('Authentication secret is not configured');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

function signingPayload(purpose: SessionPurpose, payload: string) {
  return new TextEncoder().encode(`puretv:oidc:${purpose}:v1:${payload}`);
}

async function signSession(purpose: SessionPurpose, session: OIDCSessionBase) {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString(
    'base64url',
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey('sign'),
    signingPayload(purpose, payload),
  );
  return `v1.${payload}.${hex(signature)}`;
}

async function readSession(
  purpose: SessionPurpose,
  cookie: string | undefined,
): Promise<Record<string, unknown> | null> {
  if (!cookie || cookie.length > 8192) return null;
  try {
    const [version, payload, signature, extra] = cookie.split('.');
    if (
      version !== 'v1' ||
      !payload ||
      !/^[A-Za-z0-9_-]+$/.test(payload) ||
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      extra !== undefined
    )
      return null;

    const valid = await crypto.subtle.verify(
      'HMAC',
      await signingKey('verify'),
      new Uint8Array(signature.match(/../g)!.map((byte) => parseInt(byte, 16))),
      signingPayload(purpose, payload),
    );
    if (!valid) return null;
    const data: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const session = data as Record<string, unknown>;
    const now = Date.now();
    if (
      typeof session.timestamp !== 'number' ||
      !Number.isSafeInteger(session.timestamp) ||
      session.timestamp <= 0 ||
      session.timestamp > now ||
      now - session.timestamp >= OIDC_SESSION_MAX_AGE * 1000 ||
      typeof session.providerId !== 'string' ||
      !session.providerId ||
      typeof session.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(session.fingerprint)
    )
      return null;
    return session;
  } catch {
    return null;
  }
}

/** Bind in-flight logins to one provider and its complete connection configuration. */
export async function getOIDCProviderFingerprint(provider: OIDCProviderConfig) {
  const connection = JSON.stringify([
    provider.id,
    provider.issuer,
    provider.authorizationEndpoint,
    provider.tokenEndpoint,
    provider.userInfoEndpoint,
    provider.clientId,
    provider.clientSecret,
  ]);
  return hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(connection)),
  );
}

export async function createOIDCTransaction(
  provider: OIDCProviderConfig,
  state: string,
) {
  const transaction: OIDCTransaction = {
    providerId: provider.id,
    fingerprint: await getOIDCProviderFingerprint(provider),
    state,
    timestamp: Date.now(),
  };
  return signSession('transaction', transaction);
}

export async function readOIDCTransaction(
  cookie: string | undefined,
): Promise<OIDCTransaction | null> {
  const session = await readSession('transaction', cookie);
  if (!session || typeof session.state !== 'string' || !session.state)
    return null;
  return session as unknown as OIDCTransaction;
}

export async function createOIDCRegistration(
  provider: OIDCProviderConfig,
  claims: Pick<OIDCRegistration, 'sub' | 'email' | 'name' | 'trust_level'>,
) {
  return signSession('registration', {
    ...claims,
    providerId: provider.id,
    fingerprint: await getOIDCProviderFingerprint(provider),
    timestamp: Date.now(),
  });
}

export async function readOIDCRegistration(
  cookie: string | undefined,
): Promise<OIDCRegistration | null> {
  const session = await readSession('registration', cookie);
  if (
    !session ||
    typeof session.sub !== 'string' ||
    !session.sub ||
    typeof session.trust_level !== 'number' ||
    !Number.isFinite(session.trust_level) ||
    session.trust_level < 0 ||
    (session.email !== undefined && typeof session.email !== 'string') ||
    (session.name !== undefined && typeof session.name !== 'string')
  )
    return null;
  return session as unknown as OIDCRegistration;
}

export function isOIDCRegistrationAllowed(
  provider: OIDCProviderConfig,
  trustLevel: number,
) {
  return (
    provider.enabled &&
    provider.enableRegistration &&
    trustLevel >= provider.minTrustLevel
  );
}
