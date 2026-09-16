# PureTV Go Worker

PureTV 的可选 Go 服务端，承接文件读取、外部数据请求和后台任务执行。原有 Next.js API 继续承担用户鉴权、权限判断和业务入口，前端及 Android TV 使用原来的地址与协议。默认部署不启动此服务，各 Node 适配开关默认关闭。

## 实现边界

| 模块           | Go 负责                                                      | Node 继续负责                                      |
| -------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| 服务器离线下载 | 任务管理、HLS 获取、分片并发、重试、删除取消、任务文件持久化 | 原 `/api/offline-download` 鉴权与转发、下载页面    |
| 本地文件播放   | `os.Root` 路径隔离、文件流、Range/HEAD、HLS 清单 URL 重写    | 两种原本地播放入口、管理员鉴权、响应转发           |
| 直播与 EPG     | 媒体类型探测、有界解压、XMLTV 解析与频道匹配                 | 直播源权限、缓存、播放模式与频道列表管理           |
| 网盘检查       | 九个平台检测协议、持久任务、所有者隔离、并发、取消           | 原 start/task/cancel 入口及用户权限                |
| OpenList       | 登录、根目录分页列举、文件控制请求、401 刷新                 | 名称解析、TMDB 匹配、元数据合并与数据库保存        |
| CMS 搜索       | 标准 CMS 请求、分页校验、播放列表解析、请求限制与取消        | 源权限、HTML 清理、过滤排序、缓存、JS 源、SSE 聚合 |
| 配置订阅       | 限时、有界的外部内容拉取                                     | JSON/Base58 校验、重试、合并与配置保存             |
| 追番下载提交   | OpenList 原生提交、持久幂等收据、重复与不确定状态处理        | 资源筛选、集数进度保存与通知                       |
| 弹幕和元数据   | XML 弹幕解析、TMDB/Bangumi HTTP 请求                         | 功能权限、密钥轮换、镜像配置、缓存与结果展示       |
| 后台任务控制   | 持久租约、冷却、进度记录、过期状态、旧执行者隔离             | Cron 触发、扫描/追番业务编排、配置和通知提交       |

下载沿用 `tasks.json` 和 `source/videoId/epN/` 文件布局。已完成文件可以通过原 `/api/offline-download/local` 接口播放；启动时将旧 `pending` / `downloading` 任务标为 `paused`，通过原有“重试”操作继续。普通视频和 IPTV 的播放请求仍按原配置由浏览器访问来源。

支持原实现能够完整保存的单层 HLS master、TS 分片和单把 AES-128 密钥，保留 IV、标签及签名查询参数。fMP4/MAP、BYTERANGE、独立音轨、多层 master、不同密钥轮换和低延迟 HLS 会返回明确的任务错误。Go 不新增转码、直播录制、浏览器下载或自动代理回退。

OpenList 仍按现有影库模型枚举根目录下的文件夹，不改成递归导入整个网盘。启用 `PURETV_GO_TASKS` 后，扫描状态在 Go 中持久保存：Node 重启后可以查询已有进度；执行者失联两分钟后标记失败，由用户重新发起刷新。此机制不自动恢复 Node 的解析调用栈，也不自动重放下载或通知。

`PURETV_GO_LOCAL_FILES` 仅改变服务端文件读取实现。响应仍经过 Next.js，因此不代表 Node 带宽已卸载；普通视频和 IPTV 继续由浏览器按现有规则直连。若需要绕过 Node 传输本地文件，应另外配置反向代理路由和相应的用户鉴权，不能把内部服务令牌发给浏览器。

## 本地运行

使用 Go 1.25 或更高版本，模块仅依赖标准库。Docker 默认使用 Go 1.27 构建。Go 不自动加载 `.env.local`，需要向进程传入环境变量。

在项目根目录的 PowerShell 中启动仅扫描服务：

