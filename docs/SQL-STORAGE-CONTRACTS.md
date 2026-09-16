# SQL 存储契约收敛

播放记录、收藏、本地设置的 SQL 业务逻辑分别由 `src/lib/storage/sql-media.ts` 与 `src/lib/storage/sql-local-settings.ts` 维护。`D1Storage` 和 `PostgresStorage` 委托这些仓储；SQLite、Cloudflare D1、Turso 继续通过原有 `DatabaseAdapter` 接入，PostgreSQL 继续使用原有占位符转换和事务批次实现。

## 本地设置

- `expectedVersion = 0` 只允许创建；正整数只允许更新同版本的已有记录，缺记录返回 `{ ok: false, version: 0, updatedAt: 0 }`。
- 省略版本时兼容旧客户端，数据库原子递增版本。比较、写入和版本递增都发生在同一条 SQL 中，成功版本来自 `RETURNING`，不再先读后写。
- 非整数、负数和超出安全整数范围的版本会被拒绝。版本冲突可返回当前版本；数据库执行错误会抛出，不能伪装成记录不存在。
- SQLite 和 Turso 的 `first`、`all`、`run` 错误会向上传递；SQLite 批次中的任一执行失败会回滚整个事务。

## 播放记录与收藏

共同仓储保留按账号和键隔离、覆盖写入、按保存时间排序及播放记录清理阈值。数值读取统一转换为 JavaScript 数字，保留小数进度和 `new_episodes = 0`。迁移标记及用户缓存仍由各后端处理，不移入共同仓储。

`IStorage` 组合播放记录、收藏、可选本地设置及可选用户 V2 能力。用户信息、更新参数和分页结果使用统一类型，`getUserInfoV2` 明确接受 `fresh` 参数。Redis 保留自己的数据结构与实现；未在本轮抽取的音乐等领域仍保留原有契约。

## 验证

```powershell
pnpm exec jest --runTestsByPath tests/sql-storage-contracts.test.js tests/turso-storage-contracts.test.js tests/sqlite.test.js tests/config-read-failure.test.js --runInBand
pnpm test:postgres-redis --runTestsByPath tests/sql-storage-contracts.test.js tests/turso-storage-contracts.test.js tests/postgres-redis.test.js
pnpm typecheck
```

SQLite 使用真实内存数据库；Turso 适配器使用真实本地 libSQL，仅替换客户端构造以避开网络。PostgreSQL/Redis 脚本创建随机名称和凭据的临时 Docker 容器，测试结束清理。验证涵盖并发创建、更新、无版本覆盖、错误传播、事务回滚、媒体字段往返和账号隔离；未连接托管 Cloudflare D1 或远程 Turso 服务。
