# PureTV 配置参考

本文说明视频源配置、环境变量及可选功能接入。首次安装和更新步骤见 [Docker 部署](DOCKER.md)，项目概览见 [README](../README.md)，电视客户端见 [Android TV 使用说明](../apps/android-tv/README.md)。

## 配置生效规则

当前 Docker Compose 使用 PostgreSQL 保存业务数据，使用 Redis 保存可重新生成的缓存。应用不附带播放源或直播源，首次部署后由站长在管理后台配置。

- **环境文件**：应用变量放在项目根目录的 `.env.docker.local`。数据库与缓存服务分别读取 `.env.postgres.local` 和 `.env.redis.local`，具体模板见部署文档。
- **Compose 覆盖**：`compose.local.yaml` 中 `environment` 的同名变量优先于 `env_file`。例如，开启弹幕必须修改 Compose 中的 `DANMAKU_ENABLED`，切换外部观影室必须修改 `WATCH_ROOM_SERVER_TYPE`；只修改环境文件不会覆盖这两项。
- **管理后台**：站名、公告、豆瓣代理、弹幕后端等设置会保存到数据库。对应环境变量主要用于首次初始化；已有实例应同时检查后台保存的值。Telegram 配置也会与后台配置合并，并非所有字段都由环境变量覆盖。
- **构建时配置**：部分 `NEXT_PUBLIC_*` 变量直接编入浏览器代码。例如弹幕缓存时长需要在构建环境设置，并重新构建镜像；仅修改运行时环境文件不会改变这类值。构建器开关为 `PURETV_BUNDLER`，Turbopack 入口见[开发指南](DEVELOPMENT.md#构建方式)。

以下命令用于已部署的 PureTV 实例：修改运行时环境或 Compose 后，在项目根目录重新创建应用容器。

```sh
docker compose -f compose.local.yaml up -d --no-build --no-deps --force-recreate --wait puretv
```

以上命令用于已经启动数据库和缓存的实例。启用 Go 服务端时，须保留 [Go 叠加配置](../services/go-worker/README.md#docker-compose)中的 `--env-file` 和两个 `-f` 参数。涉及构建时变量的更改，先按 [Docker 部署](DOCKER.md) 重新构建。

## 可选 Go 服务端

可选的 Go 服务端通过 `PURETV_GO_OFFLINE_DOWNLOADS` 和 `PURETV_GO_OPENLIST_SCAN` 分别启用，两者默认关闭。Node 使用 `PURETV_GO_URL` 和独立的 `PURETV_GO_TOKEN` 连接 Go，公开 API 与权限验证保持原入口。下载切换需要停止原下载进程并共享同一个下载目录；完整配置和 Compose 覆盖步骤见 [Go 服务端说明](../services/go-worker/README.md)。

## 视频源与分类

在管理后台的配置文件设置中填写 JSON。以下地址仅演示格式，不提供实际资源：

```json
{
  "cache_time": 7200,
  "api_site": {
    "example": {
      "api": "https://video.example.com/api.php/provide/vod",
      "name": "示例视频源",
      "detail": "https://video.example.com"
    }
  },
  "custom_category": [
    {
      "name": "华语",
      "type": "movie",
      "query": "华语"
    }
  ]
}
```

| 字段                | 说明                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `cache_time`        | 接口缓存时间，单位为秒，默认 `7200`。                             |
| `api_site`          | 视频源映射，支持苹果 CMS V10 的 `vod` JSON API 格式。             |
| `api_site` 下的键名 | 视频源唯一标识，例如 `example`；建议使用小写字母和数字。          |
| `api`               | 视频源 API 地址。                                                 |
| `name`              | 界面显示名称。                                                    |
| `detail`            | 可选的网页详情根地址，用于部分无法通过 API 获取完整详情的视频源。 |
| `custom_category`   | 自定义分类列表，以 `type` 与 `query` 的组合作为唯一标识。         |
| 分类的 `name`       | 可选的显示名称；省略时使用 `query`。                              |
| 分类的 `type`       | `movie`（电影）或 `tv`（电视剧）。                                |
| 分类的 `query`      | 豆瓣分类标签或搜索关键词。                                        |

常用分类标签如下；可用结果取决于数据源：

| 类型    | 标签示例                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------ |
| `movie` | 热门、最新、经典、豆瓣高分、冷门佳片、华语、欧美、韩国、日本、动作、喜剧、爱情、科幻、悬疑、恐怖、治愈 |
| `tv`    | 热门、美剧、英剧、韩剧、日剧、国产剧、港剧、日本动画、综艺、纪录片                                     |

也可填写作品名称，例如 `哈利波特`，用于关键词搜索。

首次初始化可使用 `INIT_CONFIG` 或 `CONFIG_SUBSCRIPTION_URL`。后者应填写配置订阅的普通 URL，服务端请求该地址后，对响应内容进行 Base58 解码，再解析 JSON。当前实现中，同时设置两者时，最终使用 `INIT_CONFIG`；通常只需选择一种初始化方式。已有数据库配置不会因重启而自动被这两个变量替换。

## 环境变量

下表区分程序默认值与仓库 Compose 的覆盖值。空表示未设置；标为“初始化”的设置还应遵循上面的数据库配置规则。

### 账号、站点与定时任务

| 变量                            | 说明与取值                                                                                               | 默认值                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------ |
| `ADMIN_USERNAME` / `USERNAME`   | 站长账号。Docker / Node 启动时优先将 `ADMIN_USERNAME` 映射为 `USERNAME`，避免 Windows 系统同名变量干扰。 | 必填；部署示例为 `admin` |
| `PASSWORD`                      | 站长密码。                                                                                               | 必填                     |
| `AUTH_SECRET`                   | 认证签名密钥。应独立设置并在升级时保留；修改后现有认证信息会失效。                                       | 未设置时使用 `PASSWORD`  |
| `SITE_BASE`                     | 用户访问的站点 URL，例如 `https://puretv.example.com`。                                                     | 空                       |
| `NEXT_PUBLIC_SITE_NAME`         | 站点名称；已有实例检查后台保存的名称，构建品牌资源时也使用此变量。                                       | `PureTV`                    |
| `ANNOUNCEMENT`                  | 初始化站点公告。                                                                                         | 下方默认公告             |
| `ANNOUNCEMENT_DISPLAY_MODE`     | 公告显示频率：`once`、`every`。                                                                          | `once`                   |
| `CRON_SECRET` / `CRON_PASSWORD` | 定时任务凭据，优先使用 `CRON_SECRET`，兼容旧变量 `CRON_PASSWORD`。                                       | 空；不启用调度           |
| `CRON_WAIT_FOR_COMPLETION`      | `true`：等待任务结束后返回 HTTP 200；`false`：启动任务后返回 HTTP 202。                                  | `false`                  |
| `CRON_USER_BATCH_SIZE`          | 播放记录和收藏更新任务每批处理的用户数，取正整数。                                                       | `3`                      |

默认公告：

> 本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。

### 存储、缓存与数据维护

| 变量                         | 说明与取值                                                                                                                  | 默认值                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_STORAGE_TYPE`   | 业务存储适配器：`postgres`、`redis`、`kvrocks`、`upstash`、`d1`、`turso`。当前部署使用 PostgreSQL；切换适配器需要迁移数据。 | Compose 固定为 `postgres`                    |
| `POSTGRES_URL`               | PostgreSQL 连接 URL，例如 `postgresql://user:password@postgres:5432/database`。                                             | PostgreSQL 模式必填                          |
| `POSTGRES_POOL_MAX`          | 每个 Node 进程的连接池上限，范围 `1`–`100`。                                                                                | `10`                                         |
| `CACHE_REDIS_URL`            | 独立 Redis 缓存连接 URL，例如 `redis://:password@redis:6379/0`。                                                            | 空；不启用共享缓存                           |
| `CACHE_KEY_PREFIX`           | Redis 缓存键前缀；默认值与部署示例统一使用 PureTV 命名。                                                                     | `puretv:cache` |
| `REDIS_URL`                  | Redis 业务存储连接 URL；与 `CACHE_REDIS_URL` 的用途不同。                                                                   | 空                                           |
| `KVROCKS_URL`                | Kvrocks 业务存储连接 URL。                                                                                                  | 空                                           |
| `UPSTASH_URL`                | Upstash Redis 连接 URL。                                                                                                    | 空                                           |
| `UPSTASH_TOKEN`              | Upstash Redis 访问令牌。                                                                                                    | 空                                           |
| `TURSO_URL`                  | Turso / libSQL 连接 URL。                                                                                                   | 空                                           |
| `TURSO_TOKEN`                | Turso / libSQL 访问令牌。                                                                                                   | 空                                           |
| `VIDEOINFO_CACHE_MINUTES`    | 私人影库视频信息的内存缓存时长，单位为分钟，取正整数。                                                                      | `1440`（1 天）                               |
| `MAX_PLAY_RECORDS_PER_USER`  | 每个用户的播放记录清理阈值，超过后清理旧记录。                                                                              | `100`                                        |
| `MAX_MANGA_HISTORY_PER_USER` | 每个用户的漫画阅读历史保留上限。                                                                                            | `100`                                        |
| `DATA_MIGRATION_CHUNK_SIZE`  | 数据导入、导出时的批处理大小，控制每批用户数或数据条数。                                                                    | `10`                                         |
| `INIT_CONFIG`                | 首次初始化的 JSON 字符串，支持 `api_site`、`custom_category`、`lives` 等字段。                                              | 空                                           |
| `CONFIG_SUBSCRIPTION_URL`    | 返回 Base58 编码配置内容的订阅 URL；不要将 URL 本身进行 Base58 编码。                                                       | 空                                           |

仓库仍保留 `localstorage` 兼容代码路径，但本文部署以数据库存储为前提。其他适配器的连接变量供已有实例维护使用，不代表更改一个变量即可替换当前部署。

### 搜索、元数据与媒体

| 变量                                  | 说明与取值                                                         | 默认值                          |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------------------- |
| `NEXT_PUBLIC_SEARCH_MAX_PAGE`         | 搜索接口最多拉取的页数；后台配置范围为 `1`–`50`。                  | `5`                             |
| `NEXT_PUBLIC_DOUBAN_PROXY_TYPE`       | 初始化豆瓣数据请求方式，见[代理模式](#代理模式)。                  | `cmliussss-cdn-tencent`         |
| `NEXT_PUBLIC_DOUBAN_PROXY`            | `custom` 模式使用的豆瓣数据代理 URL 前缀。                         | 空                              |
| `NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE` | 初始化豆瓣图片请求方式，见[代理模式](#代理模式)。                  | `cmliussss-cdn-tencent`         |
| `NEXT_PUBLIC_DOUBAN_IMAGE_PROXY`      | `custom` 模式使用的豆瓣图片代理 URL 前缀。                         | 空                              |
| `NEXT_PUBLIC_DISABLE_YELLOW_FILTER`   | `true` 关闭成人内容过滤，`false` 保持过滤。                        | `false`                         |
| `NEXT_PUBLIC_FLUID_SEARCH`            | 是否启用搜索接口流式输出，取 `true` / `false`。                    | `true`                          |
| `NEXT_PUBLIC_ENABLE_SOURCE_SEARCH`    | 旧文档中的源站寻片开关；当前源码未读取此变量，不应依赖它控制功能。 | 旧文档为 `true`，当前无实际作用 |
| `PROXY_M3U8_TOKEN`                    | 可选的服务端媒体共享令牌。浏览器默认使用按会话签发的短期令牌。     | 空                              |
| `TMDB_API_KEY`                        | 初始化 TMDB API 密钥。                                             | 空                              |
| `TMDB_PROXY`                          | 初始化 TMDB 请求代理地址。                                         | 空                              |
| `TMDB_REVERSE_PROXY`                  | 初始化 TMDB 反向代理地址。                                         | 空                              |
| `MAGNET_HEALTH_MAX_CONCURRENT`        | 动漫磁力测活的进程内全站并发任务上限，范围 `1`–`100`。             | `10`                            |
| `NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD` | 是否启用服务器离线下载。开启后仍仅供管理员和站长使用。             | `false`                         |
| `OFFLINE_DOWNLOAD_DIR`                | 服务器离线下载目录。                                               | `/data`；Compose 同样固定为该值 |
| `OFFLINE_DOWNLOAD_PROXY`              | 离线下载 HTTP 代理地址，例如 `http://proxy.example.com:8080`。     | 空                              |
| `ALLOW_SERVER_SCRIPTS`                | 是否允许执行服务端自定义脚本，取 `true` / `false`。                | Compose 固定为 `false`          |

### 弹幕、观影室与电视

| 变量                                       | 说明与取值                                                                                                       | 默认值                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `DANMAKU_ENABLED`                          | 是否启用全站弹幕获取。                                                                                           | 程序为 `true`；Compose 固定为 `false`                                    |
| `NEXT_PUBLIC_DANMAKU_CACHE_EXPIRE_MINUTES` | 浏览器弹幕缓存时长，单位为分钟；`0` 禁用缓存。该变量在构建时生效。                                               | `4320`（3 天）                                                           |
| `DANMAKU_API_BASE`                         | 初始化自定义弹幕 API 地址。                                                                                      | 未配置自定义变量时使用内置 API；自定义模式兜底为 `http://localhost:9321` |
| `DANMAKU_API_TOKEN`                        | 初始化弹幕 API 令牌，应与后端配置一致。                                                                          | `87654321`                                                               |
| `WATCH_ROOM_ENABLED`                       | 是否启用观影室。                                                                                                 | 程序为 `false`；Compose 固定为 `true`                                    |
| `WATCH_ROOM_SERVER_TYPE`                   | 观影室服务器类型：`internal`、`external`。                                                                       | `internal`；Compose 固定为该值                                           |
| `WATCH_ROOM_EXTERNAL_SERVER_URL`           | 外部观影室服务器地址，例如 `wss://room.example.com`。                                                            | 空；外部模式必填                                                         |
| `WATCH_ROOM_EXTERNAL_SERVER_AUTH`          | 外部观影室认证令牌。                                                                                             | 空；外部模式必填                                                         |
| `NEXT_PUBLIC_VOICE_CHAT_STRATEGY`          | 语音策略：`webrtc-fallback`、`server-only`，见[代理模式](#代理模式)。                                            | `webrtc-fallback`                                                        |
| `ENABLE_TV_MODE`                           | 是否开放 `/tv` 并启动电视遥控 Socket.IO 监听。                                                                   | `true`；Compose 固定为该值                                               |
| `QR_LOGIN_STORE_MODE`                      | 扫码登录状态存储：`auto`、`memory`、`hybrid`、`shared`。多节点部署应确认共享存储适配器可用，不能依赖单进程内存。 | `auto`；当前 PostgreSQL / Node 部署解析为 `memory`                       |
| `ENABLE_TVBOX_SUBSCRIBE`                   | 是否启用 TVBOX 订阅。                                                                                            | `false`                                                                  |
| `TVBOX_SUBSCRIBE_TOKEN`                    | TVBOX 订阅访问令牌。                                                                                             | 空；启用订阅时必填                                                       |
| `TVBOX_BLOCKED_SOURCES`                    | 订阅屏蔽源列表，以逗号分隔，匹配视频源的键名。                                                                   | 空                                                                       |

### 通知与 Telegram

| 变量                             | 说明与取值                                                                                              | 默认值                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------- |
| `WEB_PUSH_PROXY`                 | Web Push 服务端发送代理，使用 HTTP / HTTPS 代理 URL。                                                   | 空                        |
| `WEB_PUSH_BASEURL`               | Web Push endpoint 反向代理 Base URL，支持 `{endpoint}`（URL 编码）和 `{raw_endpoint}`（不编码）占位符。 | 空                        |
| `TELEGRAM_BOT_ENABLED`           | 初始化 Bot 总开关。设置为 `true`，或提供 Bot Token，均会在初始化时启用。                                | 未提供 Token 时为 `false` |
| `TELEGRAM_BOT_TOKEN`             | BotFather 生成的 Bot Token，用于登录、绑定和通知推送。                                                  | 空                        |
| `TELEGRAM_BOT_USERNAME`          | Bot 用户名，支持带或不带 `@`。                                                                          | 空                        |
| `TELEGRAM_WEBHOOK_SECRET`        | Webhook 路径及请求校验使用的随机密钥。                                                                  | 空                        |
| `TELEGRAM_API_PROXY`             | Telegram Bot API 的 HTTP / HTTPS 代理地址，供 Docker / Node 服务端请求使用。                            | 空                        |
| `TELEGRAM_API_BASE_URL`          | Telegram Bot API 反代 Base URL，用于替换官方 API 基址。                                                 | 空                        |
| `TELEGRAM_LOGIN_ENABLED`         | 是否启用 Telegram 快捷登录。                                                                            | `true`                    |
| `TELEGRAM_BINDING_ENABLED`       | 是否启用 Telegram 账号绑定。                                                                            | `true`                    |
| `TELEGRAM_REGISTRATION_ENABLED`  | 是否启用 Telegram 注册。                                                                                | `false`                   |
| `TELEGRAM_NOTIFICATIONS_ENABLED` | 是否启用 Telegram 通知推送。                                                                            | `true`                    |
| `TELEGRAM_DEFAULT_NOTIFICATIONS` | 新绑定的 Telegram 用户是否默认开启通知。                                                                | `true`                    |

## 代理模式

### IPTV 直播

在管理后台的直播源设置中按源选择播放方式，网页和 TV 页面使用相同规则：

| 模式 | 播放请求路径 |
| --- | --- |
| `direct`（默认） | 浏览器直接请求上游播放列表、视频分片和密钥，PureTV 不转发视频流。 |
| `m3u8-only` | PureTV 转发 HLS 播放列表；视频分片、初始化片段和密钥由浏览器直连。 |
| `full` | PureTV 转发 HLS 播放列表、视频分片和密钥。 |

新建、配置文件导入及未保存代理模式的旧直播源均默认直连；已经明确保存的 `full` 或 `m3u8-only` 保持原设置。FLV、MP4 等渐进式媒体沿用直连方式，上述代理选项适用于 HLS。

PureTV 登录及直播权限检查继续生效，它们不要求视频流经过服务器。频道列表、节目单和台标仍可能由 PureTV 获取；无明确格式后缀的播放地址会发起一次服务端格式预检查，读取响应头后取消响应体，不持续转发视频。客户端线路测速也遵循所选模式。

直连需要上游允许浏览器访问，包括跨域、HTTPS 页面访问 HTTP 源等浏览器限制。需要自定义 User-Agent 的上游请求可按需启用代理；后台填写的 UA 仅对服务端请求生效，不能改写浏览器直连视频请求的 UA。直连失败时不会自动切换为代理；如某个源确有需要，由管理员选择对应模式。仅代理播放列表时，分片与密钥仍需支持浏览器直连。

### 豆瓣数据

`NEXT_PUBLIC_DOUBAN_PROXY_TYPE` 支持：

| 值                      | 请求方式                                             |
| ----------------------- | ---------------------------------------------------- |
| `direct`                | PureTV 服务端直接请求豆瓣。                             |
| `cors-proxy-zwei`       | 浏览器通过 Zwei 提供的 CORS 代理请求数据。           |
| `cmliussss-cdn-tencent` | 浏览器通过 CMLiussss 提供的腾讯云 CDN 入口请求数据。 |
| `cmliussss-cdn-ali`     | 浏览器通过 CMLiussss 提供的阿里云 CDN 入口请求数据。 |
| `custom`                | 使用 `NEXT_PUBLIC_DOUBAN_PROXY` 指定的代理。         |

### 豆瓣图片

`NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE` 支持：

| 值                      | 请求方式                                           |
| ----------------------- | -------------------------------------------------- |
| `direct`                | 浏览器直接请求豆瓣返回的图片域名。                 |
| `server`                | PureTV 服务端代理请求图片。                           |
| `img3`                  | 浏览器使用豆瓣 `img3` 图片域名。                   |
| `cmliussss-cdn-tencent` | 浏览器使用 CMLiussss 提供的腾讯云 CDN 图片入口。   |
| `cmliussss-cdn-ali`     | 浏览器使用 CMLiussss 提供的阿里云 CDN 图片入口。   |
| `custom`                | 使用 `NEXT_PUBLIC_DOUBAN_IMAGE_PROXY` 指定的代理。 |

第三方代理的可用性由对应服务决定。已有实例在管理后台调整代理方式。

### 观影室语音

`NEXT_PUBLIC_VOICE_CHAT_STRATEGY` 支持：

| 值                | 行为                                                 |
| ----------------- | ---------------------------------------------------- |
| `webrtc-fallback` | 优先建立 WebRTC 点对点连接，失败时回退到服务器中转。 |
| `server-only`     | 仅使用服务器中转，适用于无法建立点对点连接的网络。   |

## 外部观影室

仓库 Compose 默认开启内置观影室。如需独立运行，可按 [watch-room-server 项目文档](https://github.com/tgs9915/watch-room-server) 准备兼容的外部服务器，然后配置 PureTV。

先在 `compose.local.yaml` 的应用服务 `environment` 中，将对应字段改为：

```yaml
WATCH_ROOM_ENABLED: 'true'
WATCH_ROOM_SERVER_TYPE: external
```

再在 `.env.docker.local` 中设置服务器地址和令牌：

```dotenv
WATCH_ROOM_EXTERNAL_SERVER_URL=wss://room.example.com
WATCH_ROOM_EXTERNAL_SERVER_AUTH=REPLACE_WITH_ROOM_AUTH_TOKEN
```

将示例值替换为外部服务的实际配置，并重新创建应用容器。外部地址需要能被参与观影的客户端访问。

## 弹幕接入

应用支持内置弹幕 API 和自定义弹幕 API，仓库 Compose 默认关闭弹幕获取。启用时，先在 `compose.local.yaml` 的应用服务 `environment` 中修改：

```yaml
DANMAKU_ENABLED: 'true'
```

重新创建应用容器后，在管理后台选择弹幕来源。使用自定义后端时，可按 [danmu_api 项目文档](https://github.com/huangxd-/danmu_api) 部署，并在后台填写 PureTV 服务端可访问的地址及令牌。首次初始化也可使用：

```dotenv
DANMAKU_API_BASE=https://danmaku.example.com
DANMAKU_API_TOKEN=REPLACE_WITH_DANMAKU_TOKEN
```

只要提供 `DANMAKU_API_BASE` 或 `DANMAKU_API_TOKEN`，首次初始化就会选择自定义来源。当前地址拼接规则为：使用默认令牌 `87654321` 时直接使用 Base URL；使用其他令牌时追加 `/<token>`。配置时应与后端路由保持一致，避免在 Base URL 中重复添加令牌。

容器内的 `localhost` 指向应用容器自身；独立后端应使用可达的服务名或主机地址。弹幕源顺序由后端管理，原后端说明中的 `SOURCE_ORDER` / `PLATFORM_ORDER` 属于后端环境变量，具体支持情况以所部署版本的文档为准。

## OpenID Connect（OIDC）登录

在管理后台的「注册配置」中添加多个 OIDC 提供商，每组分别填写名称、授权端点、Token 端点、用户信息端点、Client ID 和 Client Secret。填写 Issuer 后可使用「自动发现」填充端点。每组独立设置登录开关、注册开关、登录按钮文字和最低信任等级；信任等级仅适用于用户信息中提供 `trust_level` 的服务。

所有提供商使用同一个回调地址，将下列地址中的域名替换为 `SITE_BASE` 对应的公开站点地址，并分别加入每个提供商的应用回调白名单：

```text
https://tv.example.com/api/auth/oidc/callback
```

保存后刷新登录页即可看到所有已启用的登录入口。关闭某组的注册开关后，该组已注册用户仍可登录；关闭登录开关或删除该组后，该入口及尚未完成的登录、注册流程都会失效。删除所有提供商会关闭 OIDC 登录。

升级时，原有单组配置会自动显示为一个保留原账号绑定的提供商，无需迁移用户数据库。新提供商按配置 ID 隔离身份，即使返回相同的 `sub` 或邮箱，也不会自动合并账号。暂时停用时建议关闭开关，保留原配置 ID；删除后重新添加的提供商会获得新 ID。

已保存且连接信息完整的提供商可以修改名称、密钥、按钮文字和登录/注册策略。更换 Issuer、端点或 Client ID 时请新增提供商，避免把现有用户绑定到另一身份来源。旧平铺配置只用于兼容读取，保存后的 `SiteConfig.OIDCProviders` 列表优先生效，包括显式的空列表。升级前尚未完成的 OIDC 登录或注册需要重新发起。

## Telegram Bot

1. 通过 Telegram 的 BotFather 创建 Bot，取得 Bot Token 和用户名。
2. 在管理后台填写 Bot 配置；首次部署也可在环境文件中设置 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_BOT_USERNAME` 和 `TELEGRAM_WEBHOOK_SECRET` 后重新创建应用容器。
3. 如需代理，填写 `TELEGRAM_API_PROXY` 或 `TELEGRAM_API_BASE_URL`。
4. 在管理后台的 Telegram Bot 配置页使用“设置 Webhook”功能。Webhook 地址格式为 `https://puretv.example.com/api/telegram/webhook/<secret>`，需要能被 Telegram 服务访问。

也可在已设置对应环境变量的 PowerShell 会话中手动注册 Webhook，将示例域名替换为实际站点：

```powershell
$telegramWebhook = @{
  url = "https://puretv.example.com/api/telegram/webhook/$env:TELEGRAM_WEBHOOK_SECRET"
  secret_token = $env:TELEGRAM_WEBHOOK_SECRET
}
Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot$env:TELEGRAM_BOT_TOKEN/setWebhook" `
  -Body $telegramWebhook
```

用户登录后可在通知设置中生成绑定码，也可在注册成功页绑定。绑定后，可按站点与个人设置接收通知、使用 Telegram 确认登录。

## 视频超分

播放器使用 Anime4K 与 WebGPU 在客户端增强画面，支持 `1.5x`、`2x`、`3x`、`4x` 输出倍率。使用条件包括：

- 浏览器、GPU 和驱动能够提供 WebGPU。
- 页面运行在安全上下文中；远程或局域网访问使用 HTTPS。本机 `localhost` 通常可作为开发环境使用。
- 客户端具有足够的图形处理能力。较高倍率会增加 GPU 负载，可根据播放流畅度调整或关闭。

超分由访问设备执行，不会提高原始片源分辨率，也不会改变服务器保存的视频文件。电视壳的能力取决于所选浏览器内核和设备，见 [Android TV 使用说明](../apps/android-tv/README.md)。

## TVBOX 订阅

在 `.env.docker.local` 中设置：

```dotenv
ENABLE_TVBOX_SUBSCRIBE=true
TVBOX_SUBSCRIBE_TOKEN=REPLACE_WITH_RANDOM_SUBSCRIPTION_TOKEN
TVBOX_BLOCKED_SOURCES=source1,source2
```

`TVBOX_BLOCKED_SOURCES` 为可选项，填写配置中的视频源键名，以逗号分隔。设置独立的随机令牌并重新创建应用容器后，登录 PureTV，在用户菜单的“订阅”入口复制链接，再导入 TVBOX 客户端。订阅链接包含访问凭据，应按令牌管理。
