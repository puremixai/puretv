/** @jest-environment node */
require('./web-globals');
const { webcrypto, createHash, createHmac } = require('crypto');
const { NextRequest } = require('next/server');

jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('../src/lib/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../src/lib/db', () => ({
  db: {
    getUserByOidcSub: jest.fn(),
    getUserInfoV2: jest.fn(),
    checkUserExistV2: jest.fn(),
    createUserV2: jest.fn(),
  },
}));
jest.mock('../src/lib/auth-cookie', () => ({
  generateAuthCookieValue: jest.fn().mockResolvedValue('signed-auth'),
}));
jest.mock('../src/lib/auth-response', () => ({
  setAuthCookies: (response, value) => response.cookies.set('auth', value),
}));
const { getConfig } = require('../src/lib/config');
const { db } = require('../src/lib/db');
const { GET: login } = require('../src/app/api/auth/oidc/login/route');
const { GET: callback } = require('../src/app/api/auth/oidc/callback/route');
const {
  GET: sessionInfo,
} = require('../src/app/api/auth/oidc/session-info/route');
const {
  POST: register,
} = require('../src/app/api/auth/oidc/complete-register/route');

const provider = (id, overrides = {}) => ({
  id,
  name: id,
  enabled: true,
  enableRegistration: true,
  issuer: `https://${id}.example`,
  authorizationEndpoint: `https://${id}.example/authorize`,
  tokenEndpoint: `https://${id}.example/token`,
  userInfoEndpoint: `https://${id}.example/userinfo`,
  clientId: `${id}-client`,
  clientSecret: `${id}-secret`,
  buttonText: `${id} login`,
  minTrustLevel: 0,
  ...overrides,
});
let config;
let now;
const nativeFetch = global.fetch;
const authRequest = (path, cookies = {}, body) => {
  const request = new NextRequest(`https://tv.example${path}`, {
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: {
      'user-agent': 'Mozilla Windows',
      'content-type': 'application/json',
    },
  });
  for (const [key, value] of Object.entries(cookies))
    request.cookies.set(key, value);
  return request;
};
const location = (response) => new URL(response.headers.get('location'));
async function start(id = 'alpha') {
  const response = await login(
    authRequest(`/api/auth/oidc/login?provider=${id}`),
  );
  expect(response.status).toBe(307);
  const state = location(response).searchParams.get('state');
  return { state, cookie: response.cookies.get('oidc_state').value, response };
}
async function finish(transaction, query = '') {
  return callback(
    authRequest(
      `/api/auth/oidc/callback?code=test-code&state=${transaction.state}${query}`,
      { oidc_state: transaction.cookie },
    ),
  );
}
async function registrationSession(id = 'alpha') {
  const response = await finish(await start(id));
  expect(location(response).pathname).toBe('/oidc-register');
  return response.cookies.get('oidc_session').value;
}
beforeEach(() => {
  jest.clearAllMocks();
  global.crypto = webcrypto;
  now = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  process.env.AUTH_SECRET = 'oidc-auth-test-secret';
  process.env.PASSWORD = 'fallback-test-password';
  process.env.USERNAME = 'owner';
  delete process.env.SITE_BASE;
  config = {
    SiteConfig: {
      OIDCProviders: [provider('alpha'), provider('beta')],
      DefaultUserTags: ['new-user'],
    },
  };
  getConfig.mockImplementation(async () => config);
  db.getUserByOidcSub.mockResolvedValue(null);
  db.getUserInfoV2.mockResolvedValue({ role: 'user', banned: false });
  db.checkUserExistV2.mockResolvedValue(false);
  db.createUserV2.mockResolvedValue(undefined);
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/token')
        ? { access_token: 'access-token', id_token: 'id-token' }
        : {
            sub: 'same-subject',
            email: 'same@example.com',
            name: 'Alice',
            trust_level: 2,
          },
  }));
});
afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = nativeFetch;
  delete process.env.AUTH_SECRET;
});

