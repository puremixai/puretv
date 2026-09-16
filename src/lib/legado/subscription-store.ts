/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';

import type { AdminConfig } from '@/lib/admin.types';
import type { BookSource, LegadoBookSourceRule } from '@/lib/book.types';
import { db } from '@/lib/db';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';

export interface LegadoSubscriptionMeta {
  id: string;
  name: string;
  url: string;
  enabled?: boolean;
  sourceCount?: number;
  lastSyncAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
}

interface StoredManifest {
  id: string;
  name: string;
  url: string;
  hash: string;
  sourceCount: number;
  chunkCount: number;
  updatedAt: number;
  etag?: string;
  lastModified?: string;
}

const CHUNK_SIZE = Number(process.env.LEGADO_SUBSCRIPTION_CHUNK_SIZE || 100);
const TIMEOUT_MS = Number(process.env.LEGADO_SUBSCRIPTION_TIMEOUT_MS || process.env.LEGADO_TIMEOUT_MS || 30000);
const MAX_BYTES = Number(process.env.LEGADO_SUBSCRIPTION_MAX_BYTES || 20 * 1024 * 1024);
const sourcesCache = new Map<string, BookSource[]>();
const sourcesLoadPromises = new Map<string, Promise<BookSource[]>>();

function stableId(input: string) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function subscriptionId(url: string, name?: string) {
  return `legado_sub_${stableId(`${name || ''}|${url}`)}`;
}

function manifestKey(id: string) {
  return `legado:subscription:${id}:manifest`;
}

function chunkKey(id: string, index: number) {
  return `legado:subscription:${id}:chunk:${index}`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithRetry(url: string, retries = 2): Promise<{ text: string; etag?: string; lastModified?: string }> {
  const safe = await validateProxyUrlServerSide(url);
  if (!safe) throw new Error('订阅地址未通过安全校验');

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
          Accept: 'application/json,text/plain,*/*',
        },
      });
      if (!response.ok) throw new Error(`订阅请求失败: ${response.status}`);
      const contentLength = Number(response.headers.get('content-length') || '0');
      if (contentLength > MAX_BYTES) throw new Error('订阅内容过大');
      const text = await response.text();
      if (text.length > MAX_BYTES) throw new Error('订阅内容过大');
      return {
        text,
        etag: response.headers.get('etag') || undefined,
        lastModified: response.headers.get('last-modified') || undefined,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await wait(300 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('订阅请求失败');
}

function extractRuleList(input: any): LegadoBookSourceRule[] {
  if (Array.isArray(input)) return input.filter((item) => item && typeof item === 'object');
  if (!input || typeof input !== 'object') return [];
  for (const key of ['data', 'sources', 'bookSources', 'items', 'list']) {
    if (Array.isArray(input[key])) return input[key].filter((item: any) => item && typeof item === 'object');
  }
  return [input];
}

function normalizeRule(rule: LegadoBookSourceRule, subId: string, index: number): BookSource | null {
  const name = rule.bookSourceName || `Legado 书源 ${index + 1}`;
  const url = rule.bookSourceUrl || '';
  if (!url) return null;
  return {
    id: `legado_${stableId(`${subId}|${name}|${url}|${index}`)}`,
    name,
    type: 'legado',
    url,
    enabled: rule.enabled !== false,
    authMode: 'none',
    username: '',
    password: '',
    headerName: '',
    headerValue: '',
    searchTemplate: '',
    preferFormat: ['epub'],
    language: '',
    legado: rule,
  };
}

async function readManifest(id: string): Promise<StoredManifest | null> {
  const raw = await db.getGlobalValue(manifestKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredManifest;
  } catch {
    return null;
  }
}

async function readSourcesFromDb(id: string): Promise<BookSource[]> {
  const manifest = await readManifest(id);
  if (!manifest) return [];
  const chunks = await Promise.all(
    Array.from({ length: manifest.chunkCount }, async (_, index) => {
      const raw = await db.getGlobalValue(chunkKey(id, index));
      if (!raw) return [] as BookSource[];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as BookSource[]) : [];
      } catch {
        return [] as BookSource[];
      }
    })
  );
  return chunks.flat();
}

