import { fetchPublicUrl, readLimitedText } from '@/lib/server/public-fetch';

import type { AdminConfig } from '../admin.types';
import { db } from '../db';
import {
  effectiveSourceWeight,
  SourceHealth,
  updateHealth,
} from '../source-health';

type Source = AdminConfig['SourceConfig'][number];
const keyFor = (source: Source) => 'source-health:' + source.key;
const pending = new Map<string, Promise<SourceHealth>>();
export async function readSourceHealth(
  source: Source
): Promise<SourceHealth | undefined> {
  const raw = await db.getGlobalValue(keyFor(source));
  if (!raw) return undefined;
  try {
    const health = JSON.parse(raw) as SourceHealth;
    return health.api === source.api ? health : undefined;
  } catch {
    return undefined;
  }
}
export async function sourceWeightMap(sources: Source[]) {
  return new Map(
    await Promise.all(
      sources.map(
        async (source) =>
          [
            source.key,
            effectiveSourceWeight(
              source.weight || 0,
              await readSourceHealth(source)
            ),
          ] as const
      )
    )
  );
}
async function prefix(response: Response, limit = 65536) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('媒体请求失败 HTTP ' + response.status);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, limit - size);
      chunks.push(part);
      size += part.length;
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function probeMedia(
  url: string,
  signal: AbortSignal,
  depth = 0
): Promise<void> {
  if (depth > 4) throw new Error('播放列表嵌套过深');
  const response = await fetchPublicUrl(url, {
    signal,
    headers: { Range: 'bytes=0-65535' },
  });
  const bytes = await prefix(response);
  const text = new TextDecoder().decode(bytes);
  if (text.trimStart().startsWith('#EXTM3U')) {
    const base = response.url || url;
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const next = lines.find((line) => line && !line.startsWith('#'));
    if (!next) throw new Error('播放列表没有媒体内容');
    const encryption = lines.find(
      (line) => line.startsWith('#EXT-X-KEY:') && !line.includes('METHOD=NONE')
    );
    if (encryption) {
      if (!encryption.includes('METHOD=AES-128'))
        throw new Error('暂不支持此加密方式的自动播放检测');
      const uri = /URI="([^"]+)"/.exec(encryption)?.[1];
      if (!uri) throw new Error('缺少播放密钥地址');
      const key = await prefix(
        await fetchPublicUrl(new URL(uri, base).href, { signal }),
        17
      );
      if (key.length !== 16) throw new Error('播放密钥无效');
      // Encrypted segments cannot be sniffed until decrypted: verify key and nonempty block-aligned payload.
      const segment = await prefix(
        await fetchPublicUrl(new URL(next, base).href, {
          signal,
          headers: { Range: 'bytes=0-65535' },
        })
      );
      if (segment.length < 16 || segment.length % 16 !== 0)
        throw new Error('加密媒体分片无效');
      return;
    }
    const map = lines.find((line) => line.startsWith('#EXT-X-MAP:'));
    const init = map && /URI="([^"]+)"/.exec(map)?.[1];
    if (init) await probeMedia(new URL(init, base).href, signal, depth + 1);
    return probeMedia(new URL(next, base).href, signal, depth + 1);
  }
  const box = new TextDecoder().decode(bytes.subarray(4, 8));
  const valid =
    (bytes[0] === 0x47 && bytes.length >= 188) ||
    ['ftyp', 'styp', 'moof', 'moov', 'sidx', 'mdat'].includes(box) ||
    text.startsWith('FLV') ||
    (bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3);
  if (!valid) throw new Error('响应不是可识别的媒体内容');
}
interface Vod {
  vod_id?: string | number;
  vod_name?: string;
  vod_play_url?: string;
}
async function cms(url: URL, signal: AbortSignal) {
  const response = await fetchPublicUrl(url.href, { signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('搜索请求失败 HTTP ' + response.status);
  }
  const data = JSON.parse(await readLimitedText(response, 2 * 1024 * 1024)) as {
    list?: Vod[];
  };
  if (!Array.isArray(data.list)) throw new Error('视频源返回格式无效');
  return data.list;
}
export function checkSource(
  source: Source,
  keyword: string
): Promise<SourceHealth> {
  const key = keyFor(source);
  const existing = pending.get(key);
  if (existing) return existing;
  const work = (async () => {
    const previous = await readSourceHealth(source);
    if (previous && Date.now() - previous.checkedAt < 60_000) return previous;
    const start = Date.now();
    let searchLatencyMs = 0;
    let playbackLatencyMs: number | undefined;
    let status: SourceHealth['status'] = 'invalid';
    let message = '';
    try {
      const signal = AbortSignal.timeout(25_000);
      const url = new URL(source.api);
      url.searchParams.set('ac', 'videolist');
      url.searchParams.set('wd', keyword);
      const list = await cms(url, signal);
      searchLatencyMs = Date.now() - start;
      const video = list.find((item) =>
        item.vod_name?.toLowerCase().includes(keyword.toLowerCase())
      );
      if (!video) {
        status = 'no_results';
        message = '搜索可用，但没有匹配结果（不计为连续失败）';
      } else {
        let playUrls = video.vod_play_url;
        if (!playUrls && video.vod_id !== undefined) {
          url.searchParams.delete('wd');
          url.searchParams.set('ac', 'detail');
          url.searchParams.set('ids', String(video.vod_id));
          playUrls = (await cms(url, signal))[0]?.vod_play_url;
        }
        const media = playUrls
          ?.split('$$$')
          .flatMap((line) => line.split('#'))
          .map((item) => item.slice(item.indexOf('$') + 1))
          .find((item) => /^https?:\/\//.test(item));
        if (!media) throw new Error('没有可直接播放的媒体地址');
        const playStart = Date.now();
        await probeMedia(media, signal);
        playbackLatencyMs = Date.now() - playStart;
        status = 'valid';
        message = '搜索、播放列表和媒体抽检通过';
      }
    } catch (error) {
      message = error instanceof Error ? error.message : '检测失败';
    }
    const health = updateHealth(previous, {
      api: source.api,
      keyword,
      checkedAt: Date.now(),
      status,
      message,
      latencyMs: Date.now() - start,
      searchLatencyMs,
      playbackLatencyMs,
    });
    await db.setGlobalValue(key, JSON.stringify(health));
    return health;
  })().finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}
export async function refreshSourceHealth(sources: Source[]) {
  const queue = [...sources.filter((source) => !source.disabled)];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (;;) {
        const source = queue.shift();
        if (!source) return;
        const health = await readSourceHealth(source);
        if (!health || Date.now() - health.checkedAt >= 6 * 3600_000)
          await checkSource(source, health?.keyword || '电影');
      }
    })
  );
}
