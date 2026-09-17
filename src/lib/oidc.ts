import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import type { AdminConfig } from './admin.types';
import { normalizeApiBaseUrl } from './url';

export interface OIDCProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  enableRegistration: boolean;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
  clientId: string;
  clientSecret: string;
  buttonText: string;
  minTrustLevel: number;
}

export interface PublicOIDCProvider {
  id: string;
  name: string;
  buttonText: string;
  enableRegistration: boolean;
}

type OIDCSiteConfig = Partial<AdminConfig['SiteConfig']>;
const IDENTITY_FIELDS = [
  'issuer',
  'authorizationEndpoint',
  'tokenEndpoint',
  'userInfoEndpoint',
  'clientId',
] as const;
const STRING_FIELDS = [
  'id',
  'name',
  ...IDENTITY_FIELDS,
  'clientSecret',
  'buttonText',
] as const;
const URL_FIELDS = [
  'issuer',
  'authorizationEndpoint',
  'tokenEndpoint',
  'userInfoEndpoint',
] as const;

export function isOIDCProviderConfigured(
  provider: OIDCProviderConfig,
): boolean {
  return Boolean(
    provider.authorizationEndpoint &&
    provider.tokenEndpoint &&
    provider.userInfoEndpoint &&
    provider.clientId,
  );
}

/** An explicit list, including an empty one, replaces the legacy configuration. */
export function getOIDCProviders(site: OIDCSiteConfig): OIDCProviderConfig[] {
  if (Array.isArray(site.OIDCProviders)) return site.OIDCProviders;
  if (
    !site.EnableOIDCLogin &&
    !site.OIDCIssuer &&
    !site.OIDCClientId &&
    !site.OIDCAuthorizationEndpoint &&
    !site.OIDCTokenEndpoint &&
    !site.OIDCUserInfoEndpoint &&
    !site.OIDCClientSecret
  )
    return [];
  return [
    {
      id: 'legacy',
      name: site.OIDCButtonText || 'OIDC',
      enabled: site.EnableOIDCLogin || false,
      enableRegistration: site.EnableOIDCRegistration || false,
      issuer: normalizeApiBaseUrl(site.OIDCIssuer),
      authorizationEndpoint: site.OIDCAuthorizationEndpoint?.trim() || '',
      tokenEndpoint: site.OIDCTokenEndpoint?.trim() || '',
      userInfoEndpoint: site.OIDCUserInfoEndpoint?.trim() || '',
      clientId: site.OIDCClientId?.trim() || '',
      clientSecret: site.OIDCClientSecret || '',
      buttonText: site.OIDCButtonText || '',
      minTrustLevel: site.OIDCMinTrustLevel ?? 0,
    },
  ];
}

export function getOIDCProvider(
  site: OIDCSiteConfig,
  id?: string | null,
): OIDCProviderConfig | undefined {
  const enabled = getOIDCProviders(site).filter((provider) => provider.enabled);
  if (id != null) return enabled.find((provider) => provider.id === id);
  return (
    enabled.find((provider) => provider.id === 'legacy') ||
    (enabled.length === 1 ? enabled[0] : undefined)
  );
}

/** Only this projection may be embedded in public runtime configuration. */
export function getPublicOIDCProviders(
  site: OIDCSiteConfig,
): PublicOIDCProvider[] {
  return getOIDCProviders(site)
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      buttonText:
        provider.buttonText ||
        (provider.name ? `使用${provider.name}登录` : '使用OIDC登录'),
      enableRegistration: provider.enableRegistration,
    }));
}

/** Keep existing users intact; all new providers use an isolated subject namespace. */
export function getOIDCSubject(
  provider: OIDCProviderConfig,
  sub: string,
): string {
  if (typeof sub !== 'string' || !sub) throw new Error('OIDC用户标识无效');
  if (provider.id === 'legacy') {
    if (sub.startsWith('oidc:v2:'))
      throw new Error('OIDC用户标识使用了保留前缀');
    return sub;
  }
  const normalized = normalizeProvider(provider);
  const sourceHash = bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify(IDENTITY_FIELDS.map((field) => normalized[field])),
      ),
    ),
  );
  return `oidc:v2:${encodeURIComponent(provider.id)}:${sourceHash}:${encodeURIComponent(sub)}`;
}

function normalizeProvider(provider: OIDCProviderConfig): OIDCProviderConfig {
  return {
    id: provider.id.trim(),
    name: provider.name.trim(),
    enabled: provider.enabled,
    enableRegistration: provider.enableRegistration,
    issuer: normalizeApiBaseUrl(provider.issuer),
    authorizationEndpoint: provider.authorizationEndpoint.trim(),
    tokenEndpoint: provider.tokenEndpoint.trim(),
    userInfoEndpoint: provider.userInfoEndpoint.trim(),
    clientId: provider.clientId.trim(),
    clientSecret: provider.clientSecret,
    buttonText: provider.buttonText.trim(),
    minTrustLevel: provider.minTrustLevel,
  };
}

export function validateOIDCProviders(
  input: unknown,
  current: OIDCSiteConfig,
): OIDCProviderConfig[] {
  if (!Array.isArray(input)) throw new Error('OIDC提供商配置必须是列表');
  const existing = new Map(
    getOIDCProviders(current).map((provider) => [provider.id, provider]),
  );
  const ids = new Set<string>();
  return input.map((value, index) => {
    const label = `第${index + 1}个OIDC提供商`;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      STRING_FIELDS.some((field) => typeof value[field] !== 'string') ||
      typeof value.enabled !== 'boolean' ||
      typeof value.enableRegistration !== 'boolean' ||
      !Number.isSafeInteger(value.minTrustLevel) ||
      value.minTrustLevel < 0
    ) {
      throw new Error(`${label}参数格式错误`);
    }
    const provider = normalizeProvider(value);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(provider.id) || ids.has(provider.id)) {
      throw new Error(`${label}的配置ID无效或重复`);
    }
    ids.add(provider.id);
    const previous = existing.get(provider.id);
    if (provider.id === 'legacy' && !previous) {
      throw new Error('legacy仅用于保留原有OIDC配置，请新增提供商');
    }
    for (const field of URL_FIELDS) {
      if (!provider[field]) continue;
      let url: URL;
      try {
        url = new URL(provider[field]);
      } catch {
        throw new Error(`${label}的${field}不是有效URL`);
      }
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash
      ) {
        throw new Error(
          `${label}的${field}必须是无凭据和片段的HTTP或HTTPS地址`,
        );
      }
    }
    if (
      provider.enabled &&
      (!isOIDCProviderConfigured(provider) || !provider.clientSecret.trim())
    ) {
      throw new Error(
        `${label}启用前必须填写授权、Token、用户信息端点、Client ID和Client Secret`,
      );
    }
    // A stable ID must never silently move existing accounts to another identity source.
    if (previous && isOIDCProviderConfigured(previous)) {
      const normalizedPrevious = normalizeProvider(previous);
      if (
        IDENTITY_FIELDS.some(
          (field) => provider[field] !== normalizedPrevious[field],
        )
      ) {
        throw new Error(
          `${label}的身份来源已固定，更换Issuer、端点或Client ID请新增提供商；原有账号绑定将保留`,
        );
      }
    }
    return provider;
  });
}
