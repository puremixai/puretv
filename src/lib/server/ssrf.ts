import dns from 'dns';
import { BlockList, isIP } from 'net';

let lists:
  { blocked: BlockList; globalV6: BlockList; mappedV4: BlockList } | undefined;
function getAddressLists() {
  if (lists) return lists;
  const blocked = new BlockList();
  for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const)
    blocked.addSubnet(address, prefix, 'ipv4');
  for (const [address, prefix] of [
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
  ] as const) {
    blocked.addSubnet(address, prefix, 'ipv6');
  }
  const globalV6 = new BlockList();
  globalV6.addSubnet('2000::', 3, 'ipv6');
  const mappedV4 = new BlockList();
  mappedV4.addSubnet('::ffff:0:0', 96, 'ipv6');
  return (lists = { blocked, globalV6, mappedV4 });
}

/** Fail closed for invalid, private, local, multicast and reserved addresses. */
export function isPrivateIP(address: string): boolean {
  const { blocked, globalV6, mappedV4 } = getAddressLists();
  const family = isIP(address);
  if (!family) return true;
  if (family === 4) return blocked.check(address, 'ipv4');
  if (blocked.check(address, 'ipv6')) return true;
  return !mappedV4.check(address, 'ipv6') && !globalV6.check(address, 'ipv6');
}

const realDnsCache = new Map<
  string,
  { expires: number; addresses: { address: string; family: number }[] }
>();
export function isFakeIP(address: string): boolean {
  return isIP(address) === 4 && /^198\.(18|19)\./.test(address);
}

/** Fixed, TLS-authenticated DoH providers bootstrap through the system network.
 * Only their public answers are used for media connections; fake IPs are never dialed.
 */
async function resolveRealAddresses(hostname: string) {
  const cached = realDnsCache.get(hostname);
  if (cached && cached.expires > Date.now()) return cached.addresses;
  for (const endpoint of [
    'https://cloudflare-dns.com/dns-query',
    'https://dns.google/resolve',
  ]) {
    try {
      const answers = await Promise.all(
        ['A', 'AAAA'].map(async (type) => {
          const response = await fetch(
            endpoint +
              '?name=' +
              encodeURIComponent(hostname) +
              '&type=' +
              type,
            {
              headers: { accept: 'application/dns-json' },
              redirect: 'error',
              signal: AbortSignal.timeout(5000),
            },
          );
          if (!response.ok) throw new Error('Public DNS unavailable');
          const text = await response.text();
          if (text.length > 65536) throw new Error('Invalid DNS response');
          const data = JSON.parse(text) as {
            Status: number;
            Answer?: { type: number; data: string; TTL: number }[];
          };
          if (data.Status !== 0)
            throw new Error('Public DNS resolution failed');
          return (data.Answer || []).filter(
            (answer) => answer.type === 1 || answer.type === 28,
          );
        }),
      );
      const records = answers.flat();
      const addresses = records.map((answer) => ({
        address: answer.data,
        family: isIP(answer.data),
      }));
      if (
        !addresses.length ||
        addresses.some((item) => isPrivateIP(item.address))
      )
        throw new Error('Non-public DNS answer');
      if (realDnsCache.size >= 500) {
        const oldestHostname = realDnsCache.keys().next().value;
        if (oldestHostname !== undefined) realDnsCache.delete(oldestHostname);
      }
      const ttl = Math.max(
        0,
        Math.min(60, ...records.map((record) => record.TTL || 0)),
      );
      realDnsCache.set(hostname, {
        expires: Date.now() + ttl * 1000,
        addresses,
      });
      return addresses;
    } catch {
      /* Try the second trusted resolver; all failures remain closed. */
    }
  }
  throw new Error('无法解析真实公网地址，请检查 DNS-over-HTTPS 网络连接');
}

// These grants come only from administrator-owned configuration, never URL parameters.
// Even a trusted origin cannot dial metadata/link-local, multicast or reserved networks.
function isTrustedLanAddress(address: string): boolean {
  const lan = new BlockList();
  for (const [network, prefix] of [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['127.0.0.0', 8],
  ] as const)
    lan.addSubnet(network, prefix, 'ipv4');
  lan.addSubnet('fc00::', 7, 'ipv6');
  lan.addAddress('::1', 'ipv6');
  return lan.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
}

export async function resolvePublicTarget(
  input: string,
  trustedOrigins: readonly string[] = [],
) {
  const url = new URL(input);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Invalid media URL');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  let addresses = family
    ? [{ address: hostname, family }]
    : await dns.promises.lookup(hostname, { all: true, verbatim: true });
  if (!family && addresses.some((item) => isFakeIP(item.address))) {
    if (
      addresses.some(
        (item) => isPrivateIP(item.address) && !isFakeIP(item.address),
      )
    )
      throw new Error('Private or reserved network is forbidden');
    addresses = await resolveRealAddresses(hostname);
  }
  const trusted = trustedOrigins.includes(url.origin);
  if (
    !addresses.length ||
    addresses.some(
      (item) =>
        isPrivateIP(item.address) &&
        !(trusted && isTrustedLanAddress(item.address)),
    )
  )
    throw new Error('Private or reserved network is forbidden');
  return { url, addresses };
}

/** Use fetchPublicUrl for actual requests so the checked DNS result is pinned to the connection. */
export async function validateProxyUrlServerSide(
  input: string,
): Promise<boolean> {
  try {
    await resolvePublicTarget(input);
    return true;
  } catch {
    return false;
  }
}
