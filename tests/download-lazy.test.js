/** @jest-environment node */
jest.mock('mux.js', () => ({
  mp4: {
    Transmuxer: jest.fn().mockImplementation(() => {
      let listener;
      return {
        on: (_event, callback) => {
          listener = callback;
        },
        push: jest.fn(),
        flush: () =>
          listener({
            initSegment: new Uint8Array([1, 2]),
            data: new Uint8Array([3, 4]),
          }),
      };
    }),
  },
}));
const { M3U8Downloader } = require('../src/lib/m3u8-downloader');
const { mp4 } = require('mux.js');
afterEach(() => jest.clearAllMocks());
test('TS downloads do not instantiate the deferred MP4 converter', async () => {
  const input = new Uint8Array([0x47, 1, 2]).buffer;
  const callback = jest.fn();
  await M3U8Downloader.prototype.conversionMp4.call(
    {},
    { type: 'TS' },
    input,
    0,
    callback
  );
  expect(callback).toHaveBeenCalledWith(input);
  expect(mp4.Transmuxer).not.toHaveBeenCalled();
});
test('lazy MP4 loading preserves initialization bytes and the completion callback', async () => {
  const callback = jest.fn();
  await M3U8Downloader.prototype.conversionMp4.call(
    {},
    { type: 'MP4', durationSecond: 10 },
    new Uint8Array([0x47]).buffer,
    0,
    callback
  );
  expect(new Uint8Array(callback.mock.calls[0][0])).toEqual(
    new Uint8Array([1, 2, 3, 4])
  );
});
