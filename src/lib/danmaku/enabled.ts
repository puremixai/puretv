export function isDanmakuEnabled(): boolean {
  if (typeof window === 'undefined')
    return process.env.DANMAKU_ENABLED !== 'false';
  return (
    (window as Window & { RUNTIME_CONFIG?: { DANMAKU_ENABLED?: boolean } })
      .RUNTIME_CONFIG?.DANMAKU_ENABLED !== false
  );
}

export function disabledDanmakuResult() {
  return {
    disabled: true,
    errorCode: 0,
    success: true,
    errorMessage: '本站已关闭弹幕获取',
    animes: [],
    isMatched: false,
    matches: [],
    count: 0,
    comments: [],
    bangumi: { bangumiId: '', animeTitle: '', episodes: [] },
  };
}
