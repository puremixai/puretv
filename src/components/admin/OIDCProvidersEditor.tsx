'use client';

import { useState } from 'react';

import { adminFetch } from '@/lib/admin-fetch';
import { isOIDCProviderConfigured, OIDCProviderConfig } from '@/lib/oidc';

import { buttonStyles } from '@/components/admin/shared';

const inputClass =
  'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent read-only:bg-gray-50 dark:read-only:bg-gray-900';
const labelClass =
  'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';

function createProviderId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // getRandomValues also works on HTTP LAN sites, unlike randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const textFields = [
  { key: 'name', label: '提供商名称', placeholder: '例如：企业账号' },
  {
    key: 'buttonText',
    label: '登录按钮文字',
    placeholder: '留空使用提供商名称',
  },
  {
    key: 'authorizationEndpoint',
    label: '授权端点',
    placeholder: 'https://provider.example/authorize',
    connection: true,
  },
  {
    key: 'tokenEndpoint',
    label: 'Token 端点',
    placeholder: 'https://provider.example/token',
    connection: true,
  },
  {
    key: 'userInfoEndpoint',
    label: '用户信息端点',
    placeholder: 'https://provider.example/userinfo',
    connection: true,
  },
  {
    key: 'clientId',
    label: 'Client ID',
    placeholder: '请输入 Client ID',
    connection: true,
  },
  {
    key: 'clientSecret',
    label: 'Client Secret',
    placeholder: '请输入 Client Secret',
  },
] as const;

