import type { DatabaseAdapter } from '../d1-adapter';
import type {
  LocalSettingsSyncRecord,
  SetLocalSettingsSyncOptions,
  SetLocalSettingsSyncResult,
} from '../types';

interface SettingsRow {
  payload: string;
  payload_md5: string;
  payload_size: number;
  version: number;
  updated_at: number;
}

/** Atomic settings operations shared by PostgreSQL, D1, SQLite and Turso. */
export class SqlLocalSettingsRepository {
  constructor(private db: DatabaseAdapter) {}

  async get(userName: string): Promise<LocalSettingsSyncRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT payload, payload_md5, payload_size, version, updated_at
        FROM user_local_settings WHERE username = ?`,
      )
      .bind(userName)
      .first<SettingsRow>();
    if (!row) return null;
    return {
      payload: row.payload,
      payloadMd5: row.payload_md5,
      payloadSize: Number(row.payload_size),
      version: Number(row.version),
      updatedAt: Number(row.updated_at),
    };
  }

  async set(
    userName: string,
    payload: string,
    opts: SetLocalSettingsSyncOptions,
  ): Promise<SetLocalSettingsSyncResult> {
    const expected = opts.expectedVersion;
    if (
      expected !== undefined &&
      (!Number.isSafeInteger(expected) || expected < 0)
    ) {
      throw new Error('Invalid settings version');
    }
    const now = Date.now();
    // The comparison and version increment happen inside the write itself.
    // Version zero means create-only; positive versions never insert missing rows.
    const statement =
      expected !== undefined && expected > 0
        ? this.db
            .prepare(
              `UPDATE user_local_settings
          SET payload = ?, payload_md5 = ?, payload_size = ?,
              version = version + 1, updated_at = ?
          WHERE username = ? AND version = ?
          RETURNING version, updated_at`,
            )
            .bind(
              payload,
              opts.payloadMd5,
              opts.payloadSize,
              now,
              userName,
              expected,
            )
        : this.db
            .prepare(
              `INSERT INTO user_local_settings
          (username, payload, payload_md5, payload_size, version, updated_at)
          VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT (username) ${
            expected === 0
              ? 'DO NOTHING'
              : `DO UPDATE SET payload = excluded.payload,
                payload_md5 = excluded.payload_md5, payload_size = excluded.payload_size,
                version = user_local_settings.version + 1, updated_at = excluded.updated_at`
          }
          RETURNING version, updated_at`,
            )
            .bind(userName, payload, opts.payloadMd5, opts.payloadSize, now);
    const saved =
      await statement.first<Pick<SettingsRow, 'version' | 'updated_at'>>();
    if (saved) {
      return {
        ok: true,
        version: Number(saved.version),
        updatedAt: Number(saved.updated_at),
      };
    }
    const current = await this.get(userName);
    return {
      ok: false,
      version: current?.version ?? 0,
      updatedAt: current?.updatedAt ?? 0,
    };
  }
}
