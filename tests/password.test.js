/** @jest-environment node */
const { webcrypto, createHash, pbkdf2Sync } = require('crypto');
const { hashPassword, verifyPassword } = require('../src/lib/password');
const { hashPassword: initializerHash } = require('../scripts/password-hash');

beforeAll(() => {
  global.crypto = webcrypto;
});

test('same password gets unique salts and verifies without accepting a wrong password', async () => {
  const first = await hashPassword('correct-password');
  const second = await hashPassword('correct-password');
  expect(first).not.toBe(second);
  expect(first).toMatch(/^pbkdf2-sha256\$600000\$/);
  expect(await verifyPassword('correct-password', first)).toEqual({
    valid: true,
    needsUpgrade: false,
  });
  expect((await verifyPassword('wrong', first)).valid).toBe(false);
});

test('accepts legacy hashes only with the correct password and flags them for upgrade', async () => {
  const old = createHash('sha256').update('legacy-password').digest('hex');
  expect(await verifyPassword('legacy-password', old)).toEqual({
    valid: true,
    needsUpgrade: true,
  });
  expect(await verifyPassword('wrong', old)).toEqual({
    valid: false,
    needsUpgrade: false,
  });
});

test('Node initialization and application password formats interoperate', async () => {
  expect(
    (
      await verifyPassword(
        'initial-password',
        initializerHash('initial-password')
      )
    ).valid
  ).toBe(true);
  const encoded = await hashPassword('unicode-密码');
  const [, iterations, salt, digest] = encoded.split('$');
  expect(
    pbkdf2Sync(
      'unicode-密码',
      Buffer.from(salt, 'hex'),
      Number(iterations),
      32,
      'sha256'
    ).toString('hex')
  ).toBe(digest);
});

test.each([
  '',
  'pbkdf2-sha256$999999999$00$00',
  'pbkdf2-sha256$1$' + '00'.repeat(16) + '$' + '00'.repeat(32),
])('rejects malformed or unbounded password work factors', async (stored) => {
  expect((await verifyPassword('password', stored)).valid).toBe(false);
});
