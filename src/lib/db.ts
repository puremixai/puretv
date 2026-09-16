/* eslint-disable @typescript-eslint/no-explicit-any */

import { logger } from '@/lib/logger';

import { AdminConfig } from './admin.types';
import { BookReadRecord, BookShelfItem } from './book.types';
import { ConfigConflictError, nextConfig, publicConfig, StoredAdminConfig } from './config-revisions';
import { checkMutationVersion, recordConfigConflict } from './config-write-context';
import type { DatabaseAdapter } from './d1-adapter';
import { MusicPlayRecord } from './db.client';
import { MangaReadRecord, MangaShelfItem } from './manga.types';
import {
  MusicV2HistoryRecord,
  MusicV2PlaylistItem,
  MusicV2PlaylistRecord,
} from './music-v2';
import {
  DanmakuFilterConfig,
  Favorite,
  IStorage,
  LocalSettingsSyncRecord,
  PlayRecord,
  SetLocalSettingsSyncOptions,
  SetLocalSettingsSyncResult,
  SkipConfig,
  StoredUserInfo,
  StoredUserList,
  UserInfoUpdates,
} from './types';

// storage type 常量: 'localstorage' | 'redis' | 'upstash' | 'kvrocks' | 'd1' | 'postgres' | 'turso'，默认 'localstorage'
const IS_CLOUDFLARE_BUILD =
  process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | 'd1'
    | 'postgres'
    | 'turso'
    | undefined) || 'localstorage';

