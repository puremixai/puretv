import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import {
  asRecord,
  hasCompleteSortOrder,
  interpolateMusicV2SortOrder,
  MUSIC_V2_SORT_STEP,
  MusicV2HistoryRecord,
  nextMusicV2SortOrder,
  normalizeSong,
  renumberMusicV2History,
  sortMusicV2History,
} from '@/lib/music-v2';
import { badRequest, getMusicV2Username, internalError, unauthorized } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

function toHistoryRecord(
  input: unknown,
  previous: MusicV2HistoryRecord | undefined,
  fallbackSortOrder: number
): MusicV2HistoryRecord {
  const inputRecord = asRecord(input);
  const song = normalizeSong(
    asRecord(inputRecord.song ?? inputRecord) as Parameters<typeof normalizeSong>[0]
  );
  const now = Date.now();
  return {
    ...song,
    playProgressSec: Number(inputRecord.playProgressSec ?? inputRecord.play_progress_sec ?? previous?.playProgressSec ?? 0),
    lastPlayedAt: Number(inputRecord.lastPlayedAt ?? inputRecord.last_played_at ?? now),
    playCount: Number(inputRecord.playCount ?? inputRecord.play_count ?? ((previous?.playCount || 0) + 1)),
    lastQuality: typeof (inputRecord.lastQuality || inputRecord.last_quality) === 'string'
      ? (inputRecord.lastQuality || inputRecord.last_quality) as string
      : previous?.lastQuality,
    createdAt: Number(previous?.createdAt ?? inputRecord.createdAt ?? inputRecord.created_at ?? now),
    updatedAt: now,
    // 队列位置只由拖拽改变，重复播放不能把歌曲挪位置
    sortOrder: Number.isFinite(previous?.sortOrder) ? (previous?.sortOrder as number) : fallbackSortOrder,
  };
}

// Redis 系的历史记录是整条 JSON，没法用 SQL 迁移回填 sortOrder，
// 这里对缺失的遗留数据按当前（createdAt）顺序做一次性补齐。
async function ensureSortOrder(
  username: string,
  records: MusicV2HistoryRecord[]
): Promise<MusicV2HistoryRecord[]> {
  if (!records.length || hasCompleteSortOrder(records)) return records;
  const renumbered = renumberMusicV2History(records);
  await db.batchUpsertMusicV2History(username, renumbered);
  return renumbered;
}

export async function GET(request: NextRequest) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    // 注意：records 按“播放队列顺序”返回（sortOrder ASC），
    // 前端再基于 lastPlayedAt 定位当前播放项。
    const records = await ensureSortOrder(username, await db.listMusicV2History(username));
    return NextResponse.json({ success: true, data: { records } });
  } catch (error) {
    return internalError('获取播放历史失败', (error as Error).message);
  }
}

export async function POST(request: NextRequest) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    const body = asRecord(await request.json());
    const existingRecords = await db.listMusicV2History(username);
    const existingMap = new Map(existingRecords.map(record => [record.songId, record]));
    // 新歌一律追加到队尾，因此从当前最大 sortOrder 之后开始分配
    let nextSortOrder = nextMusicV2SortOrder(existingRecords);

    if (Array.isArray(body.records)) {
      const records = body.records
        .map((item) => {
          const itemRecord = asRecord(item);
          const songRecord = asRecord(itemRecord.song);
          const songId = typeof songRecord.songId === 'string'
            ? songRecord.songId
            : typeof itemRecord.songId === 'string'
              ? itemRecord.songId
              : '';
          const previous = songId ? existingMap.get(songId) : undefined;
          const record = toHistoryRecord(item, previous, nextSortOrder);
          // 只有真正吃掉了分配值（即新记录）才推进游标，保证批量入队后顺序等于数组顺序
          if (record.sortOrder === nextSortOrder) nextSortOrder += MUSIC_V2_SORT_STEP;
          return record;
        })
        .filter((item: MusicV2HistoryRecord) => item.songId && item.source && item.name && item.artist);
      await db.batchUpsertMusicV2History(username, records);
      return NextResponse.json({ success: true, data: { count: records.length } });
    }

    const record = toHistoryRecord(
      body.record || body,
      existingMap.get(
        typeof asRecord(body.song).songId === 'string'
          ? asRecord(body.song).songId as string
          : typeof body.songId === 'string'
            ? body.songId
            : ''
      ),
      nextSortOrder
    );
    if (!record.songId || !record.source || !record.name || !record.artist) {
      return badRequest('历史记录数据不完整');
    }

    await db.upsertMusicV2History(username, record);
    return NextResponse.json({ success: true, data: { record } });
  } catch (error) {
    return internalError('保存播放历史失败', (error as Error).message);
  }
}

// 拖拽调整播放队列顺序：客户端给出被移动歌曲及其新的前后邻居，
// 服务端取邻居 sortOrder 的中值，通常只需改写一条记录。
export async function PATCH(request: NextRequest) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    const body = await request.json();
    const songId = typeof body.songId === 'string' ? body.songId : '';
    if (!songId) return badRequest('缺少 songId');

    const prevSongId = typeof body.prevSongId === 'string' ? body.prevSongId : '';
    const nextSongId = typeof body.nextSongId === 'string' ? body.nextSongId : '';

    const ordered = await ensureSortOrder(username, await db.listMusicV2History(username));
    const target = ordered.find(record => record.songId === songId);
    if (!target) return badRequest('播放记录不存在');

    const sortOrderOf = (id: string) =>
      id && id !== songId ? ordered.find(record => record.songId === id)?.sortOrder : undefined;

    const now = Date.now();
    const sortOrder = interpolateMusicV2SortOrder(sortOrderOf(prevSongId), sortOrderOf(nextSongId));

    if (sortOrder === null) {
      // 中值间距已耗尽浮点精度：按客户端期望的新顺序整队重新编号
      const rest = ordered.filter(record => record.songId !== songId);
      const insertAt = rest.findIndex(record => record.songId === nextSongId);
      rest.splice(insertAt < 0 ? rest.length : insertAt, 0, target);
      const renumbered = renumberMusicV2History(rest, now);
      await db.batchUpsertMusicV2History(username, renumbered);
      return NextResponse.json({ success: true, data: { records: renumbered } });
    }

    const moved = { ...target, sortOrder, updatedAt: now };
    await db.upsertMusicV2History(username, moved);
    const records = sortMusicV2History(
      ordered.map(record => (record.songId === songId ? moved : record))
    );
    return NextResponse.json({ success: true, data: { records } });
  } catch (error) {
    return internalError('调整播放顺序失败', (error as Error).message);
  }
}

export async function DELETE(request: NextRequest) {
  const username = await getMusicV2Username(request);
  if (!username) return unauthorized();

  try {
    const { searchParams } = new URL(request.url);
    const songId = searchParams.get('songId');
    if (songId) {
      await db.deleteMusicV2History(username, songId);
    } else {
      await db.clearMusicV2History(username);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return internalError('删除播放历史失败', (error as Error).message);
  }
}
