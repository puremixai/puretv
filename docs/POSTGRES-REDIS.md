# PostgreSQL + Redis 本地部署

本地完整部署使用 Next.js + PostgreSQL 17 + Redis 7。PostgreSQL 保存账号、会话、配置及历史、订阅、收藏和播放进度；Redis 缓存视频源搜索结果，缓存丢失可重新生成。其他已有存储适配器仍可用于旧部署。

## 配置

三个本地环境文件均被 Git 和 Docker 构建上下文排除。数据库和 Redis 只连接 Docker 内部网络，不发布宿主机端口。

- `.env.postgres.local`：从 `.env.postgres.example` 复制，设置 `POSTGRES_PASSWORD`。
- `.env.redis.local`：从 `.env.redis.example` 复制，设置独立的 `REDIS_PASSWORD`。
- `.env.docker.local`：保留原有应用密码、认证密钥及其他配置，增加以下配置，密码分别与前两个文件一致。

```dotenv
POSTGRES_URL=postgresql://puretv:POSTGRES_PASSWORD@postgres:5432/puretv
POSTGRES_POOL_MAX=10
CACHE_REDIS_URL=redis://:REDIS_PASSWORD@redis:6379/0
CACHE_KEY_PREFIX=puretv:cache
```

示例中的密码是占位符。可运行 `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` 分别生成两个随机密码。自行选择包含特殊字符的密码时，需要对 URL 中的密码进行百分号编码。`compose.local.yaml` 显式设置 `NEXT_PUBLIC_STORAGE_TYPE=postgres`，优先于环境文件。

Compose 项目名为 `puretv-local`，应用服务名为 `puretv`，镜像名为 `puretv:local`；物理数据卷使用 `puretv-local_` 前缀，缓存前缀为 `puretv:cache`。

新安装且没有旧数据时：

```powershell
docker compose -f compose.local.yaml up -d --build
docker compose -f compose.local.yaml ps
Invoke-RestMethod http://localhost:3000/api/health
```

启动时自动执行 PostgreSQL 迁移，并在不存在时创建站长账号。迁移使用数据库锁和迁移记录，多个实例启动不会重复执行。连接池每个 Node 进程默认最多 10 个连接；扩容时应按进程数计算总连接数。

## 从当前 SQLite 迁移

以下步骤适用于 PureTV 的 SQLite 实例：数据库为 `.data/puretv.db`，卷名为 `puretv-local_database`。先准备上面的连接配置；迁移前保留 SQLite 应用镜像为 `puretv:before-postgres-redis`，将原应用环境复制为 `.env.before-postgres.local`，用于 `compose.sqlite.yaml` 回退。

```powershell
docker tag puretv:local puretv:before-postgres-redis
# 此复制必须在修改应用连接配置之前执行。
Copy-Item -LiteralPath .env.docker.local -Destination .env.before-postgres.local
docker compose -f compose.local.yaml up -d postgres redis
docker build -t puretv:postgres-redis-candidate .
```

正式导入之前，在独立测试数据库演练。正式迁移时停止应用以冻结写入，再使用 SQLite backup API 生成唯一备份；不要直接复制运行中的数据库主文件而忽略 WAL。备份副本转换为 `journal_mode=DELETE`，以便随后在只读卷中独立打开；原 SQLite 数据库的 WAL 模式保持不变。

```powershell
docker compose -f compose.local.yaml stop puretv
# 将 UNIQUE 替换成此次操作的唯一时间戳，避免覆盖历史备份。
docker run --rm --network none --user 1001:1001 -v puretv-local_database:/app/.data puretv:before-postgres-redis node -e "const D=require('better-sqlite3');const p='/app/.data/puretv-before-postgres-UNIQUE.db';if(require('fs').existsSync(p))throw new Error('Backup already exists');const d=new D('/app/.data/puretv.db');d.backup(p).then(()=>{d.close();const b=new D(p);b.pragma('journal_mode=DELETE');b.close()}).catch(()=>process.exit(1))"
docker run --rm --network puretv-local_default --env-file .env.docker.local --user 1001:1001 -v puretv-local_database:/app/.data:ro puretv:postgres-redis-candidate node scripts/migrate-sqlite-to-postgres.cjs /app/.data/puretv-before-postgres-UNIQUE.db
# 应用启动前再次核对，启动后会话与定时任务可能产生合法数据变化。
docker run --rm --network puretv-local_default --env-file .env.docker.local --user 1001:1001 -v puretv-local_database:/app/.data:ro puretv:postgres-redis-candidate node scripts/migrate-sqlite-to-postgres.cjs /app/.data/puretv-before-postgres-UNIQUE.db --verify-only
docker tag puretv:postgres-redis-candidate puretv:local
docker compose -f compose.local.yaml up -d --no-build
```

