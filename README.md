<div align="center">
  <img src="public/logo.png" alt="PureTV Logo" width="112" height="112">
</div>

# PureTV

可自行部署的影视聚合播放器，面向桌面浏览器、移动端与 Android TV。统一管理视频源、搜索与播放、个人影库和观看记录。项目目前处于 Alpha 测试阶段，功能与配置仍在迭代，详见[版本策略](docs/DEVELOPMENT.md#版本维护)。

[快速开始](#快速开始) · [使用文档](#文档) · [更新记录](CHANGELOG) · [反馈问题](https://github.com/puremixai/puretv/issues)

![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8?logo=tailwindcss)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ed?logo=docker)
[![License](https://img.shields.io/badge/License-CC_BY--NC--SA_4.0-555)](LICENSE)

**当前版本：0.1.0-alpha.1（Alpha 测试）。** PureTV 使用独立版本序列，版本以 [VERSION.txt](VERSION.txt) 为准。项目基于 MoonTVPlus 与 MoonTV 迭代，上游来源见[致谢](#致谢)。

> PureTV 不内置视频源或直播源。首次部署后，需要由管理员配置有权访问的媒体来源或订阅。

## 核心功能

| 功能       | 说明                                                                 |
| ---------- | -------------------------------------------------------------------- |
| 搜索与发现 | 聚合多个视频源，查看影片、剧集、演员与评分信息                       |
| 视频播放   | 基于 HLS.js 与 ArtPlayer，支持外部播放器调用、弹幕和 WebGPU 视频超分 |
| 个人媒体   | 收藏、播放进度同步、私人影库接入，以及浏览器下载和服务器离线下载     |
| 多端访问   | 响应式网页、PWA、TV 页面与 Android TV 客户端                         |
| 观影室     | 多人同步播放、实时聊天与语音交流；该功能仍处于实验阶段               |
| 站点管理   | 用户与权限管理、视频源及订阅配置、配置历史与回退                     |
| 海报展示   | 首页轮播与详情海报的渐显、缓慢缩放及滚动视差，支持暂停和减少动态效果 |

服务器离线下载需单独启用，并受管理员权限限制。弹幕、视频超分和部分媒体功能依赖相应服务或浏览器能力，配置方式见[配置参考](docs/CONFIGURATION.md)。

## 快速开始

默认部署使用 **Docker Compose + PostgreSQL 17 + Redis 7**。应用镜像由本仓库源码构建；PostgreSQL 保存业务数据，Redis 用于搜索缓存。

需要 Git、Docker 与 Docker Compose v2。Windows 使用 Linux 容器模式。完整的部署、局域网访问与维护步骤见 [Docker 部署指南](docs/DOCKER.md)。

### 1. 获取源码

```sh
git clone --branch main https://github.com/puremixai/puretv.git
cd puretv
```

### 2. 配置环境

在项目根目录准备以下三个文件，均使用 UTF-8 编码：

| 文件                  | 配置方式                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `.env.postgres.local` | 复制 [.env.postgres.example](.env.postgres.example)，保留数据库名和用户名，设置 `POSTGRES_PASSWORD` |
| `.env.redis.local`    | 复制 [.env.redis.example](.env.redis.example)，设置独立的 `REDIS_PASSWORD`                          |
| `.env.docker.local`   | 新建文件，填写以下应用配置                                                                          |

```dotenv
ADMIN_USERNAME=admin
PASSWORD=REPLACE_WITH_ADMIN_PASSWORD
AUTH_SECRET=REPLACE_WITH_RANDOM_AUTH_SECRET
NEXT_PUBLIC_SITE_NAME=PureTV
SITE_BASE=http://localhost:3000
POSTGRES_URL=postgresql://puretv:REPLACE_WITH_POSTGRES_PASSWORD@postgres:5432/puretv
CACHE_REDIS_URL=redis://:REPLACE_WITH_REDIS_PASSWORD@redis:6379/0
CACHE_KEY_PREFIX=puretv:cache
```

将所有 `REPLACE_WITH_...` 替换为独立的随机值；连接地址中的数据库和缓存密码必须与对应文件一致。URL 中的特殊字符需要百分号编码，也可使用随机十六进制字符串避免转义问题。

环境文件已被 Git 和 Docker 构建上下文排除。升级已有实例时保留原有配置，尤其是 `AUTH_SECRET`，更换认证密钥会使现有会话失效。

### 3. 启动服务

```sh
docker compose -f compose.local.yaml up -d --build --wait
docker compose -f compose.local.yaml ps
```

三个服务均显示 `healthy` 后，访问 [http://localhost:3000](http://localhost:3000)，使用配置的管理员账号登录，并在后台添加视频源或订阅。可通过 [/api/health](http://localhost:3000/api/health) 查看应用、数据库和缓存状态。

默认仅监听 `127.0.0.1:3000`。从电视或其他设备访问时，需要配置可达的局域网地址或反向代理，详见[网络访问配置](docs/DOCKER.md#3-构建与启动)。

Compose 默认启用 TV 模式和内置观影室，关闭弹幕获取与服务端自定义脚本。数据使用 Docker 卷保存；停止服务时使用 `docker compose -f compose.local.yaml down`，保留数据时不要添加 `-v`。

### 更新应用

以下命令用于已部署 PureTV 的日常更新。先备份数据库、保存当前应用镜像并保留环境配置，具体步骤见[更新与回退](docs/DOCKER.md#更新应用)。

```sh
git switch main
git pull --ff-only origin main
docker compose -f compose.local.yaml build puretv
docker compose -f compose.local.yaml up -d --no-build --no-deps --wait puretv
```

上述流程适用于数据库与缓存服务已运行的 PureTV 实例。数据库迁移、备份和回退步骤见 [PostgreSQL 与 Redis 运维说明](docs/POSTGRES-REDIS.md)。Compose 项目名为 `puretv-local`，应用服务名为 `puretv`；数据卷使用 `puretv-local_` 前缀。启用 Go 服务端的部署须带上 [Go 叠加配置](services/go-worker/README.md#docker-compose)中的环境文件和 Compose 参数。

## 文档

| 文档                                      | 内容                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| [Docker 部署](docs/DOCKER.md)             | 环境准备、启动、网络访问、数据卷与应用更新                 |
| [配置参考](docs/CONFIGURATION.md)         | 视频源、环境变量、弹幕、代理、观影室及 TVBOX               |
| [数据库与缓存](docs/POSTGRES-REDIS.md)    | PostgreSQL / Redis、SQLite 迁移、备份与回退                |
| [升级兼容说明](docs/SECURITY-UPGRADE.md)  | 旧版本鉴权、媒体代理、定时任务与脚本配置调整               |
| [API 访问策略](docs/API-ACCESS-POLICY.md) | 路由鉴权分类、代理出站限制与受信任内网来源                 |
| [管理工作台](docs/ADMIN-UI.md)            | 后台功能与站点管理                                         |
| [多订阅配置](docs/MULTI-SUBSCRIPTIONS.md) | 订阅管理、来源和配置合并                                   |
| [AI 配置](docs/AI-CONFIG.md)              | AI 服务接入与相关设置                                      |
| [Android TV](apps/android-tv/README.md)   | 客户端构建、内核选择与电视端访问                           |
| [开发指南](docs/DEVELOPMENT.md)           | 本地开发、质量检查、目录结构与品牌资源维护                 |
| [Go 服务端](services/go-worker/README.md) | 可选下载、文件服务、外部数据请求与后台任务，模块开关及回退 |

## 技术栈

| 层次       | 技术                                       |
| ---------- | ------------------------------------------ |
| 前端       | Next.js 16 · React 19 · TypeScript 5.8     |
| 样式       | Tailwind CSS 4                             |
| 播放       | HLS.js · ArtPlayer                         |
| 实时通信   | Socket.IO                                  |
| 数据与缓存 | PostgreSQL 17 · Redis 7                    |
| 运行与构建 | Node.js 24 · pnpm 10.14.0 · Docker Compose |
| 质量检查   | ESLint · Prettier · Jest                   |

应用依赖版本以 [package.json](package.json) 和 [pnpm-lock.yaml](pnpm-lock.yaml) 为准，容器服务版本以 [compose.local.yaml](compose.local.yaml) 为准。

## 开发与贡献

本地开发使用 Node.js 24 和 pnpm 10.14.0。安装依赖后，将 [.env.example](.env.example) 复制为 `.env.local`，设置管理员密码和认证密钥。开发模板使用 SQLite，启动时自动初始化。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

代码检查与生产构建在另一个终端中执行；运行生产服务前需停止占用同一端口的开发服务：

```sh
pnpm check
pnpm build
pnpm start
```

问题反馈请包含版本或提交号、部署方式、复现步骤、预期行为与实际结果。提交日志前请移除密码、令牌、会话信息和私有订阅地址。

欢迎通过 [Issues](https://github.com/puremixai/puretv/issues) 报告问题或讨论改进，通过 Pull Request 提交代码和文档。涉及行为变更时，请说明兼容性影响并提供验证结果。更多验证命令见[开发指南](docs/DEVELOPMENT.md)。

## 使用约定

项目面向学习与个人非商业使用，不提供内置媒体资源或公开播放服务。请遵守以下约定：

- 配置管理员密码，关闭公网注册，不公开分享实例或将实例用于商业用途、公开服务。
- 仅接入有权访问和使用的内容，遵守所在地法律及内容提供方的使用要求。使用者对自己的配置、内容访问和传播行为负责。
- 项目不面向中国大陆地区提供服务；个人自行部署和使用的行为及责任不代表项目维护者。
- 请勿在 B 站、小红书、微信公众号、抖音、今日头条等中国大陆社交平台宣传本项目，亦未授权“科技周刊／月刊”类项目或站点收录。

## 许可证

本仓库 [LICENSE](LICENSE) 标明采用 **CC BY-NC-SA 4.0**。第三方依赖与上游组件保留各自的版权和许可声明；继承代码及各贡献部分的授权范围仍需上游维护者澄清。

## 致谢

- [MoonTVPlus](https://github.com/mtvpls/MoonTVPlus)、[MoonTV](https://github.com/MoonTechLab/LunaTV)：项目迭代基础。继承的更新记录保存在[上游历史归档](docs/CHANGELOG-UPSTREAM.md)。
- [LibreTV](https://github.com/LibreSpark/LibreTV)、[ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter)：早期设计与工程基础。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer)、[HLS.js](https://github.com/video-dev/hls.js)：网页播放能力。
- [apple-tv-hero](https://github.com/DerekCounihan/apple-tv-hero)：海报过渡与视差效果的设计参考。
- [Zwei](https://github.com/bestzwei)、[CMLiussss](https://github.com/cmliu)：媒体信息代理与图片访问方案。

感谢所有代码、文档、问题反馈与测试贡献者。
