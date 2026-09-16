export type LiveProxyMode = 'direct' | 'm3u8-only' | 'full';
export type LiveStreamType = 'm3u8' | 'flv' | 'mp4';

type PlaybackSource = {
  key: string;
  proxyMode?: LiveProxyMode;
};

export function resolveLiveProxyMode(mode?: unknown): LiveProxyMode {
  return mode === 'full' || mode === 'm3u8-only' ? mode : 'direct';
}

export function getLiveStreamType(url: string): LiveStreamType | 'unknown' {
  // Only the path identifies a format; signed query parameters must stay intact.
  const path = url.split(/[?#]/, 1)[0].toLowerCase();
  if (/\.m3u8?$/.test(path)) return 'm3u8';
  if (path.endsWith('.flv')) return 'flv';
  if (/\.(mp4|webm|ogv|ogg|mov)$/.test(path)) return 'mp4';
  return 'unknown';
}

export function buildLivePlaybackUrl(
  rawUrl: string,
  source?: PlaybackSource | null,
  type = getLiveStreamType(rawUrl),
): string {
  const mode = resolveLiveProxyMode(source?.proxyMode);
  // Existing proxy modes apply to HLS; progressive streams remain direct.
  if (mode === 'direct' || type === 'flv' || type === 'mp4') return rawUrl;
  const params = new URLSearchParams({
    url: rawUrl,
    'puretv-source': source?.key || '',
  });
  if (mode === 'm3u8-only') params.set('allowCORS', 'true');
  return `/api/proxy/m3u8?${params}`;
}

export async function resolveLivePlayback(
  rawUrl: string,
  source?: PlaybackSource | null,
  signal?: AbortSignal,
): Promise<{ url: string; type: LiveStreamType }> {
  let type = getLiveStreamType(rawUrl);
  if (type === 'unknown') {
    if (!source?.key) throw new Error('未知直播流格式');
    const params = new URLSearchParams({
      url: rawUrl,
      'puretv-source': source.key,
    });
    // Extensionless URLs need a short format probe, not a media relay.
    const response = await fetch(`/api/live/precheck?${params}`, {
      cache: 'no-store',
      signal,
    });
    if (!response.ok) throw new Error('直播流预检查失败');
    const result: { success?: boolean; type?: unknown } = await response.json();
    if (
      !result.success ||
      !['m3u8', 'flv', 'mp4'].includes(String(result.type))
    ) {
      throw new Error('不支持的直播流格式');
    }
    type = result.type as LiveStreamType;
  }
  return { url: buildLivePlaybackUrl(rawUrl, source, type), type };
}
