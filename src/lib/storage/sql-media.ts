import type { DatabaseAdapter } from '../d1-adapter';
import type { Favorite, PlayRecord } from '../types';

interface PlayRecordRow {
  key: string;
  title: string;
  source_name: string;
  cover: string | null;
  year: string | null;
  episode_index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  search_title: string | null;
  new_episodes: number | null;
  is_anime: number | boolean;
}

function playRecord(row: PlayRecordRow): PlayRecord {
  return {
    title: row.title,
    source_name: row.source_name,
    cover: row.cover || '',
    year: row.year || '',
    index: Number(row.episode_index),
    total_episodes: Number(row.total_episodes),
    play_time: Number(row.play_time),
    total_time: Number(row.total_time),
    save_time: Number(row.save_time),
    search_title: row.search_title || '',
    new_episodes:
      row.new_episodes == null ? undefined : Number(row.new_episodes),
    is_anime: row.is_anime === 1 || row.is_anime === true,
  };
}

/** D1-compatible SQL; PostgreSQL placeholders are supplied by its adapter. */
export class SqlPlayRecordRepository {
  constructor(private db: DatabaseAdapter) {}

  async get(userName: string, key: string): Promise<PlayRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM play_records WHERE username = ? AND key = ?')
      .bind(userName, key)
      .first<PlayRecordRow>();
    return row ? playRecord(row) : null;
  }

  async set(userName: string, key: string, record: PlayRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO play_records (
      username, key, title, source_name, cover, year, episode_index, total_episodes,
      play_time, total_time, save_time, search_title, new_episodes, is_anime
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (username, key) DO UPDATE SET
      title = excluded.title, source_name = excluded.source_name,
      cover = excluded.cover, year = excluded.year, episode_index = excluded.episode_index,
      total_episodes = excluded.total_episodes, play_time = excluded.play_time,
      total_time = excluded.total_time, save_time = excluded.save_time,
      search_title = excluded.search_title, new_episodes = excluded.new_episodes,
      is_anime = excluded.is_anime`,
      )
      .bind(
        userName,
        key,
        record.title,
        record.source_name,
        record.cover || '',
        record.year || '',
        record.index,
        record.total_episodes,
        record.play_time,
        record.total_time,
        record.save_time,
        record.search_title || '',
        record.new_episodes ?? null,
        record.is_anime ? 1 : 0,
      )
      .run();
  }

  async getAll(userName: string): Promise<Record<string, PlayRecord>> {
    const result = await this.db
      .prepare(
        'SELECT * FROM play_records WHERE username = ? ORDER BY save_time DESC',
      )
      .bind(userName)
      .all<PlayRecordRow>();
    return Object.fromEntries(
      (result.results || []).map((row) => [row.key, playRecord(row)]),
    );
  }

  async delete(userName: string, key: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM play_records WHERE username = ? AND key = ?')
      .bind(userName, key)
      .run();
  }

  async deleteMany(userName: string, keys: string[]): Promise<void> {
    const uniqueKeys = Array.from(new Set(keys)).filter(Boolean);
    if (uniqueKeys.length === 0) return;
    await this.db
      .prepare(
        `DELETE FROM play_records WHERE username = ? AND key IN (${uniqueKeys.map(() => '?').join(',')})`,
      )
      .bind(userName, ...uniqueKeys)
      .run();
  }

  async cleanup(userName: string): Promise<void> {
    const maxRecords = parseInt(
      process.env.MAX_PLAY_RECORDS_PER_USER || '100',
      10,
    );
    const row = await this.db
      .prepare('SELECT COUNT(*) AS count FROM play_records WHERE username = ?')
      .bind(userName)
      .first<{ count: number }>();
    if (Number(row?.count || 0) <= maxRecords + 10) return;
    await this.db
      .prepare(
        `DELETE FROM play_records WHERE username = ? AND key NOT IN (
      SELECT key FROM play_records WHERE username = ? ORDER BY save_time DESC LIMIT ?
    )`,
      )
      .bind(userName, userName, maxRecords)
      .run();
  }
}

interface FavoriteRow {
  key: string;
  source_name: string;
  total_episodes: number;
  title: string;
  year: string | null;
  cover: string | null;
  save_time: number;
  search_title: string | null;
  origin: Favorite['origin'] | null;
  is_completed: number | boolean;
  vod_remarks: string | null;
}

function favorite(row: FavoriteRow): Favorite {
  return {
    source_name: row.source_name,
    total_episodes: Number(row.total_episodes),
    title: row.title,
    year: row.year || '',
    cover: row.cover || '',
    save_time: Number(row.save_time),
    search_title: row.search_title || '',
    origin: row.origin ?? undefined,
    is_completed: row.is_completed === 1 || row.is_completed === true,
    vod_remarks: row.vod_remarks || undefined,
  };
}

export class SqlFavoriteRepository {
  constructor(private db: DatabaseAdapter) {}

  async get(userName: string, key: string): Promise<Favorite | null> {
    const row = await this.db
      .prepare('SELECT * FROM favorites WHERE username = ? AND key = ?')
      .bind(userName, key)
      .first<FavoriteRow>();
    return row ? favorite(row) : null;
  }

  async set(userName: string, key: string, item: Favorite): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO favorites (
      username, key, source_name, total_episodes, title, year, cover,
      save_time, search_title, origin, is_completed, vod_remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (username, key) DO UPDATE SET
      source_name = excluded.source_name, total_episodes = excluded.total_episodes,
      title = excluded.title, year = excluded.year, cover = excluded.cover,
      save_time = excluded.save_time, search_title = excluded.search_title,
      origin = excluded.origin, is_completed = excluded.is_completed, vod_remarks = excluded.vod_remarks`,
      )
      .bind(
        userName,
        key,
        item.source_name,
        item.total_episodes,
        item.title,
        item.year || '',
        item.cover || '',
        item.save_time,
        item.search_title || '',
        item.origin || null,
        item.is_completed ? 1 : 0,
        item.vod_remarks || null,
      )
      .run();
  }

  async getAll(userName: string): Promise<Record<string, Favorite>> {
    const result = await this.db
      .prepare(
        'SELECT * FROM favorites WHERE username = ? ORDER BY save_time DESC',
      )
      .bind(userName)
      .all<FavoriteRow>();
    return Object.fromEntries(
      (result.results || []).map((row) => [row.key, favorite(row)]),
    );
  }

  async delete(userName: string, key: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM favorites WHERE username = ? AND key = ?')
      .bind(userName, key)
      .run();
  }
}
