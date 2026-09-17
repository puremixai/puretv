/** @jest-environment node */
const {
  getOIDCProviders,
  getOIDCProvider,
  getPublicOIDCProviders,
  getOIDCSubject,
  validateOIDCProviders,
} = require('../src/lib/oidc');

const provider = (id, patch = {}) => ({
  id,
  name: id,
  enabled: true,
  enableRegistration: true,
  issuer: `https://${id}.example.com`,
  authorizationEndpoint: `https://${id}.example.com/auth`,
  tokenEndpoint: `https://${id}.example.com/token`,
  userInfoEndpoint: `https://${id}.example.com/userinfo`,
  clientId: `${id}-client`,
  clientSecret: 'private-secret',
  buttonText: '',
  minTrustLevel: 0,
  ...patch,
});
const legacy = {
  EnableOIDCLogin: true,
  EnableOIDCRegistration: true,
  OIDCIssuer: 'https://old.example.com/',
  OIDCAuthorizationEndpoint: 'https://old.example.com/auth',
  OIDCTokenEndpoint: 'https://old.example.com/token',
  OIDCUserInfoEndpoint: 'https://old.example.com/userinfo',
  OIDCClientId: 'old-client',
  OIDCClientSecret: 'old-secret',
  OIDCButtonText: '旧站账号',
  OIDCMinTrustLevel: 2,
};

test('legacy settings keep the original identity and registration policy', () => {
  const providers = getOIDCProviders(legacy);
  expect(providers).toHaveLength(1);
  expect(providers[0]).toMatchObject({
    id: 'legacy',
    enabled: true,
    enableRegistration: true,
    minTrustLevel: 2,
  });
  expect(getOIDCSubject(providers[0], 'alice')).toBe('alice');
  expect(getOIDCProviders({})).toEqual([]);
  expect(getOIDCProviders({ ...legacy, OIDCProviders: [] })).toEqual([]);
});

test('selects only enabled providers and does not silently select from an ambiguous list', () => {
  const a = provider('a');
  const b = provider('b');
  const site = { ...legacy, OIDCProviders: [a, b] };
  expect(getOIDCProvider(site, 'b')).toEqual(b);
  expect(getOIDCProvider(site, 'missing')).toBeUndefined();
  expect(getOIDCProvider(site)).toBeUndefined();
  expect(
    getOIDCProvider({ OIDCProviders: [a, { ...b, enabled: false }] }),
  ).toEqual(a);
  expect(
    getOIDCProvider({ OIDCProviders: [{ ...a, enabled: false }] }, 'a'),
  ).toBeUndefined();
});

test('public configuration contains button metadata without credentials or endpoints', () => {
  expect(
    getPublicOIDCProviders({
      OIDCProviders: [provider('a'), provider('b', { enabled: false })],
    }),
  ).toEqual([
    { id: 'a', name: 'a', buttonText: '使用a登录', enableRegistration: true },
  ]);
});

test('identical subjects from different providers remain separate and encoding is unambiguous', () => {
  const { createHash } = require('node:crypto');
  const hashA = createHash('sha256')
    .update(
      JSON.stringify([
        'https://a.example.com',
        'https://a.example.com/auth',
        'https://a.example.com/token',
        'https://a.example.com/userinfo',
        'a-client',
      ]),
    )
    .digest('hex');
  expect(getOIDCSubject(provider('a'), '123')).toBe(`oidc:v2:a:${hashA}:123`);
  expect(getOIDCSubject(provider('b'), '123')).not.toBe(
    getOIDCSubject(provider('a'), '123'),
  );
  expect(getOIDCSubject(provider('a'), 'b:c')).toBe(`oidc:v2:a:${hashA}:b%3Ac`);
  expect(() => getOIDCSubject(provider('legacy'), 'oidc:v2:a:123')).toThrow();
});

test('reusing a removed provider ID with another identity source never restores the old binding', () => {
  const original = provider('a');
  const recreated = validateOIDCProviders(
    [{ ...original, userInfoEndpoint: 'https://other.example.com/userinfo' }],
    { OIDCProviders: [] },
  )[0];
  expect(getOIDCSubject(recreated, '123')).not.toBe(
    getOIDCSubject(original, '123'),
  );
  expect(getOIDCSubject({ ...original, clientSecret: 'rotated' }, '123')).toBe(
    getOIDCSubject(original, '123'),
  );
});

test.each([
  null,
  {},
  [provider('a'), provider('a')],
  [provider('a', { enabled: 'yes' })],
  [provider('a', { tokenEndpoint: 'javascript:alert(1)' })],
  [provider('a', { clientSecret: '' })],
  [provider('a', { minTrustLevel: -1 })],
  [provider('a', { minTrustLevel: 1.5 })],
  [provider('../bad')],
])('invalid provider lists are rejected before saving: %j', (list) => {
  expect(() => validateOIDCProviders(list, {})).toThrow();
});

test('disabled drafts are allowed, enabled providers must be complete, and removing all is explicit', () => {
  expect(
    validateOIDCProviders(
      [
        provider('a', {
          enabled: false,
          clientId: '',
          clientSecret: '',
          authorizationEndpoint: '',
        }),
      ],
      {},
    ),
  ).toHaveLength(1);
  expect(validateOIDCProviders([], legacy)).toEqual([]);
});

test('migration accepts the legacy provider but cannot introduce or resurrect one', () => {
  const migrated = getOIDCProviders(legacy);
  expect(validateOIDCProviders(migrated, legacy)).toEqual(migrated);
  expect(() => validateOIDCProviders(migrated, {})).toThrow();
  expect(() =>
    validateOIDCProviders(migrated, { ...legacy, OIDCProviders: [] }),
  ).toThrow();
});

test('credential rotation is allowed but replacing an established identity source requires a new provider', () => {
  const a = provider('a');
  const site = { OIDCProviders: [a] };
  expect(
    validateOIDCProviders(
      [{ ...a, clientSecret: 'rotated', name: 'renamed' }],
      site,
    )[0].clientSecret,
  ).toBe('rotated');
  for (const field of [
    'issuer',
    'authorizationEndpoint',
    'tokenEndpoint',
    'userInfoEndpoint',
    'clientId',
  ]) {
    expect(() =>
      validateOIDCProviders(
        [
          {
            ...a,
            [field]:
              field === 'clientId' ? 'other' : 'https://other.example.com',
          },
        ],
        site,
      ),
    ).toThrow();
  }
});