```powershell
$env:PURETV_GO_TOKEN = 'REPLACE_WITH_AN_INDEPENDENT_RANDOM_TOKEN'
$env:PURETV_GO_LISTEN_ADDR = '127.0.0.1:8081'
$env:PURETV_GO_OFFLINE_DOWNLOADS = 'false'
# 仅在 OpenList 部署于受信任内网时填写其精确 origin。
$env:PURETV_GO_ALLOWED_ORIGINS = '["http://127.0.0.1:5244"]'
Set-Location services/go-worker
go run ./cmd/puretv-worker
```

将占位令牌换为至少 32 字符、不含空白的独立随机值。Node 的 `.env.local` 配置相同令牌并重启应用：

```dotenv
PURETV_GO_URL=http://127.0.0.1:8081
PURETV_GO_TOKEN=REPLACE_WITH_AN_INDEPENDENT_RANDOM_TOKEN
PURETV_GO_OPENLIST_SCAN=true
PURETV_GO_OFFLINE_DOWNLOADS=false
```

仅扫描模式不会打开下载目录。迁移下载时，先停止原 Node 及已有 Go 进程，备份下载目录，再在 **Node 和 Go 两端**设置 `PURETV_GO_OFFLINE_DOWNLOADS=true`，并为两者配置相同绝对路径 `OFFLINE_DOWNLOAD_DIR`。启动 Go 后重新启动 Node。原 `NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD=true` 与管理员权限仍是下载 API 的前提。

## Docker Compose

使用仓库根目录的可选 [compose.go-worker.yaml](../../compose.go-worker.yaml)，与现有 [compose.local.yaml](../../compose.local.yaml) 组合。该覆盖文件默认仅切换扫描；下载需显式启用。Go 只加入 Compose 内部网络，不发布主机端口，与 Node 共享 `downloads` 数据卷。

Compose 项目名为 `puretv-local`，应用服务名为 `puretv`，下载卷为 `puretv-local_downloads`，worker 状态卷为 `puretv-local_go-worker-state`。使用 `--env-file .env.go-worker.local -f compose.local.yaml -f compose.go-worker.yaml`，使 Node 与 Go 两端读取相同的适配配置。配置使用 PureTV 资源名称，不会自动迁移已有数据卷；部署步骤见 [Docker 部署指南](../../docs/DOCKER.md)。

按 [Docker 部署指南](../../docs/DOCKER.md) 准备原有三个环境文件。另建未跟踪的 `.env.go-worker.local`，供 Compose 插值读取：

```dotenv
PURETV_GO_TOKEN=REPLACE_WITH_AN_INDEPENDENT_RANDOM_TOKEN
PURETV_GO_OPENLIST_SCAN=true
PURETV_GO_OFFLINE_DOWNLOADS=false
# 内网 OpenList 示例；公网来源通常无需此项。
PURETV_GO_ALLOWED_ORIGINS=["http://openlist:5244"]
```

OpenList 主机须能从 Go 容器访问；容器内的 `127.0.0.1` 指向 Go 容器自身。此文件通过 `--env-file` 读取，只在 `.env.docker.local` 填写这些值不会覆盖 Compose 的同名 `environment`。若原部署配置了 `PUID` / `PGID`，在此文件填写相同值，使两个服务都能访问原下载卷。

```sh
docker compose --env-file .env.go-worker.local -f compose.local.yaml -f compose.go-worker.yaml build puretv puretv-go
docker compose --env-file .env.go-worker.local -f compose.local.yaml -f compose.go-worker.yaml up -d --no-build --wait
```

切换下载引擎前，应完成或停止当前下载并备份下载卷。将覆盖环境文件的 `PURETV_GO_OFFLINE_DOWNLOADS` 改为 `true` 后，先停止旧 Node 和 Go，再启动两者，避免启动先后顺序造成双写：

