// Copy an immutable SQLite backup into an EMPTY PostgreSQL database.
// No target rows are replaced; a mismatch rolls back the entire data import.
const Database = require('better-sqlite3');
const { createHash } = require('node:crypto');
const { getPostgresPool, closePostgresPool } = require('../server/postgres');
const { initPostgresDatabase } = require('./init-postgres');
const quote = (name) => '"' + name.replace(/"/g, '""') + '"';
const excluded = new Set(['schema_migrations']);
const hashRows = (rows, columns) =>
  createHash('sha256')
    .update(
      rows
        .map((row) =>
          JSON.stringify(columns.map((column) => row[column] ?? null))
        )
        .sort()
        .join('\n')
    )
    .digest('hex');

async function migrateSqliteToPostgres(
  sourcePath,
  { pool = getPostgresPool(), verifyOnly = false } = {}
) {
  if (!sourcePath) throw new Error('Pass the path to a SQLite backup');
  const source = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
  });
  let client;
  try {
    if (source.pragma('integrity_check', { simple: true }) !== 'ok')
      throw new Error('SQLite integrity check failed');
    source.exec('BEGIN');
    await initPostgresDatabase({ pool, seedOwner: false });
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('puretv:data-import'))"
    );
    const tables = (
      await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
      )
    ).rows
      .map((row) => row.table_name)
      .filter((name) => !excluded.has(name));
    await client.query(
      'LOCK TABLE ' + tables.map(quote).join(',') + ' IN ACCESS EXCLUSIVE MODE'
    );
    const sourceTables = source
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all()
      .map((row) => row.name)
      .filter((name) => !excluded.has(name));
    for (const name of sourceTables) {
      if (
        !tables.includes(name) &&
        source.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get().n
      )
        throw new Error(`Nonempty source table is unsupported: ${name}`);
    }
    if (!verifyOnly) {
      for (const name of tables) {
        if (
          Number(
            (await client.query(`SELECT count(*) AS n FROM ${quote(name)}`))
              .rows[0].n
          )
        )
          throw new Error(
            `Destination is not empty: ${name}. Use a new database; existing data is never overwritten.`
          );
      }
    }
    const dependencies = (
      await client.query(`
      SELECT child.relname AS child, parent.relname AS parent FROM pg_constraint c
      JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid
      JOIN pg_namespace ns ON ns.oid=child.relnamespace WHERE c.contype='f' AND ns.nspname='public'
    `)
    ).rows;
    const ordered = [];
    const pending = new Set(tables);
    while (pending.size) {
      const ready = [...pending].find((name) =>
        dependencies.every((d) => d.child !== name || !pending.has(d.parent))
      );
      if (!ready)
        throw new Error(
          'Cyclic table dependencies require an explicit migration'
        );
      ordered.push(ready);
      pending.delete(ready);
    }
    const report = [];
    for (const table of ordered) {
      if (!sourceTables.includes(table)) continue;
      const rows = source.prepare(`SELECT * FROM ${quote(table)}`).all();
      const columns = source
        .prepare(`PRAGMA table_info(${quote(table)})`)
        .all()
        .map((row) => row.name)
        .sort();
      const targetColumns = (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
          [table]
        )
      ).rows.map((row) => row.column_name);
      if (
        rows.length &&
        columns.some((column) => !targetColumns.includes(column))
      )
        throw new Error(
          `Column mismatch in ${table}; refusing to drop source data`
        );
      if (!verifyOnly) {
        for (let offset = 0; offset < rows.length; offset += 100) {
          const batch = rows.slice(offset, offset + 100);
          const values = batch.flatMap((row) =>
            columns.map((column) => row[column])
          );
          const placeholders = batch
            .map(
              (_, i) =>
                '(' +
                columns
                  .map((_, j) => '$' + (i * columns.length + j + 1))
                  .join(',') +
                ')'
            )
            .join(',');
          await client.query(
            `INSERT INTO ${quote(table)} (${columns
              .map(quote)
              .join(',')}) VALUES ${placeholders}`,
            values
          );
        }
      }
      const actual = (await client.query(`SELECT * FROM ${quote(table)}`)).rows;
      if (
        rows.length !== actual.length ||
        hashRows(rows, columns) !== hashRows(actual, columns)
      )
        throw new Error(`Row verification failed for ${table}`);
      // Explicitly inserted serial IDs must be followed by a sequence reset.
      if (!verifyOnly && columns.includes('id')) {
        const serial = (
          await client.query('SELECT pg_get_serial_sequence($1,$2) AS seq', [
            table,
            'id',
          ])
        ).rows[0].seq;
        if (serial) {
          const maximum = (
            await client.query(`SELECT MAX(id) AS value FROM ${quote(table)}`)
          ).rows[0].value;
          await client.query('SELECT setval($1::regclass,$2,$3)', [
            serial,
            maximum || 1,
            maximum !== null,
          ]);
        }
      }
      report.push({ table, rows: rows.length, verified: true });
    }
    await client.query('COMMIT');
    return report;
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    throw error;
  } finally {
    client?.release();
    source.close();
  }
}

module.exports = { migrateSqliteToPostgres };
if (require.main === module) {
  require('./load-env').loadAppEnv();
  const args = process.argv.slice(2);
  migrateSqliteToPostgres(
    args.find((arg) => !arg.startsWith('--')),
    { verifyOnly: args.includes('--verify-only') }
  )
    .then((report) =>
      console.log(JSON.stringify({ success: true, tables: report }, null, 2))
    )
    .catch((error) => {
      console.error('Migration failed:', error.code || error.message);
      process.exitCode = 1;
    })
    .finally(closePostgresPool);
}
