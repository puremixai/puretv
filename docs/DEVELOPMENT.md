# 开发指南

[返回项目首页](../README.md) · [Docker 部署](DOCKER.md) · [配置参考](CONFIGURATION.md)

## 开发环境

使用 Node.js 24 与 pnpm 10.14.0。项目依赖以 [pnpm-lock.yaml](../pnpm-lock.yaml) 为准，安装时保留锁文件。

```sh
pnpm install --frozen-lockfile
```

将 [.env.example](../.env.example) 复制为 `.env.local`，设置 `ADMIN_USERNAME`、`PASSWORD` 和独立的 `AUTH_SECRET`。该模板使用本地 SQLite；启动时自动初始化数据库，数据默认位于 `.data/puretv.db`。`ADMIN_USERNAME` 会映射为应用的 `USERNAME`，避免 Windows 系统同名环境变量影响站长账号。

```sh
pnpm dev
```

默认地址为 [http://localhost:3000](http://localhost:3000)。若 Docker 或其他服务已占用端口，可在 `.env.local` 中设置其他 `PORT`，并同步调整 `SITE_BASE`。

Docker 部署使用 `.env.docker.local`、`.env.postgres.local`、`.env.redis.local`；本地开发使用 `.env.local`，两种环境分别配置。不要将真实环境文件、数据库或认证信息提交到仓库。

## 目录结构

| 路径               | 用途                                         |
| ------------------ | -------------------------------------------- |
| `src/app/`         | App Router 页面、API 路由与全局样式          |
| `src/components/`  | 共享界面、播放器和业务组件                   |
| `src/lib/`         | 数据访问、认证和业务逻辑                     |
| `src/styles/`      | 共享样式与 Tailwind 配置                     |
| `server/`          | 自定义服务器使用的数据库、缓存与实时通信模块 |
| `services/go-worker/` | 独立 Go 服务端，离线下载与 OpenList 目录列举 |
| `scripts/`         | 数据初始化、迁移、构建与验证脚本             |
| `tests/`           | 单元测试与集成测试                           |
| `apps/android-tv/` | Android TV 客户端工程                        |
| `docs/`            | 部署、配置、开发及升级文档                   |

## 质量检查

在独立终端运行检查：

```sh
pnpm typecheck
pnpm lint
pnpm test --runInBand
```

`pnpm check` 顺序执行以上三项。`pnpm lint` 按 [.eslint-baseline.json](../.eslint-baseline.json) 中的“文件 + 规则”检查存量警告：任一组增加即失败，新文件默认零警告。`pnpm lint:report` 输出完整警告；修复问题后可显式执行 `pnpm lint:baseline` 收紧基线，并审查基线差异，不应通过增加基线绕过检查。

`src/lib/` 和 `src/app/api/` 的日志统一使用 `logger`。这两个目录的裸 `console` 会导致检查失败，即使添加 `eslint-disable no-console` 也不能绕过。只有日志实现本身和保留原样的第三方 `pancheck/vendor/` 例外。诊断信息使用 `logger.debug`，警告和错误保留对应等级，输出遵循日志级别及脱敏策略。

测试使用 Jest 30 与同版本 `jest-environment-jsdom`，通过 `next/jest` 编译；CI 与 Docker 都使用 Node.js 24。需要验证 PostgreSQL 和 Redis 集成时，先启动 Docker，再执行：

```sh
pnpm test:postgres-redis
```

该命令创建独立的 PostgreSQL / Redis 测试容器，PostgreSQL 测试库名为 `puretvtest`。执行全量 Jest 测试后清理测试资源，不使用正式数据库。

API 新增或改动时同步维护 [访问策略清单](API-ACCESS-POLICY.md)，分类测试会检查实际 Next matcher 和匿名访问边界。改动 SQL 仓储时运行 SQLite、libSQL 与 PostgreSQL 的共享契约测试，确保用户隔离、版本冲突与回滚行为一致。

生产构建与认证、Socket 冒烟检查：

```sh
pnpm build
pnpm test:smoke:production
```

验证时根据实际修改范围选择检查项。仅修改文档时，检查链接、示例语法和配置一致性即可。

Go 服务端使用独立模块 `github.com/puremixai/puretv/services/go-worker`，不是默认 Node 构建的依赖。修改该模块时，在 `services/go-worker` 中运行 `go test ./...` 与 `go vet ./...`；Linux 还应执行 `go test -race ./...`。改动 Node/Go 协议时运行真实进程联调，命令见 [Go 服务端测试说明](../services/go-worker/README.md#内部接口与检查)。独立 CI 同时检查 Linux 和 Windows，保留跨平台任务文件锁与 API 回归。

## 构建方式

默认开发和生产构建使用 Webpack。Turbopack 入口为：

```sh
pnpm dev:turbo
```

```sh
pnpm build:turbo
```

这两个 Turbopack 命令使用 `PURETV_BUNDLER=turbopack` 选择构建器；自定义开发或构建脚本也应使用 `PURETV_BUNDLER`，默认开发和生产命令仍使用 Webpack。

不要同时执行两个生产构建，它们共享 `.next` 输出目录。生产构建完成后，可使用 `pnpm start` 启动服务；先停止占用同一端口的开发服务。

PWA 资源由独立 Workbox 脚本生成。版本升级与前端实现细节见 [Next.js 16 升级说明](NEXT16-UPGRADE.md)、[Tailwind 4 升级说明](TAILWIND4-UPGRADE.md) 和 [海报动效说明](CINEMATIC-HERO.md)。

## 版本维护

PureTV 目前处于 `0.x` 开发周期，使用独立的语义化版本序列，版本格式与排序遵循 [SemVer 2.0.0](https://semver.org/)。当前版本为 `0.1.0-alpha.1`，表示 `0.1.0` 阶段的首个早期测试版本；功能、配置和数据结构仍可能调整，兼容性变化会在更新记录中说明。

| 版本形式                  | 用途                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `0.1.0-alpha.N`           | 早期测试，功能仍在开发；同一阶段的 `N` 从 `1` 开始递增                   |
| `0.1.0-beta.N`            | 功能基本完整，集中进行兼容性测试与问题修复                               |
| `0.1.0-rc.N`              | 发布候选，验证阶段发布前的剩余问题                                       |
| `0.1.0`                   | 该阶段功能与验证完成后的阶段版本，仍属于开发周期                         |
| `0.2.0-alpha.1` → `0.2.0` | 下一阶段的开发与交付，后续按相同方式推进                                 |
| `1.0.0`                   | 稳定版本里程碑，需完成核心功能验证、部署与升级迁移验证，并明确兼容性约定 |

同一目标版本按开发与验证进度推进，例如 `0.1.0-alpha.1` → `0.1.0-alpha.2` → `0.1.0-beta.1` → `0.1.0-rc.1` → `0.1.0`；每个测试阶段的数字后缀独立递增。已发布的版本号不复用。`0.x` 阶段的破坏性变更需明确记录，不应仅从版本号推断兼容性。

源码版本不带 `v` 前缀，例如 `0.1.0-alpha.1`；创建 Git 发布标签时使用 `v0.1.0-alpha.1`。版本名称体现实际测试阶段，不提前将仍在开发的功能标为发布候选。

[VERSION.txt](../VERSION.txt) 是源码版本的基准。更新该文件与 [CHANGELOG](../CHANGELOG)，手动保持 `package.json` 中的版本号一致，再生成界面使用的更新记录和版本文件。`CHANGELOG` 的首行必须为 `# PureTV`：

```sh
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
```

第一条命令生成 `src/lib/changelog.ts`，第二条从 `VERSION.txt` 生成 `src/lib/version.ts`。执行后检查生成文件与源码版本一致，并将它们一并提交。Android TV 默认读取同一版本文件，独立 APK 的 `VERSION_NAME` 与递增 `VERSION_CODE` 规则见 [Android TV 构建参数](../apps/android-tv/README.md#构建参数)。

继承的上游更新记录位于 [CHANGELOG-UPSTREAM.md](CHANGELOG-UPSTREAM.md)，与 PureTV 的发布记录分别维护。历史升级和部署记录保留执行当时的版本标记，不代表当前实例已经切换到新的源码版本。

## 品牌资源

PureTV 使用环形播放标志：青蓝渐变的环在右侧断开，与向右的播放三角负空间连通。各端图标使用统一轮廓、青蓝渐变和深海军蓝背景。

| 资源            | 文件                                                                       | 用途                   |
| --------------- | -------------------------------------------------------------------------- | ---------------------- |
| Logo            | [public/logo.png](../public/logo.png)                                      | 项目首页、客户端菜单   |
| 浏览器图标      | [public/favicon.ico](../public/favicon.ico)                                | 浏览器标签页与收藏     |
| PWA 图标        | [public/icons/](../public/icons/)                                          | 安装入口、通知与主屏幕 |
| Android TV 图标 | [drawable/logo.png](../apps/android-tv/app/src/main/res/drawable/logo.png) | TV 启动器与应用入口    |

PWA 名称与图标引用由 [generate-manifest.js](../scripts/generate-manifest.js) 生成，开发和构建命令会自动执行，也可单独运行 `pnpm gen:manifest`。替换资源后需重新构建部署；Android TV 的 GitHub Actions 构建会复制根目录 Logo，本地构建需自行同步对应文件。

默认站点名称为 `PureTV`。`NEXT_PUBLIC_SITE_NAME` 可设置初始名称；数据库中的站点设置以管理后台保存值为准。Compose 项目名为 `puretv-local`，应用服务名为 `puretv`，数据卷使用 `puretv-local_` 前缀，数据库与客户端协议统一使用 PureTV 标识。Android TV 基础应用 ID 为 `com.puretv.tv`，Go 服务端环境变量使用 `PURETV_GO_*`。

首页横幅开关使用 `puretv_home_banner` Cookie；调试浏览器偏好时应检查当前命名空间。