```sh
docker compose --env-file .env.go-worker.local -f compose.local.yaml -f compose.go-worker.yaml stop puretv puretv-go
docker compose --env-file .env.go-worker.local -f compose.local.yaml -f compose.go-worker.yaml up -d --no-build --wait
```

Go 使用文件锁阻止两个 Go 下载进程同时操作同一任务库。**旧 Node 下载器不识别此锁，因此切换时必须停止旧进程；不要对同一个下载卷运行多个下载实例。** 此服务暂不支持下载任务的多副本调度。

回退某个模块时，先按上面的 `stop` 命令停掉两者，在覆盖环境文件中将对应的 `PURETV_GO_*` 模块开关改为 `false`，再 `up` 重建环境。完全移除 Go 时，停止 Go 后只用原 `compose.local.yaml` 重建 Node，并确保 `.env.docker.local` 中所有 Go 模块开关均已关闭。保留下载卷、`tasks.json` 和 Go 状态卷中的任务及下载收据，不要使用 `down -v`；切换前先核对未完成或结果不确定的写任务，避免另一引擎重复提交。

## 配置

| 变量                            | 位置及默认值         | 说明                                                               |
| ------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `PURETV_GO_URL`                 | Node，未设置         | Go 的 HTTP(S) origin，不带路径、查询或凭证                         |
| `PURETV_GO_TOKEN`               | 两端，必填           | 相同的独立服务令牌，至少 32 字符且无空白                           |
| `PURETV_GO_OFFLINE_DOWNLOADS`   | 两端，`false`        | 仅精确值 `true` 启用；Go 关闭时不打开任务库                        |
| `PURETV_GO_OPENLIST_SCAN`       | Node，`false`        | 根目录列举和 OpenListClient 文件控制请求；覆盖 Compose 默认 `true` |
| `PURETV_GO_LOCAL_FILES`         | 两端，`false`        | 原本地下载播放接口使用 Go 读取文件，与下载引擎开关独立             |
| `PURETV_GO_LIVE`                | Node，`false`        | 直播预检、EPG 下载及解析                                           |
| `PURETV_GO_NETDISK_CHECK`       | 两端，`false`        | 网盘检查任务，需持久状态目录                                       |
| `PURETV_GO_SEARCH`              | Node，`false`        | 指定源查询和综合搜索中的标准 CMS 源                                |
| `PURETV_GO_SUBSCRIPTIONS`       | Node，`false`        | 配置订阅外部拉取                                                   |
| `PURETV_GO_ANIME_DOWNLOADS`     | 两端，`false`        | 追番下载原生提交及持久收据，独立于配置订阅开关                     |
| `PURETV_GO_DANMAKU`             | Node，`false`        | 弹幕 XML 获取及解析                                                |
| `PURETV_GO_METADATA`            | Node，`false`        | TMDB/Bangumi 元数据 HTTP 执行                                      |
| `PURETV_GO_TASKS`               | 两端，`false`        | Cron/OpenList 持久任务租约与进度                                   |
| `PURETV_GO_STATE_DIR`           | Go，`.data/worker`   | 与下载目录分离；Compose `/state` 使用独立 `go-worker-state` 卷     |
| `PURETV_GO_LISTEN_ADDR`         | Go，`127.0.0.1:8081` | 容器为 `0.0.0.0:8081`                                              |
| `OFFLINE_DOWNLOAD_DIR`          | 两端                 | Go 默认工作目录下 `.data/downloads`，容器两端统一 `/data`          |
| `PURETV_GO_ALLOWED_ORIGINS`     | Go，`[]`             | 允许访问的受信任内网 origin JSON 数组，包含协议和端口              |
| `OFFLINE_DOWNLOAD_PROXY`        | Go，空               | 仅下载使用的显式 HTTP(S) CONNECT 代理；不作用于 OpenList           |
| `PURETV_GO_MAX_DOWNLOADS`       | Go，`2`              | 下载任务并发，1–16                                                 |
| `PURETV_GO_SEGMENT_CONCURRENCY` | Go，`6`              | 每个任务的分片并发，1–16                                           |
| `PURETV_GO_SCAN_CONCURRENCY`    | Go，`4`              | 一次扫描内的根目录并发，1–16                                       |

