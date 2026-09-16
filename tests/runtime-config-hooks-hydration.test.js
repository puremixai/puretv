const React = require('react');
const { act } = require('@testing-library/react');
const { renderToString } = require('react-dom/server.node');
const { hydrateRoot } = require('react-dom/client');
const { useEnableComments } = require('../src/hooks/useEnableComments');
const { useEnableAIComments } = require('../src/hooks/useEnableAIComments');
const {
  useRecommendationDataSource,
} = require('../src/hooks/useRecommendationDataSource');

function ConfigView() {
  return React.createElement(
    'output',
    null,
    JSON.stringify([
      useEnableComments(),
      useEnableAIComments(),
      useRecommendationDataSource(),
    ]),
  );
}

test.each([
  [{}, [true, false, 'Mixed']],
  [
    {
      EnableComments: false,
      AI_COMMENTS_ENABLED: true,
      RecommendationDataSource: 'TMDB',
    },
    [false, true, 'TMDB'],
  ],
])(
  'runtime config hooks hydrate from their server defaults into %j',
  async (config, expected) => {
    const previousConfig = window.RUNTIME_CONFIG;
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root;
    try {
      window.RUNTIME_CONFIG = config;
      container.innerHTML = renderToString(React.createElement(ConfigView));
      // These are also the pre-cleanup hooks' initial useState values.
      expect(container.textContent).toBe(
        JSON.stringify([true, false, 'Mixed']),
      );
      const onRecoverableError = jest.fn();
      await act(async () => {
        root = hydrateRoot(container, React.createElement(ConfigView), {
          onRecoverableError,
        });
      });
      expect(container.textContent).toBe(JSON.stringify(expected));
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      if (root) await act(async () => root.unmount());
      container.remove();
      if (previousConfig === undefined) delete window.RUNTIME_CONFIG;
      else window.RUNTIME_CONFIG = previousConfig;
    }
  },
);
