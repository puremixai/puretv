# Docker 部署

[返回项目首页](../README.md) · [配置参考](CONFIGURATION.md) · [数据库迁移与备份](POSTGRES-REDIS.md)

## 部署方式

使用本仓库的 [Dockerfile](../Dockerfile) 和 [compose.local.yaml](../compose.local.yaml) 构建并运行 PureTV。默认部署包含应用、PostgreSQL 17 和 Redis 7：PostgreSQL 保存账号、会话、配置、收藏和播放记录，Redis 提供可重新生成的搜索缓存。

服务器已有 Nginx 容器时，可使用[服务器部署配置](SERVER-DEPLOYMENT.md)接入现有代理网络，并为 PureTV 创建独立数据卷。

## 1. 获取源码

准备 Git、Docker 和 Docker Compose v2；Windows 可使用 Docker Desktop 的 Linux 容器模式。Node.js 和 pnpm 由 Docker 构建阶段提供，无需在宿主机另行安装。

```powershell
git clone --branch main https://github.com/puremixai/puretv.git
cd puretv
```

已有本仓库工作目录时，直接进入该目录。后续命令均在项目根目录执行。

## 2. 配置环境文件

首次安装时，复制数据库和缓存模板。以下示例使用 PowerShell；Linux / macOS 可用 `cp` 完成同样的复制操作：

```powershell
Copy-Item .env.postgres.example .env.postgres.local
Copy-Item .env.redis.example .env.redis.local
```

编辑 `.env.postgres.local`，保留模板中的数据库名与用户名，替换密码：

```dotenv
POSTGRES_USER=puretv
POSTGRES_DB=puretv
POSTGRES_PASSWORD=REPLACE_WITH_POSTGRES_PASSWORD
```

编辑 `.env.redis.local`，设置独立的缓存密码：

```dotenv
REDIS_PASSWORD=REPLACE_WITH_REDIS_PASSWORD
```

在项目根目录新建 UTF-8 格式的 `.env.docker.local`：

```dotenv
ADMIN_USERNAME=admin
PASSWORD=REPLACE_WITH_ADMIN_PASSWORD
AUTH_SECRET=REPLACE_WITH_RANDOM_AUTH_SECRET
NEXT_PUBLIC_SITE_NAME=PureTV
SITE_BASE=http://localhost:3000
POSTGRES_URL=postgresql://puretv:REPLACE_WITH_POSTGRES_PASSWORD@postgres:5432/puretv
POSTGRES_POOL_MAX=10
CACHE_REDIS_URL=redis://:REPLACE_WITH_REDIS_PASSWORD@redis:6379/0
CACHE_KEY_PREFIX=puretv:cache
```

将所有 `REPLACE_WITH_...` 替换为自己的值：站长密码、数据库密码、缓存密码和认证密钥分别设置；两个连接 URL 中的密码须与对应服务文件一致。数据库和缓存密码可使用随机十六进制字符串，其他特殊字符需在 URL 中进行百分号编码。

`AUTH_SECRET` 用于签名认证信息，升级时应保留原值，修改会使现有会话失效。三个 `.env.*.local` 文件均被 Git 和 Docker 构建上下文排除。数据库初始化环境变量仅用于创建新数据库；已有数据卷的密码不会随环境文件自动修改。已有实例请保留现有配置，不要重新复制模板覆盖密码。

Compose 已指定 `NEXT_PUBLIC_STORAGE_TYPE=postgres`，并设置容器内的监听地址、端口及数据目录，无需在环境文件重复配置。定时更新任务按需配置独立的 `CRON_SECRET`；留空时不启用调度。

## 3. 构建与启动

首次安装使用下面的命令：

```powershell
docker compose -f compose.local.yaml up -d --build --wait
docker compose -f compose.local.yaml ps
Invoke-RestMethod http://localhost:3000/api/health
```

启动时自动初始化 PostgreSQL 表结构，并创建尚不存在的站长账号。三个服务应显示 `healthy`，健康接口的 `status`、`database` 和 `cache` 均为 `ok`。访问 <http://localhost:3000>，使用 `.env.docker.local` 中的站长账号与密码登录，然后在管理后台配置视频源或订阅。

默认只向本机开放 `127.0.0.1:3000`，PostgreSQL 和 Redis 不发布宿主机端口。电视或其他设备访问时，将 Compose 的应用端口映射调整为宿主机的局域网地址（例如 `192.168.1.10:3000:3000`），并将 `SITE_BASE` 改为对应的访问地址；具体入口见 [Android TV 使用](../apps/android-tv/README.md)。

该 Compose 默认开启 TV 模式和内置观影室，关闭弹幕获取和服务端自定义脚本。这些选项由 `compose.local.yaml` 的 `environment` 设置，调整后重新创建应用容器生效。