function ProviderCard({
  provider,
  index,
  connectionLocked,
  onUpdate,
  onRemove,
}: {
  provider: OIDCProviderConfig;
  index: number;
  connectionLocked: boolean;
  onUpdate: (id: string, updates: Partial<OIDCProviderConfig>) => void;
  onRemove: (id: string) => void;
}) {
  const [discovering, setDiscovering] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const prefix = `oidc-${provider.id}`;

  const discover = async () => {
    if (!provider.issuer.trim()) {
      setNotice({ text: '请先输入 Issuer URL', error: true });
      return;
    }
    setDiscovering(true);
    setNotice(null);
    try {
      const response = await adminFetch('/api/admin/oidc-discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issuerUrl: provider.issuer.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '获取配置失败');
      onUpdate(provider.id, {
        authorizationEndpoint: data.authorization_endpoint || '',
        tokenEndpoint: data.token_endpoint || '',
        userInfoEndpoint: data.userinfo_endpoint || '',
      });
      setNotice({ text: '自动发现成功', error: false });
    } catch (error) {
      setNotice({
        text:
          error instanceof Error
            ? error.message
            : '自动发现失败，请手动配置端点',
        error: true,
      });
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <fieldset
      aria-label={`OIDC 提供商 ${index + 1}`}
      className='min-w-0 space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700'
    >
      <div className='flex items-center justify-between gap-3'>
        <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
          {provider.name || `提供商 ${index + 1}`}
        </h4>
        <button
          type='button'
          onClick={() => onRemove(provider.id)}
          className={buttonStyles.dangerSmall}
        >
          删除提供商
        </button>
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        {(
          [
            ['enabled', '启用登录'],
            ['enableRegistration', '允许注册新用户'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className='flex items-center justify-between gap-3'>
            <span
              id={`${prefix}-${key}-label`}
              className='text-sm font-medium text-gray-700 dark:text-gray-300'
            >
              {label}
            </span>
            <button
              type='button'
              role='switch'
              aria-checked={provider[key]}
              aria-labelledby={`${prefix}-${key}-label`}
              onClick={() => onUpdate(provider.id, { [key]: !provider[key] })}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:outline-hidden ${provider[key] ? buttonStyles.toggleOn : buttonStyles.toggleOff}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full ${buttonStyles.toggleThumb} transition-transform ${provider[key] ? buttonStyles.toggleThumbOn : buttonStyles.toggleThumbOff}`}
              />
            </button>
          </div>
        ))}
      </div>
      <p className='text-xs text-gray-500 dark:text-gray-400'>
        仅启用的提供商会显示在登录页；关闭注册后，仅已绑定该提供商的用户可以登录。
      </p>
      <div>
        <label htmlFor={`${prefix}-id`} className={labelClass}>
          提供商 ID
        </label>
        <input
          id={`${prefix}-id`}
          value={provider.id}
          readOnly
          className={`${inputClass} font-mono text-xs`}
        />
      </div>
      {connectionLocked && (
        <p className='text-xs text-gray-500 dark:text-gray-400'>
          更换身份来源或 Client ID
          请新增提供商，原有账号绑定保留。密钥可直接更新。
        </p>
      )}
      <div>
        <label htmlFor={`${prefix}-issuer`} className={labelClass}>
          Issuer URL
        </label>
        <div className='flex flex-col gap-2 sm:flex-row'>
          <input
            id={`${prefix}-issuer`}
            value={provider.issuer}
            placeholder='https://provider.example'
            readOnly={connectionLocked || discovering}
            onChange={(event) =>
              onUpdate(provider.id, { issuer: event.target.value })
            }
            className={inputClass}
          />
          <button
            type='button'
            onClick={discover}
            disabled={connectionLocked || discovering}
            className={`${connectionLocked || discovering ? buttonStyles.disabled : buttonStyles.primary} shrink-0`}
          >
            {discovering ? '发现中...' : '自动发现'}
          </button>
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          可自动发现端点，也可手动填写下方端点。
        </p>
        {notice && (
          <p
            role={notice.error ? 'alert' : 'status'}
            className={`mt-2 text-sm ${notice.error ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}
          >
            {notice.text}
          </p>
        )}
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        {textFields.map((field) => (
          <div key={field.key}>
            <label htmlFor={`${prefix}-${field.key}`} className={labelClass}>
              {field.label}
            </label>
            <input
              id={`${prefix}-${field.key}`}
              type={field.key === 'clientSecret' ? 'password' : 'text'}
              autoComplete={
                field.key === 'clientSecret' ? 'new-password' : 'off'
              }
              value={provider[field.key]}
              placeholder={field.placeholder}
              readOnly={
                'connection' in field && (connectionLocked || discovering)
              }
              onChange={(event) =>
                onUpdate(provider.id, { [field.key]: event.target.value })
              }
              className={inputClass}
            />
          </div>
        ))}
        <div>
          <label htmlFor={`${prefix}-trust`} className={labelClass}>
            最低信任等级
          </label>
          <input
            id={`${prefix}-trust`}
            type='number'
            min='0'
            max='4'
            step='1'
            value={provider.minTrustLevel}
            onChange={(event) =>
              onUpdate(provider.id, {
                minTrustLevel: Math.min(
                  4,
                  Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                ),
              })
            }
            className={inputClass}
          />
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            仅 LinuxDo 有效。0 表示不限制，1–4 表示最低信任等级。
          </p>
        </div>
      </div>
    </fieldset>
  );
}

export function OIDCProvidersEditor({
  providers,
  savedProviders,
  isLegacy,
  onChange,
}: {
  providers: OIDCProviderConfig[];
  savedProviders: OIDCProviderConfig[];
  isLegacy: boolean;
  onChange: (
    update: (providers: OIDCProviderConfig[]) => OIDCProviderConfig[],
  ) => void;
}) {
  const [copyMessage, setCopyMessage] = useState('');
  const callbackUrl =
    typeof window === 'undefined'
      ? ''
      : `${(
          (window as Window & { RUNTIME_CONFIG?: { SITE_BASE?: string } })
            .RUNTIME_CONFIG?.SITE_BASE || window.location.origin
        )
          .trim()
          .replace(/\/+$/, '')}/api/auth/oidc/callback`;

  return (
    <div className='mt-4 space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-xs text-gray-500 dark:text-gray-400'>
          每个提供商可独立配置登录和注册。
        </p>
        <button
          type='button'
          className={buttonStyles.success}
          onClick={() =>
            onChange((current) => [
              ...current,
              {
                id: createProviderId(),
                name: '',
                enabled: false,
                enableRegistration: false,
                issuer: '',
                authorizationEndpoint: '',
                tokenEndpoint: '',
                userInfoEndpoint: '',
                clientId: '',
                clientSecret: '',
                buttonText: '',
                minTrustLevel: 0,
              },
            ])
          }
        >
          添加提供商
        </button>
      </div>
      {isLegacy && (
        <p className='text-xs text-gray-500 dark:text-gray-400'>
          旧版 OIDC
          配置已显示为一张提供商卡片，保存后将使用提供商列表，现有账号绑定继续有效。
        </p>
      )}
      {providers.length === 0 && (
        <p className='rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400'>
          尚未配置 OIDC 提供商。添加并启用提供商后，登录页将显示对应入口。
        </p>
      )}
      {providers.map((provider, index) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          index={index}
          connectionLocked={savedProviders.some(
            (saved) =>
              saved.id === provider.id && isOIDCProviderConfigured(saved),
          )}
          onUpdate={(id, updates) =>
            onChange((current) =>
              current.map((item) =>
                item.id === id ? { ...item, ...updates } : item,
              ),
            )
          }
          onRemove={(id) =>
            onChange((current) => current.filter((item) => item.id !== id))
          }
        />
      ))}
      <div>
        <label htmlFor='oidc-callback-url' className={labelClass}>
          OIDC Redirect URI（回调地址）
        </label>
        <div className='flex flex-col gap-2 sm:flex-row'>
          <input
            id='oidc-callback-url'
            value={callbackUrl}
            readOnly
            className={inputClass}
          />
          <button
            type='button'
            className={`${buttonStyles.primary} shrink-0`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(callbackUrl);
                setCopyMessage('已复制到剪贴板');
              } catch {
                setCopyMessage('复制失败，请手动复制回调地址');
              }
            }}
          >
            复制
          </button>
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          所有提供商共用此回调地址，请在各提供商的应用配置中添加此地址作为允许的重定向
          URI。
        </p>
        {copyMessage && (
          <p
            role='status'
            className='mt-1 text-xs text-gray-500 dark:text-gray-400'
          >
            {copyMessage}
          </p>
        )}
      </div>
    </div>
  );
}
