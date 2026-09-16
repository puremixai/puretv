/** @jest-environment node */
const { createCipheriv } = require('node:crypto');
const { AESDecryptor } = require('../src/lib/aes-decryptor');
const { M3U8Downloader } = require('../src/lib/m3u8-downloader');

test.each([ArrayBuffer, SharedArrayBuffer])(
  'decrypts using only the IV view bytes from %p storage',
  (BufferStorage) => {
    const key = new Uint8Array(16).fill(7);
    const backing = new Uint8Array(new BufferStorage(40));
    backing.fill(255);
    const iv = backing.subarray(8, 24);
    iv.set(Array.from({ length: 16 }, (_, index) => index));
    const plaintext = 'Segment payload for a downloaded video';
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const decryption = new AESDecryptor();
    decryption.expandKey(key.buffer);

    const decrypted = new M3U8Downloader().aesDecrypt(
      { aesConf: { iv, key: key.buffer, decryption } },
      new Uint8Array(encrypted).buffer,
      0
    );

    expect(Buffer.from(decrypted).toString('utf8')).toBe(plaintext);
  }
);
