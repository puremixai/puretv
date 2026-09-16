import { NextRequest, NextResponse } from 'next/server';

import { asRecord, isMusicSource, lxGetJson, LxServerSong, normalizeLxSong, unwrapLxArray } from '@/lib/music-v2';
import { badRequest, internalError } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'kw';
    const boardId = searchParams.get('boardId') || searchParams.get('bangid') || '';
    const page = Number(searchParams.get('page') || '1');

    if (!isMusicSource(source)) return badRequest('不支持的音源');
    if (!boardId) return badRequest('缺少榜单 ID');

    const payload = await lxGetJson<unknown>(`/api/music/leaderboard/list?source=${source}&bangid=${encodeURIComponent(boardId)}&page=${page}`, 'none');
    const list = unwrapLxArray<LxServerSong>(payload);
    const payloadRecord = asRecord(payload);
    const dataRecord = asRecord(payloadRecord.data);
    const nestedDataRecord = asRecord(dataRecord.data);
    const total =
      payloadRecord.total ??
      dataRecord.total ??
      nestedDataRecord.total ??
      list.length;

    return NextResponse.json({
      success: true,
      data: {
        board: { id: boardId },
        list: list.map(normalizeLxSong),
        total,
        page,
      },
    });
  } catch (error) {
    return internalError('获取榜单歌曲失败', (error as Error).message);
  }
}