## 4. 数据与日常管理

| 数据            | Docker 卷                    | 用途                                              |
| --------------- | ---------------------------- | ------------------------------------------------- |
| PostgreSQL      | `puretv-local_postgres`  | 账号、会话、配置、收藏及播放记录                  |
| 离线下载        | `puretv-local_downloads` | 服务器下载的视频文件                              |
| SQLite 数据目录 | `puretv-local_database`  | PureTV SQLite 数据；默认业务存储使用 PostgreSQL |

Compose 项目名为 `puretv-local`，应用服务名为 `puretv`，本地镜像名为 `puretv:local`，默认应用容器名为 `puretv-local-puretv-1`。PostgreSQL、SQLite 和离线下载卷使用上表中的物理卷名，Redis 缓存前缀为 `puretv:cache`。新卷为空时会初始化新实例。

物理卷名独立于 Compose 项目名。若需要多个隔离实例，应为各实例单独覆盖卷的 `name`，仅使用 `-p` 不会再隔离这些数据卷。

查看应用日志，或停止并保留数据：

```powershell
docker compose -f compose.local.yaml logs --tail 100 -f puretv
docker compose -f compose.local.yaml down
```

`logs -f` 持续输出，按 Ctrl+C 退出后再执行其他命令。`down` 不要加 `-v`，该选项会删除数据卷。容器默认以 `1001:1001` 运行，挂载宿主机目录时可通过 `PUID` / `PGID` 调整权限。

已有 SQLite 实例应先按 [PostgreSQL + Redis 部署说明](POSTGRES-REDIS.md) 备份并迁移数据。日常数据库备份也见该文档，应用镜像回退步骤见下方。

## 更新应用

本节适用于已部署的 PureTV 实例。

完整镜像和 Lite 镜像均内置健康检查，通过 `scripts/healthcheck.cjs` 请求容器内配置端口的 `/api/health`。完整镜像由自定义服务提供该入口，Lite 的 Next 独立服务由 API 路由提供，二者复用同一状态判断。Compose 使用同一探针；PostgreSQL 不可用时检查失败，Redis 缓存暂时不可用仍按服务的降级策略保持就绪。其他存储模式目前只检查 HTTP 服务就绪，不探测各自的数据库。直接使用 `docker run` 时也会显示健康状态。

PureTV 的更新检查使用 `puremixai/puretv` 仓库，更新日志首行必须为 `# PureTV`。若要调整实例的显示站名，请设置环境文件中的 `NEXT_PUBLIC_SITE_NAME` 和管理后台保存的站点名称，后台已有设置优先。

从当前仓库获取更新后重新构建本地应用镜像。更新前按 [PostgreSQL + Redis 部署说明](POSTGRES-REDIS.md) 备份数据库，并保留三个环境文件和数据卷。旧版本用户还应阅读[升级兼容说明](SECURITY-UPGRADE.md)。

先为当前镜像添加唯一的回退标签，记录命令输出的标签名。以下为 PowerShell 示例：

```powershell
$rollbackTag = "puretv:backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
docker tag puretv:local $rollbackTag
Write-Output $rollbackTag
```

然后更新源码并构建、替换应用：

```powershell
git switch main
git pull --ff-only origin main
docker compose -f compose.local.yaml build puretv
docker compose -f compose.local.yaml up -d --no-build --no-deps --wait puretv
docker compose -f compose.local.yaml ps
Invoke-RestMethod http://localhost:3000/api/health
```

上述命令适用于 PostgreSQL 和 Redis 已运行的实例，只替换应用容器；若所有服务已停止，请使用首次部署中的完整 `up` 命令。若此次更新也调整了 PostgreSQL、Redis 或 Compose 配置，按对应升级说明操作。更新后已有浏览器页面可按 Ctrl+F5 刷新。

启用 Go 服务端时，构建和启动命令需带上 `--env-file .env.go-worker.local -f compose.local.yaml -f compose.go-worker.yaml`，构建 `puretv puretv-go` 两个服务，并按 [Go 服务端说明](../services/go-worker/README.md#docker-compose)配置两端下载开关及共享下载卷。

## 回退应用

将示例中的 `puretv:backup-YYYYMMDD-HHmmss` 替换为更新前保存的实际标签：

```powershell
docker tag puretv:backup-YYYYMMDD-HHmmss puretv:local
docker compose -f compose.local.yaml up -d --no-build --no-deps --wait puretv
docker compose -f compose.local.yaml ps
Invoke-RestMethod http://localhost:3000/api/health
```

该操作只切换应用镜像，不恢复数据库。涉及数据库结构变更时，先确认旧版本兼容当前数据库，再按相应迁移文档处理。
