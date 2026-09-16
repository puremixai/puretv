import { createHash } from 'crypto';

import { requestWorker } from './go-worker';
import { readLimitedText } from './media-body';

export class AnimeDownloadUncertainError extends Error {
  readonly status = 409;
  constructor(readonly receiptId?: string) {
    super(
      '下载提交结果不确定，请核对 OpenList 下载队列；不会自动重复提交' +
        (receiptId ? '（收据：' + receiptId + '）' : ''),
    );
  }
}

export async function submitGoAnimeDownload(input: {
  owner: string;
  key: string;
  operation: {
    url: string;
    username: string;
    password: string;
    path: string;
    method: string;
    body: string;
    headers: Record<string, string>;
  };
}): Promise<{ replayed: boolean }> {
  const receiptId = createHash('sha256')
    .update(input.owner + '\0' + input.key)
    .digest('hex');
  try {
    const response = await requestWorker(
      '/v1/anime/download',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      70_000,
    );
    const result = JSON.parse(await readLimitedText(response, 64 * 1024));
    if (!response.ok || result?.code !== 200)
      throw new AnimeDownloadUncertainError(
        typeof result?.receiptId === 'string' &&
          /^[a-f0-9]{64}$/.test(result.receiptId)
          ? result.receiptId
          : receiptId,
      );
    return { replayed: result.replayed === true };
  } catch (error) {
    if (error instanceof AnimeDownloadUncertainError) throw error;
    // Submission may have committed despite a lost reply. The same receipt key is safe to query again.
    throw new AnimeDownloadUncertainError(receiptId);
  }
}
