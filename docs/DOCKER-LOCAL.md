# 本地 Docker 运行

当前本地部署已切换为 **PostgreSQL + Redis**，配置、迁移、备份与回退步骤见 [PostgreSQL + Redis 部署说明](POSTGRES-REDIS.md)。下方带日期的 SQLite 升级记录属于历史操作，不能用于当前部署的数据回退。

Compose 配置使用项目名 `puretv-local`、服务名 `puretv` 和镜像名 `puretv:local`，数据卷统一使用 `puretv-local_` 前缀。日常操作与回退请使用[部署指南](DOCKER.md)。

## 2026-09-13 Tailwind 4 与海报动效更新

- 部署代码为 `upgrade/tailwind4` 分支的 `3f6995b`，已推送至 `origin`。当前镜像为 `moontvplus:local`，同时保留标签 `moontvplus:tailwind4-hero-3f6995b`，镜像 ID `8d00157feaf0`；镜像的 `org.opencontainers.image.revision` 标签记录完整代码提交号。
- Tailwind CSS 4.3.3 已部署，运行时为 Next.js 16.3.5、React 19.3.0、Node.js 24.21.0。首页和详情新增海报缓慢缩放、环境色背景及滚动视差，并支持暂停与减少动态效果偏好。详见 [Tailwind 4 升级说明](TAILWIND4-UPGRADE.md) 和 [海报动效实现说明](CINEMATIC-HERO.md)。
- 使用 `--no-build --no-deps --wait` 仅替换应用容器，PostgreSQL 和 Redis 的容器 ID 均未改变，原有数据卷保留。三个容器健康，`/api/health` 返回应用、数据库及缓存均正常，访问地址为 <http://localhost:3000>。
- 实际部署后验证原登录会话继续访问与刷新、新登录和退出、首页/搜索/登录/管理页 SSR、匿名 API 拦截、媒体鉴权、Socket.IO 连接，以及 PWA 公共资源。首页 HTML 已包含新海报与轮播进度标记，匿名 CSS 请求返回 Tailwind 4.3.3 和海报动画样式；验证用会话均已注销。
- 升级前后保留 2 个用户、3 条播放记录、2 个订阅及 34 个视频源，收藏与搜索记录数量也一致；订阅 ID/URL 和视频源 key/API 的摘要相同。
- 提交前 PostgreSQL/Redis 全量测试 57 套、543 项全部通过。新镜像独立启动、登录、样式资源和注销验证通过后，再更新本地实例。
- 升级前 PostgreSQL 备份为 `D:\bbs\xtv-before-tailwind4-hero-20260913-144808.dump`，大小 78398 字节，已用 `pg_restore --list` 验证归档可读取。备份存于仓库外，未提交。
- 升级前应用镜像保留为 `moontvplus:before-tailwind4-hero-20260913-144808`，镜像 ID `f65af2033f32`。本次部署的检查日志位于本机被 Git 忽略的 `.data/hero-deploy/`。

需要回退本次应用更新时，继续使用当前 PostgreSQL 数据，只替换应用容器：

```powershell
docker tag moontvplus:before-tailwind4-hero-20260913-144808 moontvplus:local
docker compose -f compose.local.yaml up -d --no-build --no-deps --wait --wait-timeout 90 moontvplus
docker compose -f compose.local.yaml ps
```

已有浏览器页面可按 Ctrl+F5 刷新样式。此次网页部署不包含 Android TV APK 构建或安装。

## 2026-09-13 Next.js 16 更新

- 该次更新应用镜像：`moontvplus:local`，镜像 ID `f65af2033f32`；Next.js 16.3.5、React 19.3.0、Node.js 24.21.0。
- 仅重建并替换 `moontvplus` 应用容器。PostgreSQL、Redis 及原有数据卷保留；三个容器健康，`/api/health` 返回应用、数据库和缓存均正常。
- 核对保留 2 个订阅、34 个视频源、2 个用户、3 条播放记录，订阅 ID/URL 与视频源 key/API 的升级前后摘要一致。
- 验证已有登录会话继续访问与刷新、新登录和退出、首页/搜索/管理页 SSR、匿名 API 拦截、媒体鉴权、PWA 公共资源及 Socket.IO 连接。独立 PostgreSQL / Redis 测试环境中的 53 套、478 项测试全部通过。
- 升级前 PostgreSQL 备份：`D:\bbs\xtv-before-next16-20260913-211434.dump`，已用 `pg_restore --list` 验证归档可读取。备份包含业务数据，存于仓库外，未提交。
- 升级前应用镜像：`moontvplus:before-next16-20260913-211434`，镜像 ID `0430f77a3d34`，使用相同 PostgreSQL 存储；保留用于应用版本回退。

需要回退本次应用升级时，使用保存的 PostgreSQL 版本镜像，只替换应用容器，继续使用当前数据库：