test.each(['alpha', 'beta'])(
  'selects %s endpoints and credentials throughout its login transaction',
  async (id) => {
    db.getUserByOidcSub.mockResolvedValue('alice');
    const transaction = await start(id);
    expect(location(transaction.response).origin).toBe(`https://${id}.example`);
    expect(location(transaction.response).searchParams.get('client_id')).toBe(
      `${id}-client`,
    );
    expect(
      location(transaction.response).searchParams.get('redirect_uri'),
    ).toBe('https://tv.example/api/auth/oidc/callback');
    const response = await finish(
      transaction,
      `&provider=${id === 'alpha' ? 'beta' : 'alpha'}`,
    );
    expect(location(response).pathname).toBe('/');
    expect(response.cookies.get('auth').value).toBe('signed-auth');
    expect(global.fetch.mock.calls[0][0]).toBe(`https://${id}.example/token`);
    expect(global.fetch.mock.calls[0][1].body.get('client_id')).toBe(
      `${id}-client`,
    );
    expect(global.fetch.mock.calls[0][1].body.get('client_secret')).toBe(
      `${id}-secret`,
    );
    expect(global.fetch.mock.calls[1][0]).toBe(
      `https://${id}.example/userinfo`,
    );
  },
);

test('unknown, disabled, and ambiguous provider selections never start authorization', async () => {
  config.SiteConfig.OIDCProviders[1].enabled = false;
  expect(
    (await login(authRequest('/api/auth/oidc/login?provider=unknown'))).status,
  ).toBe(403);
  expect(
    (await login(authRequest('/api/auth/oidc/login?provider=beta'))).status,
  ).toBe(403);
  config.SiteConfig.OIDCProviders[1].enabled = true;
  expect((await login(authRequest('/api/auth/oidc/login'))).status).toBe(403);
});

test.each([
  'disabled',
  'deleted',
  'issuer',
  'clientId',
  'clientSecret',
  'tokenEndpoint',
  'userInfoEndpoint',
])(
  'callback rejects a provider that was changed after login: %s',
  async (change) => {
    const transaction = await start();
    if (change === 'disabled')
      config.SiteConfig.OIDCProviders[0].enabled = false;
    else if (change === 'deleted') config.SiteConfig.OIDCProviders.shift();
    else config.SiteConfig.OIDCProviders[0][change] = `changed-${change}`;
    const response = await finish(transaction);
    expect(location(response).pathname).toBe('/login');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.getUserByOidcSub).not.toHaveBeenCalled();
  },
);

test.each(['tampered', 'unsigned', 'expired', 'future', 'wrong-state'])(
  'callback rejects %s login transactions before any token request',
  async (change) => {
    const transaction = await start();
    if (change === 'tampered') transaction.cookie += 'x';
    if (change === 'unsigned') transaction.cookie = transaction.state;
    if (change === 'expired') now += 600001;
    if (change === 'future') now -= 1000;
    if (change === 'wrong-state') transaction.state = 'other-state';
    expect(location(await finish(transaction)).pathname).toBe('/login');
    expect(global.fetch).not.toHaveBeenCalled();
  },
);

test('same subject and email from distinct providers create independent OIDC bindings', async () => {
  const bindings = [];
  for (const [id, username] of [
    ['alpha', 'alice'],
    ['beta', 'bob'],
  ]) {
    const cookie = await registrationSession(id);
    const response = await register(
      authRequest(
        '/api/auth/oidc/complete-register',
        { oidc_session: cookie },
        { username },
      ),
    );
    expect(response.status).toBe(200);
    bindings.push(db.createUserV2.mock.calls.at(-1)[4]);
  }
  const alphaSource = createHash('sha256')
    .update(
      JSON.stringify([
        'https://alpha.example',
        'https://alpha.example/authorize',
        'https://alpha.example/token',
        'https://alpha.example/userinfo',
        'alpha-client',
      ]),
    )
    .digest('hex');
  const betaSource = createHash('sha256')
    .update(
      JSON.stringify([
        'https://beta.example',
        'https://beta.example/authorize',
        'https://beta.example/token',
        'https://beta.example/userinfo',
        'beta-client',
      ]),
    )
    .digest('hex');
  expect(bindings).toEqual([
    `oidc:v2:alpha:${alphaSource}:same-subject`,
    `oidc:v2:beta:${betaSource}:same-subject`,
  ]);
  expect(db.getUserByOidcSub).not.toHaveBeenCalledWith('same-subject');
});

