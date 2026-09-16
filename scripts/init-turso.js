/**
 * Turso (libSQL) 数据库初始化脚本
 *
 * 创建数据库表结构并初始化默认管理员用户
 * 复用 SQLite 迁移文件（Turso 基于 libSQL，完全兼容 SQLite 语法）
 *
 * 使用方式：
 * 1. 安装依赖：pnpm install
 * 2. 设置环境变量：
 *    export TURSO_URL=libsql://your-database.turso.io
 *    export TURSO_TOKEN=your-auth-token
 *    export USERNAME=admin
 *    export PASSWORD=your-password
 * 3. 运行：node scripts/init-turso.js
 */

const { createClient } = require('@libsql/client/http');
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./password-hash');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');
const MIGRATION_BASELINE_CUTOFF = '008_web_push_notifications.sql';

function splitSqlStatements(sql) {
  const withoutLineComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutLineComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

function isIgnorableMigrationError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    (message.includes('table') && message.includes('already exists')) ||
    (message.includes('index') && message.includes('already exists')) ||
    message.includes('duplicate column name')
  );
}

async function tableExists(client, tableName) {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [tableName],
  });
  return result.rows.length > 0;
}

async function ensureMigrationTable(client) {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.execute('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((row) => row.filename));
}

async function markMigrationApplied(client, filename) {
  await client.execute({
    sql: 'INSERT OR IGNORE INTO schema_migrations (filename, applied_at) VALUES (?, ?)',
    args: [filename, Date.now()],
  });
}

async function seedExistingMigrationBaseline(
  client,
  migrationFiles,
  hadExistingSchema
) {
  const applied = await getAppliedMigrations(client);
  if (!hadExistingSchema || applied.size > 0) return;

  for (const file of migrationFiles) {
    if (file.localeCompare(MIGRATION_BASELINE_CUTOFF) < 0) {
      await markMigrationApplied(client, file);
    }
  }
}

async function runMigrations(client) {
  const migrationFiles = getMigrationFiles();
  const hadExistingSchema = await tableExists(client, 'users');
  await ensureMigrationTable(client);
  await seedExistingMigrationBaseline(
    client,
    migrationFiles,
    hadExistingSchema
  );

  for (const file of migrationFiles) {
    const applied = await getAppliedMigrations(client);
    if (applied.has(file)) {
      console.log(`⏭️  Migration already applied: ${file}`);
      continue;
    }

    const migrationPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const statements = splitSqlStatements(sql);

    console.log(`▶️  Applying migration: ${file}`);
    for (const statement of statements) {
      try {
        await client.execute(statement);
      } catch (error) {
        if (isIgnorableMigrationError(error)) {
          console.log(`⏭️  Statement skipped in ${file}: ${error.message}`);
          continue;
        }
        throw error;
      }
    }
    await markMigrationApplied(client, file);
    console.log(`✅ Migration applied: ${file}`);
  }
}

async function ensureDefaultAdmin(client) {
  const username = process.env.USERNAME || 'admin';
  const password = process.env.PASSWORD;
  if (!password)
    throw new Error('PASSWORD must be set before creating an administrator');
  const passwordHash = hashPassword(password);

  const existingUser = await client.execute({
    sql: 'SELECT username FROM users WHERE username = ? LIMIT 1',
    args: [username],
  });

  if (existingUser.rows.length > 0) {
    console.log(`ℹ️  Admin user already exists: ${username}`);
    return;
  }

  await client.execute({
    sql: `INSERT INTO users (
      username, password_hash, role, created_at,
      playrecord_migrated, favorite_migrated, skip_migrated
    ) VALUES (?, ?, 'owner', ?, 1, 1, 1)`,
    args: [username, passwordHash, Date.now()],
  });

  console.log(`✅ Default admin user created: ${username}`);
}

async function initTursoDatabase() {
  const tursoUrl = process.env.TURSO_URL;
  const tursoToken = process.env.TURSO_TOKEN;

  if (!tursoUrl || !tursoToken) {
    console.error(
      '❌ TURSO_URL and TURSO_TOKEN environment variables must be set'
    );
    console.error('');
    console.error('Example:');
    console.error('  export TURSO_URL=libsql://your-database.turso.io');
    console.error('  export TURSO_TOKEN=your-auth-token');
    process.exit(1);
  }

  const client = createClient({
    url: tursoUrl,
    authToken: tursoToken,
  });

  console.log('📦 Initializing Turso (libSQL) database...');
  console.log('🔗 Database URL:', tursoUrl);

  try {
    await runMigrations(client);
    await ensureDefaultAdmin(client);
    console.log('');
    console.log('🎉 Turso database is ready!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Set NEXT_PUBLIC_STORAGE_TYPE=turso in your environment');
    console.log('2. Set TURSO_URL and TURSO_TOKEN environment variables');
    console.log('3. Deploy your application');
  } catch (err) {
    console.error('❌ Turso initialization failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  require('./load-env').loadAppEnv();
  initTursoDatabase();
}
