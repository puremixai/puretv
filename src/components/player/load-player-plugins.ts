export async function loadPlayerPlugins(options: {
  danmaku: boolean;
  thumbnails: boolean;
}) {
  const [danmaku, thumbnails] = await Promise.all([
    options.danmaku ? import('artplayer-plugin-danmuku') : undefined,
    options.thumbnails
      ? import('@/lib/artplayer-plugin-auto-thumbnail')
      : undefined,
  ]);
  return { danmaku: danmaku?.default, thumbnails: thumbnails?.default };
}