test('registration info returns signed claims without exposing the identity binding', async () => {
  const cookie = await registrationSession();
  const response = await sessionInfo(
    authRequest('/api/auth/oidc/session-info', { oidc_session: cookie }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    email: 'same@example.com',
    name: 'Alice',
    trust_level: 2,
  });
});

test('a login transaction cannot be substituted for a registration session', async () => {
  const { cookie } = await start();
  const response = await register(
    authRequest(
      '/api/auth/oidc/complete-register',
      { oidc_session: cookie },
      { username: 'alice' },
    ),
  );
  expect(response.status).toBe(400);
  expect(db.createUserV2).not.toHaveBeenCalled();
});

test.each([
  { providerId: 'beta' },
  { sub: 'victim-subject' },
  { trust_level: 99 },
])('registration refuses a modified signed payload: %j', async (patch) => {
  const cookie = await registrationSession();
  const [version, encoded, signature] = cookie.split('.');
  const payload = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8'),
  );
  const modified = Buffer.from(
    JSON.stringify({ ...payload, ...patch }),
  ).toString('base64url');
  const response = await register(
    authRequest(
      '/api/auth/oidc/complete-register',
      {
        oidc_session: `${version}.${modified}.${signature}`,
      },
      { username: 'alice' },
    ),
  );
  expect(response.status).toBe(400);
  expect(db.createUserV2).not.toHaveBeenCalled();
});

test.each([undefined, null, 'today', 0, -1])(
  'even signed registration sessions reject an invalid timestamp: %j',
  async (timestamp) => {
    const cookie = await registrationSession();
    const original = JSON.parse(
      Buffer.from(cookie.split('.')[1], 'base64url').toString('utf8'),
    );
    const encoded = Buffer.from(
      JSON.stringify({ ...original, timestamp }),
    ).toString('base64url');
    const signature = createHmac('sha256', 'oidc-auth-test-secret')
      .update(`puretv:oidc:registration:v1:${encoded}`)
      .digest('hex');
    const response = await register(
      authRequest(
        '/api/auth/oidc/complete-register',
        {
          oidc_session: `v1.${encoded}.${signature}`,
        },
        { username: 'alice' },
      ),
    );
    expect(response.status).toBe(400);
    expect(db.createUserV2).not.toHaveBeenCalled();
  },
);

