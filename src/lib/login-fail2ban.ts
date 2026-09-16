import { NextRequest } from 'next/server';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const BAN_DURATIONS_MS = [
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface LoginFail2BanRecord {
  failures: number[];
  bannedUntil: number;
  banLevel: number;
  lastSeen: number;
}

interface LoginFail2BanStore {
  records: Map<string, LoginFail2BanRecord>;
  lastCleanup: number;
}

interface LoginFail2BanGlobal {
  __loginFail2BanStore?: LoginFail2BanStore;
}

export interface LoginBanStatus {
  banned: boolean;
  bannedUntil?: number;
  retryAfterSeconds?: number;
}

export interface LoginFailureResult extends LoginBanStatus {
  failureCount: number;
  banLevel: number;
}

function getStore(): LoginFail2BanStore {
  const globalStore = globalThis as typeof globalThis & LoginFail2BanGlobal;
  if (!globalStore.__loginFail2BanStore) {
    globalStore.__loginFail2BanStore = {
      records: new Map<string, LoginFail2BanRecord>(),
      lastCleanup: Date.now(),
    };
  }

  return globalStore.__loginFail2BanStore;
}

function cleanupExpiredRecords(now: number) {
  const store = getStore();
  if (now - store.lastCleanup < CLEANUP_INTERVAL_MS) return;

  for (const [ip, record] of Array.from(store.records.entries())) {
    const hasActiveBan = record.bannedUntil > now;
    const recentlySeen = now - record.lastSeen < RECORD_TTL_MS;

    if (!hasActiveBan && !recentlySeen) {
      store.records.delete(ip);
    }
  }

  store.lastCleanup = now;
}

function pruneFailures(record: LoginFail2BanRecord, now: number) {
  record.failures = record.failures.filter((time) => now - time <= WINDOW_MS);
}

function normalizeIp(ip: string): string | null {
  const normalized = ip.trim();
  if (!normalized || normalized.toLowerCase() === 'unknown') return null;
  return normalized;
}

export function getLoginClientIp(req: NextRequest): string | null {
  const cfConnectingIp = normalizeIp(req.headers.get('cf-connecting-ip') || '');
  if (cfConnectingIp) return cfConnectingIp;

  const xRealIp = normalizeIp(req.headers.get('x-real-ip') || '');
  if (xRealIp) return xRealIp;

  const xForwardedFor = req.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const firstIp = normalizeIp(xForwardedFor.split(',')[0] || '');
    if (firstIp) return firstIp;
  }

  const forwarded = req.headers.get('forwarded');
  if (forwarded) {
    const match = forwarded.match(/for=(?:"?)([^;,"]+)/i);
    const forwardedIp = normalizeIp(match?.[1]?.replace(/^\[|\]$/g, '') || '');
    if (forwardedIp) return forwardedIp;
  }

  return null;
}

export function checkLoginBan(ip: string | null, now = Date.now()): LoginBanStatus {
  if (!ip) return { banned: false };

  cleanupExpiredRecords(now);

  const record = getStore().records.get(ip);
  if (!record) return { banned: false };

  record.lastSeen = now;
  if (record.bannedUntil > now) {
    return {
      banned: true,
      bannedUntil: record.bannedUntil,
      retryAfterSeconds: Math.ceil((record.bannedUntil - now) / 1000),
    };
  }

  pruneFailures(record, now);
  return { banned: false };
}

export function recordLoginFailure(ip: string | null, now = Date.now()): LoginFailureResult {
  if (!ip) {
    return { banned: false, failureCount: 0, banLevel: 0 };
  }

  cleanupExpiredRecords(now);

  const store = getStore();
  const record = store.records.get(ip) || {
    failures: [],
    bannedUntil: 0,
    banLevel: 0,
    lastSeen: now,
  };

  record.lastSeen = now;
  pruneFailures(record, now);
  record.failures.push(now);

  if (record.failures.length >= MAX_FAILURES) {
    record.banLevel += 1;
    const durationIndex = Math.min(record.banLevel - 1, BAN_DURATIONS_MS.length - 1);
    record.bannedUntil = now + BAN_DURATIONS_MS[durationIndex];
    record.failures = [];
  }

  store.records.set(ip, record);

  if (record.bannedUntil > now) {
    return {
      banned: true,
      bannedUntil: record.bannedUntil,
      retryAfterSeconds: Math.ceil((record.bannedUntil - now) / 1000),
      failureCount: record.failures.length,
      banLevel: record.banLevel,
    };
  }

  return {
    banned: false,
    failureCount: record.failures.length,
    banLevel: record.banLevel,
  };
}

export function recordLoginSuccess(ip: string | null, now = Date.now()) {
  if (!ip) return;

  const record = getStore().records.get(ip);
  if (!record) return;

  record.failures = [];
  record.lastSeen = now;
}