Go 默认只请求公网 HTTP(S) 来源，每次重定向重新校验 DNS 并固定连接 IP。内网放行必须配置完整 origin；元数据、链路本地、未指定及组播地址始终拒绝。Go 不读取通用 `HTTP_PROXY` / `HTTPS_PROXY`；下载代理必须支持数值 IP 的 CONNECT（包括 HTTP 目标），不支持时任务明确失败，不自动改为直连。详情见 [出站策略](internal/outbound/README.md)。

TMDB 的显式 HTTP(S) 代理配置可以传给 Go，目标仍受安全出站策略约束。Go 不接受 Fake-IP 地址；依赖本地 Fake-IP DNS 或透明代理的部署，需配置真实 DNS/兼容代理，或保持对应模块的 Go 开关关闭。不会在失败后偷偷使用 Node 网络请求。

状态卷必须持久保留，且由运行 worker 的 UID/GID 可写。任务库使用独占锁；不要让多个 worker 同时写同一状态目录。网盘任务按原返回契约保存链接和检测结果（链接可能含提取码），不会持久化上游临时 token/cookie。任务与扫描进度有保留期限，状态卷不用于保存管理员密码。

Compose 中的 `puretv-go-state-init` 在 worker 启动前初始化状态卷所有权，使用相同的 `PUID` / `PGID`，支持已有的非 1001 用户部署。它只挂载 `/state`，完成后退出；不挂载数据库或下载卷。变更运行 UID/GID 时先停止应用和 worker，再重建服务。

任务租约属于协作控制：执行者会在配置、进度、通知提交前检查租约，Cron 会等待邮件完成后结束。它不提供跨 Node、Go、数据库和上游下载器的原子事务。如果数据库提交成功后进程在登记完成前崩溃，任务可能显示失败，但数据已经更新；核对状态后再发起操作。

媒体执行共用 4 个并发槽，元数据响应上限 8 MiB、EPG/弹幕原始及解压后内容各不超过 32 MiB、配置订阅不超过 256 KiB。媒体 JSON 编码后上限 64 MiB。CMS 及 OpenList 控制响应上限 8 MiB；这些控制接口开始输出后有 10 秒写期限，慢读客户端不会永久占用并发槽。本地视频文件按流读取，不使用此控制响应期限。

管理请求体上限 1 MiB，Node 读取超时 15 秒，Go 下载 API 读写超时 10 秒，Node 委派超时 30 秒。播放列表读取 10 秒，分片和密钥各 30 秒；任务总时长不设固定截止，但可删除取消或关停。

下载任务 JSON 库上限为 32 MiB（不包含视频文件），接纳任务时会预留进度、状态和错误字段增长空间。容量不足返回 507，可通过原管理界面删除旧任务后重试。超限或损坏的旧任务库会阻止 Go 下载模块启动，原文件保持原样，应先在旧 Node 模式整理并备份后再切换。

Go 同时只接受一次 OpenList 目录扫描，忙时立即返回 429；原扫描任务会显示失败，不排队或自动重试。单次最多 64 个根目录、每根 1000 页、每页 100 项，聚合文件夹 JSON 上限 16 MiB，任务上限 5 分钟。超限或请求失败时丢弃该根目录的部分结果，其他成功根目录仍按原 Node 逻辑处理和保存；全部根目录失败才终止本次扫描。

启用 Go 后，连接失败或超时会通过原接口报告错误，**不会自动重试写操作或回退到 Node**；超时的任务可能已被接受，应先刷新任务列表确认状态。

## 追番收据与人工核对