test('a changed provider ID in an otherwise valid login transaction fails signature verification', async () => {
  const transaction = await start();
  const [version, encoded, signature] = transaction.cookie.split('.');
  const original = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8'),
  );
  const modified = Buffer.from(
    JSON.stringify({ ...original, providerId: 'beta' }),
  ).toString('base64url');
  transaction.cookie = `${version}.${modified}.${signature}`;
  expect(location(await finish(transaction)).pathname).toBe('/login');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('missing signing secrets fail closed for login and existing registration sessions', async () => {
  const cookie = await registrationSession();
  delete process.env.AUTH_SECRET;
  delete process.env.PASSWORD;
  expect(
    (await login(authRequest('/api/auth/oidc/login?provider=alpha'))).status,
  ).toBe(500);
  const response = await register(
    authRequest(
      '/api/auth/oidc/complete-register',
      { oidc_session: cookie },
      { username: 'alice' },
    ),
  );
  expect(response.status).toBe(400);
  expect(db.createUserV2).not.toHaveBeenCalled();
});

test('PASSWORD signs OIDC sessions when AUTH_SECRET is absent', async () => {
  delete process.env.AUTH_SECRET;
  expect(await registrationSession()).toBeTruthy();
});

test.each([
  'tampered',
  'unsigned',
  'expired',
  'future',
  'disabled',
  'deleted',
  'registration-disabled',
  'trust-raised',
  'client-changed',
])(
  'registration and session-info reject %s sessions without creating a user',
  async (change) => {
    let cookie = await registrationSession();
    if (change === 'tampered') cookie += 'x';
    if (change === 'unsigned')
      cookie = JSON.stringify({
        sub: 'victim',
        email: 'same@example.com',
        trust_level: 99,
        timestamp: now,
      });
    if (change === 'expired') now += 600001;
    if (change === 'future') now -= 1000;
    if (change === 'disabled')
      config.SiteConfig.OIDCProviders[0].enabled = false;
    if (change === 'deleted') config.SiteConfig.OIDCProviders.shift();
    if (change === 'registration-disabled')
      config.SiteConfig.OIDCProviders[0].enableRegistration = false;
    if (change === 'trust-raised')
      config.SiteConfig.OIDCProviders[0].minTrustLevel = 3;
    if (change === 'client-changed')
      config.SiteConfig.OIDCProviders[0].clientId = 'new-client';
    const info = await sessionInfo(
      authRequest('/api/auth/oidc/session-info', { oidc_session: cookie }),
    );
    const response = await register(
      authRequest(
        '/api/auth/oidc/complete-register',
        { oidc_session: cookie },
        { username: 'alice' },
      ),
    );
    expect(info.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(db.createUserV2).not.toHaveBeenCalled();
  },
);

test('existing users can login when registration is disabled, new users cannot', async () => {
  config.SiteConfig.OIDCProviders[0].enableRegistration = false;
  expect(location(await finish(await start())).pathname).toBe('/login');
  db.getUserByOidcSub.mockResolvedValue('alice');
  expect(location(await finish(await start())).pathname).toBe('/');
});

test('an orphaned OIDC binding cannot create an authenticated login session', async () => {
  db.getUserByOidcSub.mockResolvedValue('deleted-user');
  db.getUserInfoV2.mockResolvedValue(null);
  const response = await finish(await start());
  expect(location(response).pathname).toBe('/login');
  expect(response.cookies.get('auth')).toBeUndefined();
});

test('SITE_BASE with a trailing slash uses the same callback URL for authorization and token exchange', async () => {
  process.env.SITE_BASE = ' https://public.example/ ';
  const transaction = await start();
  expect(location(transaction.response).searchParams.get('redirect_uri')).toBe(
    'https://public.example/api/auth/oidc/callback',
  );
  const response = await finish(transaction);
  expect(location(response).origin).toBe('https://public.example');
  expect(global.fetch.mock.calls[0][1].body.get('redirect_uri')).toBe(
    'https://public.example/api/auth/oidc/callback',
  );
});

test('registration uses each provider trust threshold and rejects missing or nonnumeric trust claims', async () => {
  config.SiteConfig.OIDCProviders[0].minTrustLevel = 3;
  expect(location(await finish(await start())).pathname).toBe('/login');
  expect(await registrationSession('beta')).toBeTruthy();
  config.SiteConfig.OIDCProviders[1].minTrustLevel = 1;
  global.fetch.mockImplementation(async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/token')
        ? { access_token: 'access', id_token: 'id' }
        : { sub: 'subject', trust_level: 'admin' },
  }));
  expect(location(await finish(await start('beta'))).pathname).toBe('/login');
});

test('legacy flat configuration keeps the existing unprefixed OIDC identity', async () => {
  config.SiteConfig = {
    EnableOIDCLogin: true,
    EnableOIDCRegistration: true,
    OIDCIssuer: 'https://legacy.example',
    OIDCAuthorizationEndpoint: 'https://legacy.example/authorize',
    OIDCTokenEndpoint: 'https://legacy.example/token',
    OIDCUserInfoEndpoint: 'https://legacy.example/userinfo',
    OIDCClientId: 'legacy-client',
    OIDCClientSecret: 'legacy-secret',
  };
  db.getUserByOidcSub.mockResolvedValue('legacy-user');
  const response = await login(authRequest('/api/auth/oidc/login'));
  const completed = await finish({
    state: location(response).searchParams.get('state'),
    cookie: response.cookies.get('oidc_state').value,
  });
  expect(location(completed).pathname).toBe('/');
  expect(db.getUserByOidcSub).toHaveBeenCalledWith('same-subject');
});