```powershell
docker tag moontvplus:before-next16-20260913-211434 moontvplus:local
docker compose -f compose.local.yaml up -d --no-build --no-deps moontvplus
docker compose -f compose.local.yaml ps
```

完整升级说明见 [Next.js 16 升级与前端优化](NEXT16-UPGRADE.md)。

## 日常运行

从克隆后的 `puretv` 项目根目录执行，使用当前工作区源码构建完整版。

```powershell
docker compose -f compose.local.yaml up -d --build
docker compose -f compose.local.yaml ps
docker compose -f compose.local.yaml logs --tail 100 -f
```

访问地址：<http://localhost:3000>，仅绑定本机回环地址。

管理员用户名为 `admin`。随机生成的密码保存在项目 `.env.docker.local` 的 `PASSWORD` 项中；该文件已被 Git 和 Docker 构建上下文排除。站长密码由环境变量决定，需要修改时编辑该文件，然后执行 `docker compose -f compose.local.yaml up -d` 重新创建容器。

PureTV 业务数据使用 PostgreSQL，存储在 `puretv-local_postgres` 卷；Redis 使用 `puretv:cache` 前缀缓存搜索结果。SQLite 目录使用 `puretv-local_database` 卷，离线下载存储在 `puretv-local_downloads` 卷。TV 遥控和内置观影室已启用，服务端自定义脚本默认关闭。

停止并保留数据：

```powershell
docker compose -f compose.local.yaml down
```

再次启动：

```powershell
docker compose -f compose.local.yaml up -d
```

不要给 `down` 添加 `-v`，除非确实需要删除数据库和下载卷。

## 本次启动验证

2026-09-13 使用本地源码构建并启动 `moontvplus:local`，容器为 `moontvplus-local-moontvplus-1`，健康检查通过。

- Linux 容器内 Node.js 24.21.0、Next.js 14.2.35、better-sqlite3 12.6.2；SQLite 的 12 个迁移完成。
- 应用进程使用 UID 1001 运行。
- 登录页、管理员登录、HttpOnly Cookie、持久化会话、媒体令牌、匿名代理拦截、Socket 连接及 TV 注册均验证通过，验证用登录会话已退出。
- 两个持久化卷已挂载，服务设置为 `unless-stopped` 自动重启。

## 2026-09-13 优化版更新

已更新为镜像 `e1a639757b53`，健康检查和真实站长登录通过。升级前现有的 2 个订阅、34 个视频源、1 个用户均保留，订阅 ID/URL 和源 key/API 与备份逐项一致。

旧镜像保留为 `moontvplus:before-optimization`。SQLite 在线备份在数据库卷内的 `/app/.data/moontv-before-optimization-20260913.db`，备份与升级后数据库均通过完整性检查。

只回退应用镜像、保留当前数据：

```powershell
docker tag moontvplus:before-optimization moontvplus:local
docker compose -f compose.local.yaml up -d --no-build
```

该命令不恢复历史数据库；独立数据恢复应先停止服务并另行保留当前数据库。日常配置回滚可在站长后台“配置文件 → 配置历史”操作。

本轮性能指标、权限和配置版本变化详见 [第二轮优化记录](OPTIMIZATION-ROUND-2.md)。更新后请刷新已有后台页面。

## 2026-09-13 管理工作台更新

当前运行镜像为 `6f060f5471cc`，健康检查通过。原有 2 个订阅、34 个视频源、1 个用户保留。新版采用分类导航、功能搜索和单栏目布局，主题与个人设置入口已移到观影侧栏底部，详见 [管理工作台说明](ADMIN-UI.md)。侧栏调整前的镜像单独保留为 `moontvplus:before-sidebar-controls`。

本次升级前的镜像是 `moontvplus:before-admin-ui`，数据库在线备份为 `/app/.data/moontv-before-admin-ui-20260913.db`。只回退本次界面更新可执行：

```powershell
docker tag moontvplus:before-admin-ui moontvplus:local
docker compose -f compose.local.yaml up -d --no-build
```

数据库不会随镜像回退。新版管理入口为 <http://localhost:3000/admin>，已有页面请 Ctrl+F5 刷新。

## 关闭弹幕获取

当前 `compose.local.yaml` 配置了 `DANMAKU_ENABLED: "false"`，停止弹幕搜索、匹配、下载和自动预加载。此开关优先于浏览器中的旧偏好；旧页面仍调用接口时，服务器直接返回空结果，不请求上游弹幕服务。更新后刷新播放页生效。

如需恢复，把该环境变量改为 `"true"`，再运行 `docker compose -f compose.local.yaml up -d --no-build`。

2026-09-13 已部署镜像 `84e4b2f29011`，保留更新前镜像 `moontvplus:before-disable-danmaku`。181 项测试、类型检查和生产构建通过；部署后验证了搜索、匹配、剧集列表、按集数与视频 URL 获取弹幕的五种请求均返回关闭状态和空结果，浏览器运行时开关为关闭。AI 评论接口及 PostgreSQL、Redis 健康检查正常。
