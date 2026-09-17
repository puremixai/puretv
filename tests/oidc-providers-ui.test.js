const React = require('react');
const {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} = require('@testing-library/react');
global.Headers = require('vm').runInThisContext('Headers');

const {
  RegistrationConfigComponent,
} = require('../src/components/admin/RegistrationConfigComponent');

const provider = (id, overrides = {}) => ({
  id,
  name: id,
  enabled: true,
  enableRegistration: false,
  issuer: `https://${id}.example.com`,
  authorizationEndpoint: `https://${id}.example.com/authorize`,
  tokenEndpoint: `https://${id}.example.com/token`,
  userInfoEndpoint: `https://${id}.example.com/userinfo`,
  clientId: `${id}-client`,
  clientSecret: `${id}-secret`,
  buttonText: `使用 ${id} 登录`,
  minTrustLevel: 0,
  ...overrides,
});

beforeEach(() => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
});
afterEach(() => {
  delete window.RUNTIME_CONFIG;
});

function showEditor(SiteConfig) {
  render(
    React.createElement(RegistrationConfigComponent, {
      config: { SiteConfig, UserConfig: { Tags: [] } },
      refreshConfig: jest.fn().mockResolvedValue(undefined),
    }),
  );
  fireEvent.click(screen.getByText('OIDC配置'));
}

test('editing one provider preserves the other provider and legacy configuration when saved', async () => {
  showEditor({
    OIDCProviders: [provider('alpha'), provider('beta')],
    OIDCClientSecret: 'legacy-secret',
    EnableOIDCLogin: false,
  });
  const first = screen.getByRole('group', { name: 'OIDC 提供商 1' });
  const second = screen.getByRole('group', { name: 'OIDC 提供商 2' });
  fireEvent.change(within(first).getByLabelText('提供商名称'), {
    target: { value: 'Company account' },
  });
  fireEvent.click(within(first).getByRole('switch', { name: '启用登录' }));
  fireEvent.click(
    within(second).getByRole('switch', { name: '允许注册新用户' }),
  );
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/site',
      expect.any(Object),
    ),
  );
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body.OIDCProviders).toEqual([
    provider('alpha', { name: 'Company account', enabled: false }),
    provider('beta', { enableRegistration: true }),
  ]);
  expect(body.OIDCClientSecret).toBe('legacy-secret');
  expect(body.EnableOIDCLogin).toBe(false);
});

test('legacy configuration appears as a provider and deleting it saves an explicit empty list', async () => {
  showEditor({
    EnableOIDCLogin: true,
    OIDCClientId: 'old-client',
    OIDCClientSecret: 'old-secret',
    OIDCButtonText: 'Old login',
  });
  const card = screen.getByRole('group', { name: 'OIDC 提供商 1' });
  expect(within(card).getByLabelText('Client ID')).toHaveValue('old-client');
  expect(within(card).getByLabelText('提供商 ID')).toHaveValue('legacy');
  expect(screen.getByText(/旧版 OIDC 配置/)).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: '删除提供商' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body.OIDCProviders).toEqual([]);
  expect(body.OIDCClientSecret).toBe('old-secret');
});

test('new provider IDs remain stable while editing and discovery updates only its provider', async () => {
  showEditor({ OIDCProviders: [provider('alpha')] });
  fireEvent.click(screen.getByRole('button', { name: '添加提供商' }));
  const card = screen.getByRole('group', { name: 'OIDC 提供商 2' });
  const id = within(card).getByLabelText('提供商 ID').value;
  expect(id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(within(card).getByLabelText('提供商 ID')).toHaveAttribute('readonly');
  fireEvent.change(within(card).getByLabelText('提供商名称'), {
    target: { value: 'New provider' },
  });
  fireEvent.change(within(card).getByLabelText('Issuer URL'), {
    target: { value: 'https://new.example.com' },
  });
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      authorization_endpoint: 'https://new.example.com/auth',
      token_endpoint: 'https://new.example.com/token',
      userinfo_endpoint: 'https://new.example.com/me',
    }),
  });
  fireEvent.click(within(card).getByRole('button', { name: '自动发现' }));
  await waitFor(() =>
    expect(within(card).getByLabelText('授权端点')).toHaveValue(
      'https://new.example.com/auth',
    ),
  );
  expect(within(card).getByLabelText('提供商 ID')).toHaveValue(id);
  expect(
    within(screen.getByRole('group', { name: 'OIDC 提供商 1' })).getByLabelText(
      '授权端点',
    ),
  ).toHaveValue('https://alpha.example.com/authorize');
});

test('adding providers in an insecure context works without crypto.randomUUID', () => {
  const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: undefined,
  });
  try {
    showEditor({ OIDCProviders: [] });
    fireEvent.click(screen.getByRole('button', { name: '添加提供商' }));
    const firstCard = screen.getByRole('group', { name: 'OIDC 提供商 1' });
    const firstId = within(firstCard).getByLabelText('提供商 ID').value;
    expect(firstId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    fireEvent.change(within(firstCard).getByLabelText('提供商名称'), {
      target: { value: 'Local provider' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加提供商' }));
    const secondId = within(
      screen.getByRole('group', { name: 'OIDC 提供商 2' }),
    ).getByLabelText('提供商 ID').value;
    expect(secondId).not.toBe(firstId);
    expect(within(firstCard).getByLabelText('提供商 ID')).toHaveValue(firstId);
    expect(within(firstCard).getByLabelText('提供商 ID')).toHaveAttribute(
      'readonly',
    );
  } finally {
    if (original) Object.defineProperty(crypto, 'randomUUID', original);
    else delete crypto.randomUUID;
  }
});

test('saved identity connections are read-only while rotating the secret stays available', () => {
  showEditor({ OIDCProviders: [provider('alpha')] });
  const card = screen.getByRole('group', { name: 'OIDC 提供商 1' });
  for (const label of [
    'Issuer URL',
    'Client ID',
    '授权端点',
    'Token 端点',
    '用户信息端点',
  ]) {
    expect(within(card).getByLabelText(label)).toHaveAttribute('readonly');
  }
  expect(within(card).getByLabelText('Client Secret')).not.toHaveAttribute(
    'readonly',
  );
  expect(within(card).getByRole('button', { name: '自动发现' })).toBeDisabled();
});

test('the callback address uses the configured external site base', () => {
  window.RUNTIME_CONFIG = { SITE_BASE: ' https://tv.example.com/ ' };
  showEditor({ OIDCProviders: [] });
  expect(screen.getByLabelText('OIDC Redirect URI（回调地址）')).toHaveValue(
    'https://tv.example.com/api/auth/oidc/callback',
  );
});
