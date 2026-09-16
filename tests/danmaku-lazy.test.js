// Jest 27 does not resolve package export subpaths; webpack and Node do.
jest.mock('opencc-js/t2cn', () => ({
  Converter: jest.fn(() => (text) => text.replace(/體/g, '体')),
}), { virtual: true });

beforeEach(() => {
  jest.resetModules();
  localStorage.clear();
});

test('disabled conversion does not initialize the dictionary', async () => {
  const { convertDanmakuFormat } = require('../src/lib/danmaku/api');
  const { Converter } = require('opencc-js/t2cn');
  const result = await convertDanmakuFormat([
    { p: '2,1,25,16777215', m: '繁體' },
  ]);
  expect(result[0]).toMatchObject({ text: '繁體', time: 2, color: '#ffffff' });
  expect(Converter).not.toHaveBeenCalled();
});

test('enabled conversion waits for the dictionary on the first batch and shares it', async () => {
  localStorage.setItem('danmakuTraditionalToSimplified', 'true');
  const { convertDanmakuFormat } = require('../src/lib/danmaku/api');
  const { Converter } = require('opencc-js/t2cn');
  const results = await Promise.all([
    convertDanmakuFormat([{ p: '1,1,25,16777215', m: '繁體' }]),
    convertDanmakuFormat([{ p: '3,5,25,255', m: '字體' }]),
  ]);
  expect(results[0][0].text).toBe('繁体');
  expect(results[1][0]).toMatchObject({
    text: '字体',
    mode: 1,
    color: '#0000ff',
  });
  expect(Converter).toHaveBeenCalledTimes(1);
  expect(Converter).toHaveBeenCalledWith({ from: 'hk', to: 'cn' });
});

test('failed dictionary initialization keeps original text and can be retried', async () => {
  localStorage.setItem('danmakuTraditionalToSimplified', 'true');
  const { Converter } = require('opencc-js/t2cn');
  Converter.mockImplementationOnce(() => {
    throw new Error('temporary failure');
  });
  const { convertDanmakuFormat } = require('../src/lib/danmaku/api');
  const comments = [{ p: '1,1,25,16777215', m: '繁體' }];
  expect((await convertDanmakuFormat(comments))[0].text).toBe('繁體');
  expect((await convertDanmakuFormat(comments))[0].text).toBe('繁体');
});
