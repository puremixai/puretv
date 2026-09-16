export interface PlaylistProxyOptions {
  origin: string;
  source: string;
  token?: string;
  mode: 'vod' | 'ad-filter' | 'live';
  proxySegments: boolean;
  adBlockEnabled?: boolean;
}

/** Rewrite each URI once, including variant playlists, audio, keys and fMP4 parts. */
export function rewriteMediaPlaylist(
  content: string,
  baseUrl: string,
  options: PlaylistProxyOptions,
): string {
  const proxy = (uri: string, kind: 'playlist' | 'segment' | 'key') => {
    const absolute = new URL(uri, baseUrl);
    if (!['http:', 'https:'].includes(absolute.protocol)) return uri;
    if (kind !== 'playlist' && !options.proxySegments) return absolute.href;
    const endpoint =
      options.mode === 'live'
        ? '/api/proxy/' + (kind === 'playlist' ? 'm3u8' : kind)
        : kind === 'playlist'
          ? options.mode === 'vod'
            ? '/api/proxy/vod/m3u8'
            : '/api/proxy-m3u8'
          : '/api/proxy/vod/' + kind;
    const url = new URL(endpoint, options.origin);
    url.searchParams.set('url', absolute.href);
    url.searchParams.set(
      options.mode === 'live' ? 'puretv-source' : 'source',
      options.source,
    );
    if (
      options.mode === 'live' &&
      kind === 'playlist' &&
      !options.proxySegments
    )
      url.searchParams.set('allowCORS', 'true');
    if (options.token) url.searchParams.set('token', options.token);
    if (kind === 'playlist' && options.mode === 'ad-filter') {
      if (options.adBlockEnabled === false)
        url.searchParams.set('adblock', 'false');
      if (options.proxySegments) url.searchParams.set('proxySegments', 'true');
    }
    return url.href;
  };
  let variant = false;
  return content
    .split(/\r?\n/)
    .map((line) => {
      const value = line.trim();
      if (!value) return line;
      if (value.startsWith('#')) {
        if (value.startsWith('#EXT-X-STREAM-INF:')) variant = true;
        const kind =
          /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(value)
            ? 'playlist'
            : /^#EXT-X-(?:KEY|SESSION-KEY):/.test(value)
              ? 'key'
              : 'segment';
        return line.replace(
          /\bURI="([^"]+)"/g,
          (_match, uri: string) => `URI="${proxy(uri, kind)}"`,
        );
      }
      const kind =
        variant || /\.m3u8?(?:$|[?#])/i.test(value) ? 'playlist' : 'segment';
      variant = false;
      return proxy(value, kind);
    })
    .join('\n');
}
