/** @jest-environment node */
jest.mock('next/font/google', () => ({
  Inter: () => ({ className: 'inter' }),
}));
jest.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
jest.mock('../src/lib/auth', () => ({ parseAuthInfo: () => null }));
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('../src/lib/permissions', () => ({
  getUserFeatureAccess: async () => ({}),
}));
jest.mock('../src/lib/source-script', () => ({
  listEnabledSourceScripts: async () => [],
}));

// Inspect the server-created element tree without mounting unrelated client providers.
for (const [path, exportedName] of [
  ['CinematicScope'],
  ['DanmakuCacheCleanup', 'StartupCacheCleanup'],
  ['DownloadBubble', 'DownloadBubble'],
  ['DownloadPanel', 'DownloadPanel'],
  ['GlobalErrorIndicator', 'GlobalErrorIndicator'],
  ['PwaRegistration'],
  ['RouteScrollReset'],
  ['SiteProvider', 'SiteProvider'],
  ['ThemeProvider', 'ThemeProvider'],
  ['TokenRefreshManager', 'TokenRefreshManager'],
  ['TopProgressBar'],
  ['watch-room/ChatFloatingWindow'],
  ['WatchRoomProvider', 'WatchRoomProvider'],
]) {
  jest.doMock(`../src/components/${path}`, () => ({
    __esModule: true,
    [exportedName || 'default']: () => null,
  }));
}
jest.mock('../src/contexts/DownloadContext', () => ({
  DownloadProvider: () => null,
}));

const RootLayout = require('../src/app/layout').default;
const { getConfig } = require('../src/lib/config');
const previousStorage = process.env.NEXT_PUBLIC_STORAGE_TYPE;
const previousBase = process.env.SITE_BASE;

afterEach(() => {
  if (previousStorage === undefined)
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
  else process.env.NEXT_PUBLIC_STORAGE_TYPE = previousStorage;
  if (previousBase === undefined) delete process.env.SITE_BASE;
  else process.env.SITE_BASE = previousBase;
});

test('SSR publishes only safe enabled providers and safely serializes provider labels', async () => {
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'sqlite';
  process.env.SITE_BASE = 'https://tv.example.com';
  const name = 'Company </script><script>alert(1)</script>';
  getConfig.mockResolvedValue({
    CustomCategories: [],
    SiteConfig: {
      SiteName: 'Test site',
      EnableOIDCLogin: false,
      OIDCProviders: [
        {
          id: 'company',
          name,
          enabled: true,
          enableRegistration: true,
          buttonText: 'Company login',
          clientId: 'private-id',
          clientSecret: 'private-secret',
          issuer: 'https://private.example.com',
        },
        {
          id: 'hidden',
          name: 'Hidden',
          enabled: false,
          enableRegistration: false,
          buttonText: 'Hidden login',
        },
      ],
    },
  });
  const tree = await RootLayout({ children: null });
  const head = tree.props.children.find((child) => child.type === 'head');
  const script = head.props.children.find(
    (child) => child?.type === 'script' && child.props.dangerouslySetInnerHTML,
  );
  const source = script.props.dangerouslySetInnerHTML.__html;
  const runtime = JSON.parse(
    source.replace(/^window\.RUNTIME_CONFIG = /, '').replace(/;$/, ''),
  );
  expect(runtime.OIDC_PROVIDERS).toEqual([
    {
      id: 'company',
      name,
      enableRegistration: true,
      buttonText: 'Company login',
    },
  ]);
  expect(runtime.ENABLE_OIDC_LOGIN).toBe(true);
  expect(runtime.ENABLE_OIDC_REGISTRATION).toBe(true);
  expect(runtime.SITE_BASE).toBe('https://tv.example.com');
  expect(source).not.toContain('</script>');
  expect(source).not.toMatch(/private-id|private-secret|private\.example/);
});
