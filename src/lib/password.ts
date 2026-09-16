const ITERATIONS = 600_000;
const PREFIX = 'pbkdf2-sha256';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

function fromHex(value: string): Uint8Array {
  return new Uint8Array(value.match(/../g)!.map((byte) => parseInt(byte, 16)));
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++)
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<string> {
  const encoded = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey('raw', encoded, 'PBKDF2', false, [
    'deriveBits',
  ]);
  try {
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      key,
      256
    );
    return hex(new Uint8Array(bits));
  } catch (error) {
    // Some edge runtimes cap native PBKDF2 iterations. Keep the same stored work factor.
    if (
      !(error instanceof Error) ||
      (error.name !== 'NotSupportedError' && !/iteration/i.test(error.message))
    )
      throw error;
    const { pbkdf2Async } = await import('@noble/hashes/pbkdf2');
    const { sha256 } = await import('@noble/hashes/sha256');
    return hex(
      await pbkdf2Async(sha256, encoded, salt, { c: iterations, dkLen: 32 })
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${PREFIX}$${ITERATIONS}$${hex(salt)}$${await derive(
    password,
    salt,
    ITERATIONS
  )}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  if (typeof stored !== 'string') return { valid: false, needsUpgrade: false };
  // Read existing SHA-256 hashes, then upgrade only after a successful login.
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(password)
    );
    const valid = equal(hex(new Uint8Array(hash)), stored.toLowerCase());
    return { valid, needsUpgrade: valid };
  }
  const match = stored.match(
    /^pbkdf2-sha256\$(\d{1,7})\$([a-f0-9]{32})\$([a-f0-9]{64})$/
  );
  if (!match) return { valid: false, needsUpgrade: false };
  const iterations = Number(match[1]);
  if (iterations < 100_000 || iterations > 1_000_000)
    return { valid: false, needsUpgrade: false };
  const valid = equal(
    await derive(password, fromHex(match[2]), iterations),
    match[3]
  );
  return { valid, needsUpgrade: valid && iterations < ITERATIONS };
}
