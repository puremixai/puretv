import { z } from 'zod';

import type { AdminConfig, ConfigSubscription } from './admin.types';

export const MAX_CONFIG_SUBSCRIPTIONS = 20;
export const MAX_CONFIG_BYTES = 256 * 1024;

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, '地址必须是 HTTP(S) URL，且不能包含用户名或密码');
const safeKey = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (key) => !['__proto__', 'constructor', 'prototype'].includes(key),
    '无效的源标识'
  );
const configSchema = z
  .object({
    cache_time: z.number().nonnegative().optional(),
    api_site: z
      .record(
        safeKey,
        z
          .object({
            name: z.string().trim().min(1),
            api: httpUrl,
            detail: z.union([httpUrl, z.literal('')]).optional(),
          })
          .passthrough()
      )
      .optional(),
    lives: z
      .record(
        safeKey,
        z
          .object({
            name: z.string().min(1),
            url: httpUrl,
            ua: z.string().optional(),
            epg: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    custom_category: z
      .array(
        z
          .object({
            name: z.string().optional(),
            type: z.enum(['movie', 'tv']),
            query: z.string(),
          })
          .passthrough()
      )
      .optional(),
    special_source_apis: z.array(z.string()).optional(),
    specialSourceApis: z.array(z.string()).optional(),
  })
  .passthrough();

export type SubscriptionConfig = z.infer<typeof configSchema>;

export function parseSubscriptionConfig(content: string): SubscriptionConfig {
  if (
    typeof content !== 'string' ||
    new TextEncoder().encode(content).length > MAX_CONFIG_BYTES
  ) {
    throw new Error('配置内容超过 256 KiB 限制');
  }
  try {
    return configSchema.parse(JSON.parse(content || '{}'));
  } catch {
    throw new Error(
      '配置格式无效：请检查 JSON 和 api_site 中的名称、HTTP(S) API 地址'
    );
  }
}

const subscriptionSchema = z.object({
  ID: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  Name: z.string().trim().max(100),
  URL: httpUrl,
  Enabled: z.boolean(),
  AutoUpdate: z.boolean(),
  LastCheck: z.union([z.string().datetime(), z.literal('')]),
  LastError: z.string().max(1000).optional(),
  UpdateIntervalHours: z.number().int().min(1).max(168).optional(),
  LastAttempt: z.union([z.string().datetime(), z.literal('')]).optional(),
  ConfigContent: z.string().max(MAX_CONFIG_BYTES).optional(),
});

export function validateSubscriptions(input: unknown): ConfigSubscription[] {
  const result = z
    .array(subscriptionSchema)
    .max(MAX_CONFIG_SUBSCRIPTIONS)
    .safeParse(input);
  if (!result.success)
    throw new Error('订阅列表无效：最多 20 个订阅，请检查地址和订阅字段');
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const sub of result.data) {
    const url = new URL(sub.URL);
    url.hash = '';
    sub.URL = url.href;
    if (ids.has(sub.ID) || urls.has(sub.URL))
      throw new Error('订阅标识或地址重复');
    ids.add(sub.ID);
    urls.add(sub.URL);
    if (sub.ConfigContent) parseSubscriptionConfig(sub.ConfigContent);
  }
  return result.data;
}

// This migration is idempotent, including an explicitly empty subscription list.
export function migrateConfigSubscriptions(config: AdminConfig): void {
  if (Array.isArray(config.ConfigSubscriptions)) {
    config.ConfigFileLocal ??= config.ConfigSubscriptions.length
      ? '{}'
      : config.ConfigFile || '{}';
    return;
  }
  const legacy = config.ConfigSubscribtion;
  config.ConfigSubscriptions = legacy?.URL
    ? [
        {
          ID: 'legacy',
          Name: '原有订阅',
          URL: legacy.URL,
          Enabled: true,
          AutoUpdate: legacy.AutoUpdate,
          LastCheck: legacy.LastCheck || '',
          ConfigContent: config.ConfigFile || '{}',
        },
      ]
    : [];
  config.ConfigFileLocal = legacy?.URL ? '{}' : config.ConfigFile || '{}';
}

export function apiIdentity(api: string): string {
  const url = new URL(api.trim());
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

// Local entries take priority, followed by subscriptions in their displayed order.
// Existing keys are reused by API identity so favorites survive reordering/de-duplication.
export function mergeSubscriptionConfigs(
  localContent: string,
  subscriptions: ConfigSubscription[],
  previousContent = '{}'
): SubscriptionConfig {
  const local = parseSubscriptionConfig(localContent);
  let previous: SubscriptionConfig = {};
  try {
    // The effective file may contain up to 20 individually bounded subscriptions.
    previous = configSchema.parse(JSON.parse(previousContent));
  } catch {
    /* Legacy invalid file. */
  }
  const previousKeys = new Map(
    Object.entries(previous.api_site || {}).map(([key, site]) => [
      apiIdentity(site.api),
      key,
    ])
  );
  const parts = [
    { id: 'local', config: local },
    ...subscriptions
      .filter((sub) => sub.Enabled && sub.ConfigContent)
      .map((sub) => ({
        id: sub.ID,
        config: parseSubscriptionConfig(sub.ConfigContent || '{}'),
      })),
  ];
  const merged: SubscriptionConfig = {};
  const sites: NonNullable<SubscriptionConfig['api_site']> =
    Object.create(null);
  const lives: NonNullable<SubscriptionConfig['lives']> = Object.create(null);
  const categories: NonNullable<SubscriptionConfig['custom_category']> = [];
  const seenApis = new Map<string, string>();
  const seenCategories = new Set<string>();
  const seenLives = new Set<string>();
  const special = new Set<string>();
  for (const part of parts) {
    for (const [key, value] of Object.entries(part.config)) {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) {
        Object.defineProperty(merged, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    const aliases = new Map<string, string>();
    for (const [key, site] of Object.entries(part.config.api_site || {})) {
      const api = apiIdentity(site.api);
      let target = seenApis.get(api);
      if (!target) {
        target = previousKeys.get(api) || key;
        if (sites[target]) target = `${key.slice(0, 100)}__${part.id}`;
        let suffix = 2;
        const base = target;
        while (sites[target]) target = `${base}_${suffix++}`;
        sites[target] = site;
        seenApis.set(api, target);
      }
      aliases.set(key, target);
    }
    for (const key of part.config.special_source_apis ||
      part.config.specialSourceApis ||
      []) {
      const target = aliases.get(key);
      if (target) special.add(target);
    }
    for (const [key, live] of Object.entries(part.config.lives || {})) {
      const identity = JSON.stringify([
        live.url,
        live.ua || '',
        live.epg || '',
      ]);
      if (seenLives.has(identity)) continue;
      seenLives.add(identity);
      let target = key;
      let suffix = 2;
      while (lives[target])
        target = `${key.slice(0, 100)}__${part.id}_${suffix++}`;
      lives[target] = live;
    }
    for (const category of part.config.custom_category || []) {
      const key = JSON.stringify([category.type, category.query]);
      if (!seenCategories.has(key)) categories.push(category);
      seenCategories.add(key);
    }
  }
  merged.api_site = sites;
  merged.lives = lives;
  merged.custom_category = categories;
  if (
    parts.some(
      ({ config }) => config.special_source_apis || config.specialSourceApis
    )
  ) {
    merged.special_source_apis = Array.from(special);
    delete merged.specialSourceApis;
  }
  return merged;
}

// Apply only after validation/fetch has completed; callers work on a copy until saved.
export function applySubscriptionConfig(
  config: AdminConfig,
  localContent: string,
  subscriptions: ConfigSubscription[]
): AdminConfig {
  migrateConfigSubscriptions(config);
  const previous = mergeSubscriptionConfigs(
    '{}',
    config.ConfigSubscriptions || [],
    config.ConfigFile
  );
  const merged = mergeSubscriptionConfigs(
    localContent,
    subscriptions,
    config.ConfigFile
  );
  // Never repurpose a manually added source key for another API.
  for (const source of config.SourceConfig || []) {
    const imported = merged.api_site?.[source.key];
    if (
      source.from !== 'custom' ||
      !imported ||
      apiIdentity(source.api) === apiIdentity(imported.api)
    )
      continue;
    const sites = merged.api_site;
    if (!sites) continue;
    let target = `${source.key.slice(0, 100)}__subscription`;
    let suffix = 2;
    while (sites[target])
      target = `${source.key.slice(0, 100)}__subscription_${suffix++}`;
    sites[target] = imported;
    delete sites[source.key];
    if (merged.special_source_apis)
      merged.special_source_apis = merged.special_source_apis.map((key) =>
        key === source.key ? target : key
      );
  }
  const removed = new Set(
    Object.keys(previous.api_site || {}).filter(
      (key) => !merged.api_site?.[key]
    )
  );
  config.SourceConfig = (config.SourceConfig || []).filter(
    (source) => source.from !== 'config' || !removed.has(source.key)
  );
  const removedLives = new Set(
    Object.keys(previous.lives || {}).filter((key) => !merged.lives?.[key])
  );
  config.LiveConfig = (config.LiveConfig || []).filter(
    (live) => live.from !== 'config' || !removedLives.has(live.key)
  );
  const categoryKey = (category: { type: string; query: string }) =>
    JSON.stringify([category.type, category.query]);
  const keptCategories = new Set(
    (merged.custom_category || []).map(categoryKey)
  );
  const removedCategories = new Set(
    (previous.custom_category || [])
      .map(categoryKey)
      .filter((key) => !keptCategories.has(key))
  );
  config.CustomCategories = (config.CustomCategories || []).filter(
    (category) =>
      category.from !== 'config' ||
      !removedCategories.has(categoryKey(category))
  );
  config.SpecialSourceApis = (config.SpecialSourceApis || []).filter(
    (key) => !removed.has(key)
  );
  config.ClientAdSourceApis = (config.ClientAdSourceApis || []).filter(
    (key) => !removed.has(key)
  );
  config.ConfigFileLocal = localContent;
  config.ConfigSubscriptions = subscriptions;
  config.ConfigFile = JSON.stringify(merged, null, 2);
  // Keep the old single-subscription shape for old exports/clients.
  const single = subscriptions.length === 1 ? subscriptions[0] : undefined;
  config.ConfigSubscribtion = {
    URL: single?.URL || '',
    AutoUpdate: !!(single?.Enabled && single.AutoUpdate),
    LastCheck: single?.LastCheck || '',
  };
  return config;
}
