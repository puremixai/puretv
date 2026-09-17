const React = require('react');
const { render, screen } = require('@testing-library/react');
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('../src/components/SiteProvider', () => ({
  useSite: () => ({ siteName: 'Test site' }),
}));
jest.mock('../src/components/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('../src/components/ProxyImage', () => ({
  __esModule: true,
  default: ({ alt }) => React.createElement('span', null, alt),
}));
jest.mock('../src/lib/version_check', () => ({
  checkForUpdates: async () => 'failed',
  UpdateStatus: { FETCH_FAILED: 'failed' },
}));
const LoginPage = require('../src/app/login/page').default;

afterEach(() => {
  delete window.RUNTIME_CONFIG;
});

test('login renders every public provider independently of the obsolete global switch', async () => {
  window.RUNTIME_CONFIG = {
    STORAGE_TYPE: 'sqlite',
    ENABLE_OIDC_LOGIN: false,
    OIDC_PROVIDERS: [
      {
        id: 'company',
        name: 'Company',
        buttonText: '公司账号登录',
        enableRegistration: false,
      },
      {
        id: 'community',
        name: 'Community',
        buttonText: '社区账号登录',
        enableRegistration: true,
      },
    ],
  };
  render(React.createElement(LoginPage));
  expect(
    await screen.findByRole('link', { name: '公司账号登录' }),
  ).toHaveAttribute('href', '/api/auth/oidc/login?provider=company');
  expect(screen.getByRole('link', { name: '社区账号登录' })).toHaveAttribute(
    'href',
    '/api/auth/oidc/login?provider=community',
  );
});

test('an explicit empty provider list does not resurrect a legacy button', async () => {
  window.RUNTIME_CONFIG = {
    STORAGE_TYPE: 'sqlite',
    ENABLE_OIDC_LOGIN: true,
    OIDC_BUTTON_TEXT: 'Old login',
    OIDC_PROVIDERS: [],
  };
  render(React.createElement(LoginPage));
  await screen.findByLabelText('用户名');
  expect(screen.queryByText('Old login')).not.toBeInTheDocument();
});

test('a cached runtime without a provider list still offers legacy login', async () => {
  window.RUNTIME_CONFIG = {
    STORAGE_TYPE: 'sqlite',
    ENABLE_OIDC_LOGIN: true,
    OIDC_BUTTON_TEXT: 'Old login',
  };
  render(React.createElement(LoginPage));
  expect(
    await screen.findByRole('link', { name: 'Old login' }),
  ).toHaveAttribute('href', '/api/auth/oidc/login?provider=legacy');
});