`PURETV_GO_ANIME_DOWNLOADS` 将 OpenList 登录和下载提交交给 Go；ACG 搜索、关键词筛选、集数选择及通知业务仍由 Node 执行。每集成功提交后先以配置版本检查保存进度，再发送通知。重复成功收据只修复进度，不再次下载或通知。

Go 在发送下载请求前持久保存收据。已成功的相同请求可安全重复查询；网络断开、超时、错误响应等结果不确定时，返回收据 ID 并禁止自动重发。收据保存哈希与状态，不保存 OpenList 密码或完整下载参数，不自动过期；上限 50,000 条 / 16 MiB，达到上限会明确拒绝新提交。

管理员核对 OpenList 队列后，可以从内部网络调用需要服务令牌的 `POST /v1/anime/receipts/resolve`：

```json
{
  "receiptId": "错误信息中的64位收据ID",
  "action": "confirm-succeeded"
}
```

确认上游已接纳时用 `confirm-succeeded`；确认未接纳且允许重新提交时用 `allow-retry`，随后从原追番检查入口重试。正在执行的收据不能处理，成功收据不能清除；未知 ID 返回 404。该接口不会自动执行下载，不应把 worker 端口或服务令牌提供给浏览器。

## 内部接口与检查

| 接口                                                              | 用途                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET /healthz`、`GET /readyz`                                     | 进程就绪检查，无敏感状态，不需要令牌                         |
| `GET/POST/PUT/DELETE /v1/offline-download`                        | 原下载管理协议，需 `Authorization: Bearer <PURETV_GO_TOKEN>` |
| `POST /v1/openlist/roots`                                         | 内部目录列举协议，同上                                       |
| `GET/HEAD /v1/local-files`                                        | 本地文件读取及清单重写                                       |
| `POST /v1/openlist/operations`                                    | 有限的 OpenList 文件控制操作，不是任意 URL 代理              |
| `POST /v1/live/precheck`、`/v1/live/epg`、`/v1/live/epg/download` | 直播控制请求与 EPG                                           |
| `/v1/netdisk/check/start`、`/task`、`/cancel`                     | 网盘任务创建、查询、取消；用户身份由 Node 注入               |
| `POST /v1/cms`                                                    | 标准 CMS 操作                                                |
| `POST /v1/subscriptions/fetch`                                    | 配置订阅读取                                                 |
| `POST /v1/anime/download`                                         | 追番提交与幂等收据                                           |
| `POST /v1/danmaku/comment`、`/v1/metadata/fetch`                  | 弹幕及元数据执行                                             |
| `POST /v1/jobs`                                                   | 内部任务申请、续租、进度查询和完成；租约不返回浏览器         |

健康检查代表进程已初始化，不承诺外部 OpenList 或视频来源可用。除健康检查外，所有内部接口在处理前校验令牌；用户身份和功能权限仍由 Node 验证。不要把 worker 端口直接发布给浏览器或用于替代公开 API 的用户鉴权。

```sh
cd services/go-worker
go test ./... -count=1
go vet ./...
go build -o bin/puretv-worker.exe ./cmd/puretv-worker
```

在项目根目录的 PowerShell 中执行真实 Node → Go → 本地测试源联调：

```powershell
$env:PURETV_GO_TEST_BINARY = (Resolve-Path services/go-worker/bin/puretv-worker.exe).Path
pnpm exec jest --testPathPatterns="go-" --runInBand
```

联调只使用临时目录和本地 HTTP 测试源，验证原下载/播放 API、Range、OpenList、CMS、媒体及订阅请求、任务和收据重启保留。未设置测试二进制时，普通 `pnpm check` 跳过真实进程测试；桥接单元测试仍照常执行。Linux CI 额外执行竞态及 FIFO 检测；本地没有 CGO/C 编译器时可使用隔离的 Docker 测试阶段：

```sh
docker build --target test -t puretv-go-worker-test:local services/go-worker
```
