const React = require('react');
const { render, screen } = require('@testing-library/react');
const { SiteProvider, useSite } = require('../src/components/SiteProvider');

function SiteName() {
  return React.createElement('h1', null, useSite().siteName);
}

test('the site context defaults to PureTV before a provider supplies a name', () => {
  render(React.createElement(SiteName));
  expect(screen.getByRole('heading', { name: 'PureTV' })).toBeInTheDocument();
});

test('branding defaults do not replace a customized deployment name', () => {
  render(
    React.createElement(
      SiteProvider,
      { siteName: '家庭影院' },
      React.createElement(SiteName),
    ),
  );
  expect(screen.getByRole('heading', { name: '家庭影院' })).toBeInTheDocument();
});
