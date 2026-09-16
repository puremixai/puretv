import { NextRequest, NextResponse } from 'next/server';

import { asRecord, isMusicSource, lxGetJson, LxServerSong, normalizeLxSong, unwrapLxArray } from '@/lib/music-v2';
import { badRequest, internalError } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'wy';
    const id = searchParams.get('id') || '';
    const page = Number(searchParams.get('page') || '1');

    if (!isMusicSource(source)) return badRequest('不支持的音源');
    if (!id) return badRequest('缺少歌单 ID');

    const payload = await lxGetJson<unknown>(`/api/music/songList/detail?source=${source}&id=${encodeURIComponent(id)}&page=${page}`, 'none');
    const list = unwrapLxArray<LxServerSong>(payload);
    const payloadRecord = asRecord(payload);
    const dataRecord = asRecord(payloadRecord.data);

    return NextResponse.json({
      success: true,
      data: {
        info: payloadRecord.info || dataRecord.info || {},
        list: list.map(normalizeLxSong),
        page: payloadRecord.page ?? page,
        total: payloadRecord.total ?? list.length,
        limit: payloadRecord.limit ?? list.length,
      },
    });
  } catch (error) {
    return internalError('获取歌单详情失败', (error as Error).message);
  }
}