导入要求 PostgreSQL 业务表为空：不会清空或覆盖已有数据。脚本检查 SQLite 完整性，按外键顺序导入，并逐表比对行数和全部原始字段的摘要，校正自增序列。导入和核验共用一个事务，任一表不匹配就回滚。SQL 迁移记录由 PostgreSQL 自己生成，不复制 SQLite 的记录。

## 缓存及可用性

搜索结果按源地址、源名称、代理模式、关键词和页码区分。成功结果缓存 10 分钟，超时或拒绝访问缓存 30 秒；Redis key 不含原始 URL 和关键词。Redis 限制为 128 MB，采用 `allkeys-lru` 淘汰，不开启磁盘持久化。

Redis 连接或命令失败时会降级到进程内缓存；该缓存最多 1000 项、8 MiB，每项不超过 1 MiB。连接与命令分别限制 500 毫秒，失败后冷却 5 秒。Redis 恢复后后续请求自动重连。缓存不承担账号、鉴权和业务数据持久化。

`GET /api/health` 由 Docker 自定义服务器提供：数据库正常时返回 200；Redis 故障返回 200 和 `degraded`；数据库故障返回 503。该接口不返回连接地址或密码。普通 Next/边缘托管环境不使用此自定义服务器探针。

## 备份与回退

- PostgreSQL 数据卷：`puretv-local_postgres`。使用 `pg_dump` 做定期业务备份；不要把 Redis 当作业务备份。
- PureTV SQLite 卷：`puretv-local_database`，切换 PostgreSQL 后保留；离线下载使用 `puretv-local_downloads` 卷。
- `docker compose -f compose.local.yaml down` 保留数据；不要加 `-v`。

导出 PostgreSQL 备份时，在容器内创建二进制文件，再 `docker cp`，避免旧版 PowerShell 的输出重定向损坏二进制归档：

```powershell
docker compose -f compose.local.yaml exec postgres pg_dump -U puretv -d puretv -Fc -f /tmp/puretv-backup.dump
docker compose -f compose.local.yaml cp postgres:/tmp/puretv-backup.dump ./puretv-backup.dump
```

上面的复制路径仅用于演示。备份包含用户资料与会话，应存到项目以外受保护的位置，不要提交到 Git。

迁移刚完成且尚未产生新数据时，可以停止新应用并启动原 SQLite 版本：

```powershell
docker compose -f compose.local.yaml stop puretv
docker compose -f compose.sqlite.yaml up -d --no-build
```

**SQLite 保留的是切换时的数据，不会接收切换后的 PostgreSQL 写入。** 已经继续使用一段时间后，不能依赖上述命令无损回退数据；应先备份 PostgreSQL，再设计反向迁移。旧版 UI 文档中的镜像回退命令仅适用于当时的 SQLite 部署。

## 验证

```powershell
pnpm typecheck
pnpm test:postgres-redis
```

第二条命令创建独立的 PostgreSQL/Redis 测试容器，执行全部 Jest 测试并清理其容器及卷。覆盖实际迁移、密码和会话保留、播放进度精度、自增序列、事务回滚、配置并发与历史恢复、共享缓存及数据库/缓存失效。不会使用正式数据库。

生产镜像另可运行 `node scripts/smoke-local.cjs --production --postgres`，需要显式配置 `PG_SMOKE_URL` 指向空的临时测试库。它会启动临时应用、创建测试站长并验证登录、媒体令牌、Socket、TV 注册和会话撤销；不得指向正式库。

## 2026-09-13 本机切换记录

- 已部署镜像 `29398d5a00df`，应用访问地址为 <http://localhost:3000>，PostgreSQL 和 Redis 健康检查通过。
- 正式导入前停止 SQLite 应用，对当时的 23 张业务表执行导入和独立复核，全部一致。保留 2 个订阅和 34 个视频源，订阅 ID/URL、视频源 key/API 与备份一致。用户在演练至切换之间的写入以正式停机备份为准。
- SQLite 切换备份：数据卷内 `/app/.data/moontv-before-postgres-20260913-final.db`；原 SQLite 数据及旧镜像 `moontvplus:before-postgres-redis` 均保留。
- PostgreSQL 切换后备份：宿主机 `D:\bbs\moontv-after-postgres-20260913.dump`，`pg_restore --list` 已验证归档可读取。
- 19 个测试套件、129 项测试通过，TypeScript 检查及生产构建通过。生产镜像验证了登录、HttpOnly Cookie、媒体令牌、Socket/TV、设备撤销；正式切换前创建的会话在切换后验证了继续访问、刷新和退出。
- 迁移演练中的真实搜索返回 331 条结果，Redis 中生成 32 个搜索分页缓存条目。该记录用于确认实际接入，未作为负载测试或吞吐量承诺。
- 演练应用及两个临时测试数据库已清理；正式 PostgreSQL、Redis 和原 SQLite 卷保留。