export const legadoSubscriptionStore = {
  makeId: subscriptionId,

  async sync(input: { id?: string; name?: string; url: string }): Promise<LegadoSubscriptionMeta> {
    const url = input.url.trim();
    if (!url) throw new Error('订阅 URL 不能为空');
    const id = input.id || subscriptionId(url, input.name);
    const name = input.name?.trim() || 'Legado 订阅';
    const previous = await readManifest(id);
    const { text, etag, lastModified } = await fetchTextWithRetry(url);
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('订阅内容不是合法 JSON');
    }
    const rules = extractRuleList(parsed);
    const sources = rules.map((rule, index) => normalizeRule(rule, id, index)).filter((item): item is BookSource => !!item);
    if (sources.length === 0) throw new Error('订阅内没有识别到有效 Legado 书源');

    const chunkCount = Math.ceil(sources.length / CHUNK_SIZE);
    const hash = crypto.createHash('sha1').update(JSON.stringify(sources)).digest('hex');
    for (let index = 0; index < chunkCount; index += 1) {
      await db.setGlobalValue(chunkKey(id, index), JSON.stringify(sources.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)));
    }
    if (previous && previous.chunkCount > chunkCount) {
      for (let index = chunkCount; index < previous.chunkCount; index += 1) {
        await db.deleteGlobalValue(chunkKey(id, index));
      }
    }
    const manifest: StoredManifest = { id, name, url, hash, sourceCount: sources.length, chunkCount, updatedAt: Date.now(), etag, lastModified };
    await db.setGlobalValue(manifestKey(id), JSON.stringify(manifest));
    sourcesLoadPromises.delete(id);
    sourcesCache.set(id, sources);
    return { id, name, url, enabled: true, sourceCount: sources.length, lastSyncAt: manifest.updatedAt, lastSuccessAt: manifest.updatedAt, lastError: '' };
  },

  async getSources(id: string): Promise<BookSource[]> {
    const cached = sourcesCache.get(id);
    if (cached) return cached;

    const pending = sourcesLoadPromises.get(id);
    if (pending) return pending;

    const promise = readSourcesFromDb(id)
      .then((sources) => {
        sourcesCache.set(id, sources);
        sourcesLoadPromises.delete(id);
        return sources;
      })
      .catch((error) => {
        sourcesLoadPromises.delete(id);
        throw error;
      });
    sourcesLoadPromises.set(id, promise);
    return promise;
  },

  async getSourcesForSubscriptions(subscriptions: LegadoSubscriptionMeta[] = []): Promise<BookSource[]> {
    const enabled = subscriptions.filter((item) => item.enabled !== false);
    const groups = await Promise.all(enabled.map((item) => this.getSources(item.id)));
    return groups.flat().filter((source) => source.enabled !== false);
  },

  async delete(id: string): Promise<void> {
    sourcesLoadPromises.delete(id);
    sourcesCache.delete(id);
    const manifest = await readManifest(id);
    if (manifest) {
      for (let index = 0; index < manifest.chunkCount; index += 1) {
        await db.deleteGlobalValue(chunkKey(id, index));
      }
    }
    await db.deleteGlobalValue(manifestKey(id));
  },

  clearCache(id?: string): void {
    if (id) {
      sourcesLoadPromises.delete(id);
      sourcesCache.delete(id);
      return;
    }
    sourcesLoadPromises.clear();
    sourcesCache.clear();
  },

  mergeMeta(config: AdminConfig, meta: LegadoSubscriptionMeta): AdminConfig {
    const opds = config.OPDSConfig || { Enabled: false, Sources: [], CacheTTL: 10 * 60 * 1000 };
    const list = opds.LegadoSubscriptions || [];
    const next = list.some((item) => item.id === meta.id)
      ? list.map((item) => item.id === meta.id ? { ...item, ...meta } : item)
      : [...list, meta];
    return { ...config, OPDSConfig: { ...opds, LegadoSubscriptions: next } };
  },
};
