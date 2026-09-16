const fs = require('fs');
const path = require('path');

function resetSQLiteDatabase() {
  const dataDir = path.resolve(__dirname, '..', '.data');
  const dbPath = path.resolve(
    process.env.SQLITE_DB_PATH || path.join(dataDir, 'puretv.db')
  );
  const relative = path.relative(dataDir, dbPath);
  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    path.extname(dbPath) !== '.db'
  ) {
    throw new Error(
      "db:reset only permits a .db file inside this project's .data directory"
    );
  }
  // Resolve existing parents too, so a directory junction cannot redirect deletion outside .data.
  if (fs.existsSync(dataDir)) {
    const root = fs.realpathSync(dataDir);
    if (
      root !==
      path.join(fs.realpathSync(path.resolve(__dirname, '..')), '.data')
    )
      throw new Error('Refusing to reset a linked .data directory');
    const parent = fs.realpathSync(path.dirname(dbPath));
    const parentRelative = path.relative(root, parent);
    if (parentRelative.startsWith('..') || path.isAbsolute(parentRelative))
      throw new Error('Database directory escapes .data');
  }
  for (const suffix of ['', '-shm', '-wal']) {
    const target = dbPath + suffix;
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
      throw new Error('Refusing to reset a linked database file');
  }
  if (!process.env.PASSWORD)
    throw new Error('PASSWORD must be set before resetting SQLite');
  for (const suffix of ['', '-shm', '-wal'])
    fs.rmSync(dbPath + suffix, { force: true });
  const { initSQLiteDatabase } = require('./init-sqlite');
  initSQLiteDatabase();
}

if (require.main === module) {
  require('./load-env').loadAppEnv();
  resetSQLiteDatabase();
}
module.exports = { resetSQLiteDatabase };