// 创建存储实例
function createStorage(): IStorage {
  switch (STORAGE_TYPE) {
    case 'redis': {
      if (IS_CLOUDFLARE_BUILD) {
        throw new Error(
          'Node Redis storage is not supported in Cloudflare builds. Use D1 or Upstash instead.'
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
      const { RedisStorage } = require('./redis.db');
      return new RedisStorage();
    }
    case 'upstash': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
      const { UpstashRedisStorage } = require('./upstash.db');
      return new UpstashRedisStorage();
    }
    case 'kvrocks': {
      if (IS_CLOUDFLARE_BUILD) {
        throw new Error(
          'Kvrocks storage is not supported in Cloudflare builds. Use D1 or Upstash instead.'
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
      const { KvrocksStorage } = require('./kvrocks.db');
      return new KvrocksStorage();
    }
    case 'd1': {
      // D1Storage 只能在服务端使用，客户端会报错
      if (typeof window !== 'undefined') {
        throw new Error('D1Storage can only be used on the server side');
      }
      const d1Adapter = getD1Adapter();
      // 动态导入 D1Storage 以避免客户端打包
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
      const { D1Storage } = require('./d1.db');
      return new D1Storage(d1Adapter);
    }
    case 'postgres': {
      // PostgresStorage 只能在服务端使用，客户端会报错
      if (typeof window !== 'undefined') {
        throw new Error('PostgresStorage can only be used on the server side');
      }
      const postgresAdapter = getPostgresAdapter();
      // 动态导入 PostgresStorage 以避免客户端打包
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
      const { PostgresStorage } = require('./postgres.db');
      return new PostgresStorage(postgresAdapter);
    }
    case 'turso': {
      // TursoStorage 只能在服务端使用，客户端会报错
      if (typeof window !== 'undefined') {
        throw new Error('TursoStorage can only be used on the server side');
      }
      const tursoAdapter = getTursoAdapter();
      // 复用 D1Storage（Turso 基于 libSQL/SQLite，SQL 语法完全兼容）
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
      const { D1Storage: TursoD1Storage } = require('./d1.db');
      return new TursoD1Storage(tursoAdapter);
    }
    case 'localstorage':
    default:
      return null as unknown as IStorage;
  }
}

/**
 * 获取 Postgres 适配器
 * 使用标准 PostgreSQL 连接池
 */
function getPostgresAdapter(): DatabaseAdapter {
  // 动态导入适配器以避免客户端打包
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
  const { PostgresAdapter }: typeof import('./postgres-adapter') = require('./postgres-adapter');

  logger.debug('Using PostgreSQL database');

  return new PostgresAdapter();
}

/**
 * 获取 Turso 适配器
 * 使用 @libsql/client 连接 Turso (libSQL) 远程数据库
 * 适用于 EdgeOne Pages 等无内置数据库的边缘平台
 */
function getTursoAdapter(): DatabaseAdapter {
  // 动态导入适配器以避免客户端打包
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
  const { TursoAdapter }: typeof import('./turso-adapter') = require('./turso-adapter');

  const tursoUrl = process.env.TURSO_URL;
  const tursoToken = process.env.TURSO_TOKEN;

  if (!tursoUrl || !tursoToken) {
    throw new Error(
      'TURSO_URL and TURSO_TOKEN env variables must be set for Turso storage'
    );
  }

  logger.debug('Using Turso (libSQL) database');

  return new TursoAdapter(tursoUrl, tursoToken);
}

/**
 * 获取 D1 适配器
 * 开发环境：使用 better-sqlite3
 * 生产环境：使用 Cloudflare D1
 */
function getD1Adapter(): DatabaseAdapter {
  // 动态导入适配器以避免客户端打包
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
  const { CloudflareD1Adapter, SQLiteAdapter }: typeof import('./d1-adapter') = require('./d1-adapter');

  // 检查是否为 Cloudflare 构建
  const isCloudflare =
    process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';

  // 生产环境：Cloudflare Workers/Pages
  if (isCloudflare) {
    let cachedAdapter: import('./d1-adapter').CloudflareD1Adapter | null = null;
    const getAdapter = (): import('./d1-adapter').CloudflareD1Adapter => {
      if (!cachedAdapter) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
        const { getCloudflareContext } = require('@opennextjs/cloudflare');
        const { env } = getCloudflareContext();
        if (!env.DB) {
          throw new Error('D1 database binding (DB) not found in Cloudflare environment');
        }
        cachedAdapter = new CloudflareD1Adapter(env.DB);
      }
      return cachedAdapter;
    };
    return {
      prepare: (query) => getAdapter().prepare(query),
      batch: (statements) => getAdapter().batch(statements),
    };
  }

  // 开发环境：better-sqlite3
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
  const Database = require('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Select the server-only backend lazily without bundling incompatible runtime adapters.
  const path = require('path');

  const dbPath =
    process.env.SQLITE_DB_PATH ||
    path.join(process.cwd(), '.data', 'puretv.db');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // 启用 WAL 模式提升性能
  db.pragma('foreign_keys = ON'); // 与 D1 保持一致，启用外键约束
  db.pragma('busy_timeout = 5000'); // 避免启动阶段或并发写入时立即锁失败

  logger.debug('Using SQLite database (non-Cloudflare mode)');
  logger.debug('Database location:', dbPath);

  return new SQLiteAdapter(db);
}

// 单例存储实例
let storageInstance: IStorage | null = null;

export function getStorage(): IStorage {
  if (!storageInstance) {
    storageInstance = createStorage();
  }
  return storageInstance;
}

// 工具函数：生成存储key
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// 导出便捷方法
export class DbManager {
  private storage: IStorage;

  constructor() {
    this.storage = getStorage();
  }

  // 播放记录相关方法
  async getPlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<PlayRecord | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setPlayRecord(userName, key, record);
  }

  async getAllPlayRecords(userName: string): Promise<{
    [key: string]: PlayRecord;
  }> {
    return this.storage.getAllPlayRecords(userName);
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deletePlayRecord(userName, key);
  }

  async deletePlayRecords(userName: string, keys: string[]): Promise<void> {
    await this.storage.deletePlayRecords(userName, keys);
  }

  // 收藏相关方法
  async getFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<Favorite | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFavorite(userName, key);
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFavorite(userName, key, favorite);
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    return this.storage.getAllFavorites(userName);
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFavorite(userName, key);
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string
  ): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  // 音乐播放记录相关方法
  async saveMusicPlayRecord(
    userName: string,
    platform: string,
    id: string,
    record: MusicPlayRecord
  ): Promise<void> {
    const key = generateStorageKey(platform, id);
    await this.storage.setMusicPlayRecord(userName, key, record);
  }

  async batchSaveMusicPlayRecords(
    userName: string,
    records: Array<{ platform: string; id: string; record: MusicPlayRecord }>
  ): Promise<void> {
    const batchRecords = records.map(({ platform, id, record }) => ({
      key: generateStorageKey(platform, id),
      record,
    }));
    await this.storage.batchSetMusicPlayRecords(userName, batchRecords);
  }

  async getAllMusicPlayRecords(userName: string): Promise<{
    [key: string]: MusicPlayRecord;
  }> {
    return this.storage.getAllMusicPlayRecords(userName);
  }

  async deleteMusicPlayRecord(
    userName: string,
    platform: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(platform, id);
    await this.storage.deleteMusicPlayRecord(userName, key);
  }

  async clearAllMusicPlayRecords(userName: string): Promise<void> {
    await this.storage.clearAllMusicPlayRecords(userName);
  }

  // Music V2 历史记录相关
  async listMusicV2History(userName: string): Promise<MusicV2HistoryRecord[]> {
    if (typeof (this.storage as any).listMusicV2History === 'function') {
      // 按播放队列顺序返回（createdAt ASC），
      // 当前播放项由调用方基于 lastPlayedAt 决定。
      return (this.storage as any).listMusicV2History(userName);
    }
    return [];
  }

  async upsertMusicV2History(
    userName: string,
    record: MusicV2HistoryRecord
  ): Promise<void> {
    if (typeof (this.storage as any).upsertMusicV2History === 'function') {
      await (this.storage as any).upsertMusicV2History(userName, record);
    }
  }

  async batchUpsertMusicV2History(
    userName: string,
    records: MusicV2HistoryRecord[]
  ): Promise<void> {
    if (typeof (this.storage as any).batchUpsertMusicV2History === 'function') {
      await (this.storage as any).batchUpsertMusicV2History(userName, records);
    }
  }

  async deleteMusicV2History(userName: string, songId: string): Promise<void> {
    if (typeof (this.storage as any).deleteMusicV2History === 'function') {
      await (this.storage as any).deleteMusicV2History(userName, songId);
    }
  }

  async clearMusicV2History(userName: string): Promise<void> {
    if (typeof (this.storage as any).clearMusicV2History === 'function') {
      await (this.storage as any).clearMusicV2History(userName);
    }
  }

  // Music V2 歌单相关
  async createMusicV2Playlist(
    userName: string,
    playlist: { id: string; name: string; description?: string; cover?: string }
  ): Promise<void> {
    if (typeof (this.storage as any).createMusicV2Playlist === 'function') {
      await (this.storage as any).createMusicV2Playlist(userName, playlist);
    }
  }

  async getMusicV2Playlist(
    playlistId: string
  ): Promise<MusicV2PlaylistRecord | null> {
    if (typeof (this.storage as any).getMusicV2Playlist === 'function') {
      return (this.storage as any).getMusicV2Playlist(playlistId);
    }
    return null;
  }

  async listMusicV2Playlists(
    userName: string
  ): Promise<MusicV2PlaylistRecord[]> {
    if (typeof (this.storage as any).listMusicV2Playlists === 'function') {
      return (this.storage as any).listMusicV2Playlists(userName);
    }
    return [];
  }

  async updateMusicV2Playlist(
    playlistId: string,
    updates: {
      name?: string;
      description?: string;
      cover?: string;
      song_count?: number;
    }
  ): Promise<void> {
    if (typeof (this.storage as any).updateMusicV2Playlist === 'function') {
      await (this.storage as any).updateMusicV2Playlist(playlistId, updates);
    }
  }

  async deleteMusicV2Playlist(playlistId: string): Promise<void> {
    if (typeof (this.storage as any).deleteMusicV2Playlist === 'function') {
      await (this.storage as any).deleteMusicV2Playlist(playlistId);
    }
  }

  async addMusicV2PlaylistItem(
    playlistId: string,
    item: MusicV2PlaylistItem
  ): Promise<void> {
    if (typeof (this.storage as any).addMusicV2PlaylistItem === 'function') {
      await (this.storage as any).addMusicV2PlaylistItem(playlistId, item);
    }
  }

  async removeMusicV2PlaylistItem(
    playlistId: string,
    songId: string
  ): Promise<void> {
    if (typeof (this.storage as any).removeMusicV2PlaylistItem === 'function') {
      await (this.storage as any).removeMusicV2PlaylistItem(playlistId, songId);
    }
  }

  async listMusicV2PlaylistItems(
    playlistId: string
  ): Promise<MusicV2PlaylistItem[]> {
    if (typeof (this.storage as any).listMusicV2PlaylistItems === 'function') {
      return (this.storage as any).listMusicV2PlaylistItems(playlistId);
    }
    return [];
  }

  async hasMusicV2PlaylistItem(
    playlistId: string,
    songId: string
  ): Promise<boolean> {
    if (typeof (this.storage as any).hasMusicV2PlaylistItem === 'function') {
      return (this.storage as any).hasMusicV2PlaylistItem(playlistId, songId);
    }
    return false;
  }

  // 音乐歌单相关方法
  async createMusicPlaylist(
    userName: string,
    playlist: {
      id: string;
      name: string;
      description?: string;
      cover?: string;
    }
  ): Promise<void> {
    if (typeof (this.storage as any).createMusicPlaylist === 'function') {
      await (this.storage as any).createMusicPlaylist(userName, playlist);
    }
  }

  async getMusicPlaylist(playlistId: string): Promise<any | null> {
    if (typeof (this.storage as any).getMusicPlaylist === 'function') {
      return (this.storage as any).getMusicPlaylist(playlistId);
    }
    return null;
  }

  async getUserMusicPlaylists(userName: string): Promise<any[]> {
    if (typeof (this.storage as any).getUserMusicPlaylists === 'function') {
      return (this.storage as any).getUserMusicPlaylists(userName);
    }
    return [];
  }

  async updateMusicPlaylist(
    playlistId: string,
    updates: {
      name?: string;
      description?: string;
      cover?: string;
    }
  ): Promise<void> {
    if (typeof (this.storage as any).updateMusicPlaylist === 'function') {
      await (this.storage as any).updateMusicPlaylist(playlistId, updates);
    }
  }

  async deleteMusicPlaylist(playlistId: string): Promise<void> {
    if (typeof (this.storage as any).deleteMusicPlaylist === 'function') {
      await (this.storage as any).deleteMusicPlaylist(playlistId);
    }
  }

  async addSongToPlaylist(
    playlistId: string,
    song: {
      platform: string;
      id: string;
      name: string;
      artist: string;
      album?: string;
      pic?: string;
      duration: number;
    }
  ): Promise<void> {
    if (typeof (this.storage as any).addSongToPlaylist === 'function') {
      await (this.storage as any).addSongToPlaylist(playlistId, song);
    }
  }

  async removeSongFromPlaylist(
    playlistId: string,
    platform: string,
    songId: string
  ): Promise<void> {
    if (typeof (this.storage as any).removeSongFromPlaylist === 'function') {
      await (this.storage as any).removeSongFromPlaylist(
        playlistId,
        platform,
        songId
      );
    }
  }

  async getPlaylistSongs(playlistId: string): Promise<any[]> {
    if (typeof (this.storage as any).getPlaylistSongs === 'function') {
      return (this.storage as any).getPlaylistSongs(playlistId);
    }
    return [];
  }

  async isSongInPlaylist(
    playlistId: string,
    platform: string,
    songId: string
  ): Promise<boolean> {
    if (typeof (this.storage as any).isSongInPlaylist === 'function') {
      return (this.storage as any).isSongInPlaylist(
        playlistId,
        platform,
        songId
      );
    }
    return false;
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    return this.storage.verifyUser(userName, password);
  }

  // 检查用户是否已存在
  async checkUserExist(userName: string): Promise<boolean> {
    return this.storage.checkUserExist(userName);
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    await this.storage.changePassword(userName, newPassword);
  }

  async deleteUser(userName: string): Promise<void> {
    await this.storage.deleteUser(userName);
  }

  // ---------- 用户相关（新版本） ----------
  async createUserV2(
    userName: string,
    password: string,
    role: 'owner' | 'admin' | 'user' = 'user',
    tags?: string[],
    oidcSub?: string,
    enabledApis?: string[]
  ): Promise<void> {
    if (typeof this.storage.createUserV2 === 'function') {
      await this.storage.createUserV2(
        userName,
        password,
        role,
        tags,
        oidcSub,
        enabledApis
      );
    }
  }

  async verifyUserV2(userName: string, password: string): Promise<boolean> {
    if (typeof this.storage.verifyUserV2 === 'function') {
      return this.storage.verifyUserV2(userName, password);
    }
    return false;
  }

  async getUserInfoV2(userName: string, fresh = false): Promise<StoredUserInfo | null> {
    if (typeof this.storage.getUserInfoV2 === 'function') {
      return this.storage.getUserInfoV2(userName, fresh);
    }
    return null;
  }

  async updateUserInfoV2(userName: string, updates: UserInfoUpdates): Promise<void> {
    if (typeof this.storage.updateUserInfoV2 === 'function') {
      await this.storage.updateUserInfoV2(userName, updates);
    }
  }

  async changePasswordV2(userName: string, newPassword: string): Promise<void> {
    if (typeof this.storage.changePasswordV2 === 'function') {
      await this.storage.changePasswordV2(userName, newPassword);
    }
  }

  async checkUserExistV2(userName: string): Promise<boolean> {
    if (typeof this.storage.checkUserExistV2 === 'function') {
      return this.storage.checkUserExistV2(userName);
    }
    return false;
  }

  async getUserByOidcSub(oidcSub: string): Promise<string | null> {
    if (typeof this.storage.getUserByOidcSub === 'function') {
      return this.storage.getUserByOidcSub(oidcSub);
    }
    return null;
  }

  async getUserListV2(
    offset = 0,
    limit = 20,
    ownerUsername?: string,
    search?: string
  ): Promise<StoredUserList> {
    if (typeof this.storage.getUserListV2 === 'function') {
      return this.storage.getUserListV2(
        offset,
        limit,
        ownerUsername,
        search
      );
    }
    return { users: [], total: 0 };
  }

  async deleteUserV2(userName: string): Promise<void> {
    if (typeof this.storage.deleteUserV2 === 'function') {
      await this.storage.deleteUserV2(userName);
    }
  }

  async getUsersByTag(tagName: string): Promise<string[]> {
    if (typeof this.storage.getUsersByTag === 'function') {
      return this.storage.getUsersByTag(tagName);
    }
    return [];
  }

  // ---------- TVBox订阅token ----------
  async getTvboxSubscribeToken(userName: string): Promise<string | null> {
    if (typeof this.storage.getTvboxSubscribeToken === 'function') {
      return this.storage.getTvboxSubscribeToken(userName);
    }
    return null;
  }

  async setTvboxSubscribeToken(userName: string, token: string): Promise<void> {
    if (typeof this.storage.setTvboxSubscribeToken === 'function') {
      await this.storage.setTvboxSubscribeToken(userName, token);
    }
  }

  async getUsernameByTvboxToken(token: string): Promise<string | null> {
    if (typeof this.storage.getUsernameByTvboxToken === 'function') {
      return this.storage.getUsernameByTvboxToken(token);
    }
    return null;
  }

  // ---------- 播放记录迁移 ----------
  async migratePlayRecords(userName: string): Promise<void> {
    if (typeof this.storage.migratePlayRecords === 'function') {
      await this.storage.migratePlayRecords(userName);
    }
  }

  // ---------- 收藏迁移 ----------
  async migrateFavorites(userName: string): Promise<void> {
    if (typeof this.storage.migrateFavorites === 'function') {
      await this.storage.migrateFavorites(userName);
    }
  }

  // ---------- 跳过配置迁移 ----------
  async migrateSkipConfigs(userName: string): Promise<void> {
    if (typeof this.storage.migrateSkipConfigs === 'function') {
      await this.storage.migrateSkipConfigs(userName);
    }
  }

  // ---------- 数据迁移 ----------
  async migrateUsersFromConfig(adminConfig: AdminConfig): Promise<void> {
    if (typeof this.storage.createUserV2 !== 'function') {
      throw new Error('当前存储类型不支持新版用户存储');
    }

    const users = adminConfig.UserConfig.Users;
    if (!users || users.length === 0) {
      return;
    }

    logger.debug(`开始迁移 ${users.length} 个用户...`);

    for (const user of users) {
      try {
        // 跳过环境变量中的站长（站长使用环境变量认证，不需要迁移）
        if (user.username === process.env.USERNAME) {
          logger.debug(`跳过站长 ${user.username} 的迁移`);
          continue;
        }

        // 检查用户是否已经迁移
        const exists = await this.checkUserExistV2(user.username);
        if (exists) {
          logger.debug(`用户 ${user.username} 已存在，跳过迁移`);
          continue;
        }

        // 获取密码
        let password = '';

        // 如果是OIDC用户，生成随机密码（OIDC用户不需要密码登录）
        if ((user as any).oidcSub) {
          password = crypto.randomUUID();
          logger.debug(`用户 ${user.username} (OIDC用户) 使用随机密码迁移`);
        }
        // 尝试从旧的存储中获取密码
        else {
          try {
            if ((this.storage as any).client) {
              const storedPassword = await (this.storage as any).client.get(
                `u:${user.username}:pwd`
              );
              if (storedPassword) {
                password = storedPassword;
                logger.debug(`用户 ${user.username} 使用旧密码迁移`);
              } else {
                // 没有旧密码，使用随机密码，需管理员重置
                password = crypto.randomUUID();
                logger.debug(`用户 ${user.username} 没有旧密码，使用随机密码，需管理员重置`);
              }
            } else {
              password = crypto.randomUUID();
            }
          } catch (err) {
            logger.error(
              `获取用户 ${user.username} 的密码失败，使用随机密码，需管理员重置`,
              err
            );
            password = crypto.randomUUID();
          }
        }

        // 将站长角色转换为普通角色
        const migratedRole = user.role === 'owner' ? 'user' : user.role;
        if (user.role === 'owner') {
          logger.debug(`用户 ${user.username} 的角色从 owner 转换为 user`);
        }

        // 创建新用户
        await this.createUserV2(
          user.username,
          password,
          migratedRole,
          user.tags,
          (user as any).oidcSub,
          user.enabledApis
        );

        // 新版凭据已持久化，删除旧版明文密码。
        if ((this.storage as any).client?.del) await (this.storage as any).client.del(`u:${user.username}:pwd`);

        // 如果用户被封禁，更新状态
        if (user.banned) {
          await this.updateUserInfoV2(user.username, { banned: true });
        }

        logger.debug(`用户 ${user.username} 迁移成功`);
      } catch (err) {
        logger.error(`迁移用户 ${user.username} 失败:`, err);
      }
    }

    logger.debug('用户迁移完成');
  }

  // ---------- 搜索历史 ----------
  async getSearchHistory(userName: string): Promise<string[]> {
    return this.storage.getSearchHistory(userName);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.storage.addSearchHistory(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.storage.deleteSearchHistory(userName, keyword);
  }

  // ---------- 漫画书架 ----------
  async getMangaShelf(
    userName: string,
    sourceId: string,
    mangaId: string
  ): Promise<MangaShelfItem | null> {
    return this.storage.getMangaShelf(
      userName,
      generateStorageKey(sourceId, mangaId)
    );
  }

  async saveMangaShelf(
    userName: string,
    sourceId: string,
    mangaId: string,
    item: MangaShelfItem
  ): Promise<void> {
    await this.storage.setMangaShelf(
      userName,
      generateStorageKey(sourceId, mangaId),
      item
    );
  }

  async getAllMangaShelf(
    userName: string
  ): Promise<{ [key: string]: MangaShelfItem }> {
    return this.storage.getAllMangaShelf(userName);
  }

  async deleteMangaShelf(
    userName: string,
    sourceId: string,
    mangaId: string
  ): Promise<void> {
    await this.storage.deleteMangaShelf(
      userName,
      generateStorageKey(sourceId, mangaId)
    );
  }

  // ---------- 漫画阅读历史 ----------
  async getMangaReadRecord(
    userName: string,
    sourceId: string,
    mangaId: string
  ): Promise<MangaReadRecord | null> {
    return this.storage.getMangaReadRecord(
      userName,
      generateStorageKey(sourceId, mangaId)
    );
  }

  async saveMangaReadRecord(
    userName: string,
    sourceId: string,
    mangaId: string,
    record: MangaReadRecord
  ): Promise<void> {
    await this.storage.setMangaReadRecord(
      userName,
      generateStorageKey(sourceId, mangaId),
      record
    );
  }

  async getAllMangaReadRecords(
    userName: string
  ): Promise<{ [key: string]: MangaReadRecord }> {
    return this.storage.getAllMangaReadRecords(userName);
  }

  async deleteMangaReadRecord(
    userName: string,
    sourceId: string,
    mangaId: string
  ): Promise<void> {
    await this.storage.deleteMangaReadRecord(
      userName,
      generateStorageKey(sourceId, mangaId)
    );
  }

  // ---------- 电子书书架 ----------
  async getBookShelf(
    userName: string,
    sourceId: string,
    bookId: string
  ): Promise<BookShelfItem | null> {
    return this.storage.getBookShelf(
      userName,
      generateStorageKey(sourceId, bookId)
    );
  }

  async saveBookShelf(
    userName: string,
    sourceId: string,
    bookId: string,
    item: BookShelfItem
  ): Promise<void> {
    await this.storage.setBookShelf(
      userName,
      generateStorageKey(sourceId, bookId),
      item
    );
  }

  async getAllBookShelf(
    userName: string
  ): Promise<{ [key: string]: BookShelfItem }> {
    return this.storage.getAllBookShelf(userName);
  }

  async deleteBookShelf(
    userName: string,
    sourceId: string,
    bookId: string
  ): Promise<void> {
    await this.storage.deleteBookShelf(
      userName,
      generateStorageKey(sourceId, bookId)
    );
  }

  // ---------- 电子书阅读历史 ----------
  async getBookReadRecord(
    userName: string,
    sourceId: string,
    bookId: string
  ): Promise<BookReadRecord | null> {
    return this.storage.getBookReadRecord(
      userName,
      generateStorageKey(sourceId, bookId)
    );
  }

  async saveBookReadRecord(
    userName: string,
    sourceId: string,
    bookId: string,
    record: BookReadRecord
  ): Promise<void> {
    await this.storage.setBookReadRecord(
      userName,
      generateStorageKey(sourceId, bookId),
      record
    );
  }

  async getAllBookReadRecords(
    userName: string
  ): Promise<{ [key: string]: BookReadRecord }> {
    return this.storage.getAllBookReadRecords(userName);
  }

  async deleteBookReadRecord(
    userName: string,
    sourceId: string,
    bookId: string
  ): Promise<void> {
    await this.storage.deleteBookReadRecord(
      userName,
      generateStorageKey(sourceId, bookId)
    );
  }

  // 获取全部用户名
  async getAllUsers(): Promise<string[]> {
    if (typeof this.storage.getAllUsers === 'function') {
      return this.storage.getAllUsers();
    }
    return [];
  }

  // ---------- 管理员配置 ----------
  async getAdminConfig(): Promise<AdminConfig | null> {
    const config = await this.storage?.getAdminConfig();
    return config ? publicConfig(config) : null;
  }

  async getConfigHistory() {
    const config = await this.storage?.getAdminConfig() as StoredAdminConfig | null;
    return config?._history || [];
  }

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    if (!this.storage) return;
    try {
      const current = await this.storage.getAdminConfig() as StoredAdminConfig | null;
      checkMutationVersion(current?.ConfigVersion || 0);
      const next = nextConfig(current, config);
      if (!await this.storage.compareAndSetAdminConfig(current?.ConfigVersion || 0, next)) throw new ConfigConflictError();
      config.ConfigVersion = next.ConfigVersion;
      config.ConfigUpdatedAt = next.ConfigUpdatedAt;
      const { setCachedConfig } = await import('./config');
      await setCachedConfig(config);
    } catch (error) {
      recordConfigConflict(error);
      const { clearConfigCache } = await import('./config');
      await clearConfigCache();
      throw error;
    }
  }

  // ---------- 本地设置云同步 ----------
  async getUserLocalSettings(
    userName: string
  ): Promise<LocalSettingsSyncRecord | null> {
    if (typeof this.storage.getUserLocalSettings === 'function') {
      return this.storage.getUserLocalSettings(userName);
    }
    return null;
  }

  async setUserLocalSettings(
    userName: string,
    payload: string,
    opts: SetLocalSettingsSyncOptions
  ): Promise<SetLocalSettingsSyncResult> {
    if (typeof this.storage.setUserLocalSettings === 'function') {
      return this.storage.setUserLocalSettings(userName, payload, opts);
    }
    // 存储后端不支持时静默忽略（等价于从未开启）
    return { ok: true, version: 0, updatedAt: Date.now() };
  }

  // ---------- 跳过片头片尾配置 ----------
  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    if (typeof this.storage.getSkipConfig === 'function') {
      return this.storage.getSkipConfig(userName, source, id);
    }
    return null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    if (typeof this.storage.setSkipConfig === 'function') {
      await this.storage.setSkipConfig(userName, source, id, config);
    }
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    if (typeof this.storage.deleteSkipConfig === 'function') {
      await this.storage.deleteSkipConfig(userName, source, id);
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    if (typeof this.storage.getAllSkipConfigs === 'function') {
      return this.storage.getAllSkipConfigs(userName);
    }
    return {};
  }

  // ---------- 弹幕过滤配置 ----------
  async getDanmakuFilterConfig(
    userName: string
  ): Promise<DanmakuFilterConfig | null> {
    if (typeof this.storage.getDanmakuFilterConfig === 'function') {
      return this.storage.getDanmakuFilterConfig(userName);
    }
    return null;
  }

  async setDanmakuFilterConfig(
    userName: string,
    config: DanmakuFilterConfig
  ): Promise<void> {
    if (typeof this.storage.setDanmakuFilterConfig === 'function') {
      await this.storage.setDanmakuFilterConfig(userName, config);
    }
  }

  async deleteDanmakuFilterConfig(userName: string): Promise<void> {
    if (typeof this.storage.deleteDanmakuFilterConfig === 'function') {
      await this.storage.deleteDanmakuFilterConfig(userName);
    }
  }

  // ---------- 数据清理 ----------
  async clearAllData(): Promise<void> {
    if (typeof this.storage.clearAllData === 'function') {
      await this.storage.clearAllData();
    } else {
      throw new Error('存储类型不支持清空数据操作');
    }
  }

  // ---------- 通用键值存储 ----------
  async getGlobalValue(key: string): Promise<string | null> {
    if (typeof this.storage.getGlobalValue === 'function') {
      return this.storage.getGlobalValue(key);
    }
    return null;
  }

  async setGlobalValue(key: string, value: string): Promise<void> {
    if (typeof this.storage.setGlobalValue === 'function') {
      await this.storage.setGlobalValue(key, value);
    }
  }

  async deleteGlobalValue(key: string): Promise<void> {
    if (typeof this.storage.deleteGlobalValue === 'function') {
      await this.storage.deleteGlobalValue(key);
    }
  }


  // ---------- Telegram Bot绑定相关 ----------
  async getTelegramBinding(userName: string) {
    if (typeof this.storage.getTelegramBinding === 'function') {
      return this.storage.getTelegramBinding(userName);
    }
    return null;
  }

  async getTelegramBindingByTelegramUserId(telegramUserId: string) {
    if (typeof this.storage.getTelegramBindingByTelegramUserId === 'function') {
      return this.storage.getTelegramBindingByTelegramUserId(telegramUserId);
    }
    return null;
  }

  async upsertTelegramBinding(binding: import('./types').TelegramBindingRecord): Promise<void> {
    if (typeof this.storage.upsertTelegramBinding === 'function') {
      await this.storage.upsertTelegramBinding(binding);
    }
  }

  async deleteTelegramBindingByUsername(userName: string): Promise<void> {
    if (typeof this.storage.deleteTelegramBindingByUsername === 'function') {
      await this.storage.deleteTelegramBindingByUsername(userName);
    }
  }

  async deleteTelegramBindingByTelegramUserId(telegramUserId: string): Promise<void> {
    if (typeof this.storage.deleteTelegramBindingByTelegramUserId === 'function') {
      await this.storage.deleteTelegramBindingByTelegramUserId(telegramUserId);
    }
  }

  async getTelegramBindSession(code: string) {
    if (typeof this.storage.getTelegramBindSession === 'function') {
      return this.storage.getTelegramBindSession(code);
    }
    return null;
  }

  async upsertTelegramBindSession(session: import('./types').TelegramBindSessionRecord): Promise<void> {
    if (typeof this.storage.upsertTelegramBindSession === 'function') {
      await this.storage.upsertTelegramBindSession(session);
    }
  }

  async markTelegramBindSessionUsed(code: string): Promise<void> {
    if (typeof this.storage.markTelegramBindSessionUsed === 'function') {
      await this.storage.markTelegramBindSessionUsed(code);
    }
  }
}

// 导出默认实例
export const db = new DbManager();
