import { z } from 'zod';

const text = z.string().max(8192);
const strings = z.array(text).max(500);
const emby = z
  .object({
    key: text,
    name: text,
    enabled: z.boolean(),
    ServerURL: text,
    ApiKey: text.optional(),
    Username: text.optional(),
    Password: text.optional(),
    UserId: text.optional(),
    AuthToken: text.optional(),
    Libraries: strings.optional(),
    LastSyncTime: z.number().optional(),
    ItemCount: z.number().optional(),
    isDefault: z.boolean().optional(),
    removeEmbyPrefix: z.boolean().optional(),
    appendMediaSourceId: z.boolean().optional(),
    transcodeMp4: z.boolean().optional(),
    proxyPlay: z.boolean().optional(),
    customUserAgent: text.optional(),
    embyAuthorizationHeader: text.optional(),
  })
  .strict();
const opdsSource = z
  .object({
    id: text,
    name: text,
    type: z.literal('opds').optional(),
    url: text,
    enabled: z.boolean().optional(),
    authMode: z.enum(['none', 'basic', 'header']).optional(),
    username: text.optional(),
    password: text.optional(),
    headerName: text.optional(),
    headerValue: text.optional(),
    searchTemplate: text.optional(),
    preferFormat: z.array(z.enum(['epub', 'pdf'])).optional(),
    language: text.optional(),
  })
  .strict();
// Every other section is handled by its own API and authorization policy.
export const configPatchSchema = z
  .object({
    EmbyConfig: z
      .object({ Sources: z.array(emby).max(100) })
      .strict()
      .optional(),
    SuwayomiConfig: z
      .object({
        Enabled: z.boolean(),
        ServerURL: text,
        AuthMode: z.enum(['none', 'basic_auth', 'simple_login']).optional(),
        Username: text.optional(),
        Password: text.optional(),
        DefaultLang: text.optional(),
        SourceIds: strings.optional(),
        MaxSources: z.number().int().min(1).max(500).optional(),
      })
      .strict()
      .optional(),
    OPDSConfig: z
      .object({
        Enabled: z.boolean(),
        Sources: z.array(opdsSource).max(100).optional(),
        CacheTTL: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    SiteConfig: z
      .object({
        EnableMovieRequest: z.boolean(),
        MovieRequestCooldown: z.number().int().min(0).max(86400),
      })
      .strict()
      .optional(),
    LiveRefreshIntervalHours: z.number().int().min(1).max(8760).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    '至少提供一个可更新的配置字段'
  );
