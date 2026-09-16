const { pbkdf2Sync, randomBytes } = require('crypto');

// Identical format/work factor to src/lib/password.ts; initialization runs on Node.
function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 600_000, 32, 'sha256');
  return `pbkdf2-sha256$600000$${salt.toString('hex')}$${hash.toString('hex')}`;
}

module.exports = { hashPassword };
