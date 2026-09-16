const { searchCacheKey } = require('../src/lib/search-cache.client');
test('browser result cache separates users and source selections with unambiguous keys', () => {
  const keys = [
    searchCacheKey('alice', 'test'),
    searchCacheKey('bob', 'test'),
    searchCacheKey('alice', 'test', true),
    searchCacheKey('alice', 'test', false, true),
    searchCacheKey('alice', 'test_special'),
  ];
  expect(new Set(keys).size).toBe(5);
  expect(searchCacheKey(undefined, 'test')).toBeNull();
  expect(searchCacheKey('alice', ' test ')).toBe(keys[0]);
  expect(keys[0]).not.toBe('search_cache_test');
});
