import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { D1PreparedStatement, D1Result, DatabaseAdapter } from './d1-adapter';
import { getPostgresPool } from '../../server/postgres';

// Preserve quoted literals, identifiers and comments while converting D1 placeholders.
export function postgresParameters(query: string): string {
  if (/\$\d+/.test(query)) return query;
  let index = 0;
  return query.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\$(\w*)\$[\s\S]*?\$\1\$|\?/g,
    (part) => (part === '?' ? `$${++index}` : part)
  );
}

export class PostgresAdapter implements DatabaseAdapter {
  constructor(private pool: Pool = getPostgresPool()) {}

  prepare(query: string): D1PreparedStatement {
    return new PostgresPreparedStatement(this.pool, postgresParameters(query));
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results: D1Result[] = [];
      for (const statement of statements) {
        if (!(statement instanceof PostgresPreparedStatement))
          throw new Error('PostgreSQL batch requires PostgreSQL statements');
        results.push(await statement.execute(client));
      }
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

class PostgresPreparedStatement implements D1PreparedStatement {
  private params: unknown[] = [];

  constructor(private pool: Pool, private query: string) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  async first<T = QueryResultRow>(colName?: string): Promise<T | null> {
    const result = await this.pool.query(this.query, this.params);
    const row = result.rows[0];
    if (!row) return null;
    return colName ? row[colName] ?? null : row;
  }

  async run<T = QueryResultRow>(): Promise<D1Result<T>> {
    return this.execute<T>(this.pool);
  }

  async all<T = QueryResultRow>(): Promise<D1Result<T>> {
    return this.execute<T>(this.pool);
  }

  async execute<T = QueryResultRow>(
    client: Pool | PoolClient
  ): Promise<D1Result<T>> {
    // Fail visibly instead of reporting success after a database error.
    const result = await client.query(this.query, this.params);
    return {
      success: true,
      results: result.rows,
      meta: { changes: result.rowCount || 0 },
    };
  }
}
