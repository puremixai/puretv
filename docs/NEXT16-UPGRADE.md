# Next.js 16 升级与前端优化

实施日期：2026-09-13。该次升级沿用初始化阶段暂用的 OpenTV `1.0.0` 标记，未自动发布新版本。项目现已改用开发预览版本体系，见[版本策略](DEVELOPMENT.md#版本维护)；本记录保留当时的实施与验证事实，不表示已有部署自动更新了版本。

## 框架与运行方式

- Next.js、`@next/env`、`eslint-config-next` 固定为 16.3.5，React / React DOM 为 19.3.0，TypeScript 为 5.8，ESLint 迁移到 9 的 Flat Config。
- 使用 Node.js 24、pnpm 10.14.0。Docker 继续使用 Node 24 和自定义 Socket.IO 服务器。
- 动态 API 路由改为异步 `params`。移除 Next 已废弃的配置，保留单独执行 lint 和类型检查。
- 默认 `pnpm dev` / `pnpm build` 使用 Webpack；`pnpm dev:turbo` / `pnpm build:turbo` 显式使用 Turbopack。
- 两种构建器共用 SVG 转换和浏览器数据库模块隔离。Cloudflare、EdgeOne 使用 Webpack 适配。
- Webpack 缓存按 Node、Cloudflare、EdgeOne 分开，避免切换平台构建后，把边缘平台的数据库替代模块带入普通 Node 产物。
- Cloudflare 适配器升级为 OpenNext 1.20.6、Wrangler 4.131.1。Windows 构建包装器在最终打包前修正 `.open-next` 内复制的 pnpm junction，确保使用已经由适配器打补丁的依赖；只修改生成目录，Linux 直接调用官方构建流程。该 Windows 包装器要求 Node.js 22.15 或更新版本，推荐统一使用 Node 24。
- EdgeOne 构建通过子进程环境传参，平台外层产物生成后才校验补丁。未知生成格式会明确失败；默认本地预览执行真实 middleware，`--ssr-only` 仅用于诊断 SSR，不能作为鉴权验证。

## 用户可见变化

首页各推荐模块独立请求、缓存、显示加载与错误状态。关闭的模块不再请求，空列表也会缓存。重新配置、切换账号和离开页面后，旧响应不会覆盖新数据；令牌自动刷新不会使首页一直加载。

首页轮播优先使用服务端数据种子，冷请求最多等待 1.5 秒，再降级为客户端获取。TMDB 背景、海报和缩略图使用各自尺寸与响应式候选图；完整外部图片地址保留原代理处理。轮播的自动播放、手动切换、键盘焦点暂停、显式暂停、页面隐藏暂停和减少动画偏好继续生效，鼠标悬停不会阻止自动轮播。

详情、图片查看、预告选择、订阅与 AI 等隐藏面板按需加载。Bangumi Workers 示例脚本在打开对应设置后才请求。路由新增加载骨架、重试和返回首页的恢复入口。

下载进度最多每 200 毫秒刷新 UI、每 1000 毫秒合并持久化，终态立即处理。存储改为增量串行写入。播放页只订阅稳定的下载动作，避免被每个下载进度驱动重渲染。首次播放器启动移除固定 100 毫秒等待，MP4/原生播放不再等待无用的 HLS 导入。

## PWA 与缓存

移除依赖 Webpack 钩子的 `next-pwa`。生产构建成功后运行 `scripts/generate-pwa.cjs`，使用 Workbox 生成 `public/sw.js`，支持两种构建器。

静态代码、图片、字体保留缓存，页面导航、RSC、API 和 Next data 请求使用 NetworkOnly。更新时清理旧策略留下的私有页面与 API 缓存，保留 IndexedDB 离线视频；离线视频请求只由现有处理器接管，避免双重 `respondWith`。中间件精确放行 Service Worker 与所需公共静态路径，首次匿名安装不会把登录页面当作资源缓存。JASSUB 与设置脚本不预缓存；WASM 在首次使用后进入运行时缓存。边缘平台继续跳过 PWA 生成与注册。

## 新能力的采用边界

React Compiler 使用 `compilationMode: 'annotation'`，对 `VideoCard` 与 `CinemaShelf` 显式标注启用，以控制迁移范围。

Cache Components 保持关闭。Next 16.3 允许 `instant=false` 渐进迁移，但本项目根布局在请求边界前读取带同步时间/数据库操作的配置，并将个性化权限同步注入 `window.RUNTIME_CONFIG`。直接开启会改变预渲染与客户端配置到达时序。后续应先分开公开站点配置与用户权限，审计 GET 路由的预渲染行为，再验证 Activity 对播放器返回页面、音频和弹窗的影响。Cloudflare 当前使用 dummy incremental/tag cache，EdgeOne 也需要单独验证缓存实现。

保留现有 Edge `middleware.ts` 鉴权链路。Next 16 推荐的 `proxy.ts` 使用 Node 运行时；较新的 OpenNext 已提供实验性 Node middleware 支持，本轮不同时迁移运行时，以保持已验证的鉴权与平台适配行为。

## 验证与部署

```powershell
pnpm check
pnpm build
pnpm test:smoke
pnpm test:smoke:production
pnpm build:turbo
pnpm build:cloudflare
pnpm build:edgeone
```

| 验证项                      | 结果                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript、源码 ESLint     | 通过；现有及升级规则提示仍为 warning，不宣称零警告                                                                                                                |
| Webpack、Turbopack 生产构建 | 通过                                                                                                                                                              |
| 两种构建器的开发 / 生产冒烟 | 登录、HttpOnly、匿名媒体 API、签名 token、Socket.IO、TV 注册、撤销与断连通过                                                                                      |
| Cloudflare                  | Next 编译通过；修正 Windows 链接后，官方完整适配器打包通过并生成 Worker                                                                                           |
| EdgeOne                     | 完整构建与必需补丁校验通过；默认预览已验证匿名 API 401、页面登录跳转、公共静态资源、独立运行时账号登录及完整 SSR HTML；同时修复运行时环境优先级和本地压缩响应转换 |
| Docker                      | 独立镜像的非 root Node 24 / Next 16 / React 19、SQLite、登录与 Socket.IO / TV 冒烟通过；正式本地 PostgreSQL + Redis 应用已重新构建并替换，三个容器健康            |
| PWA 生产检查                | 镜像实际 452 个预缓存 URL 全部匿名 200 且不是登录 HTML；浏览器匿名注册激活成功，登录后私有 API / RSC 缓存条目为 0                                                 |
| 浏览器                      | 首页、自动轮播、搜索、设置按需脚本、390px 移动布局通过；生产首页未捕获 hydration 错误                                                                             |

提交前 `pnpm check` 通过；随后使用独立 PostgreSQL / Redis 测试容器运行 `pnpm test:postgres-redis`，最终单元、回归与集成测试 **53 套、478 项全部通过**，测试容器已清理。本轮没有用真实播放源做跨浏览器完整影片播放测试，播放器行为通过组件回归覆盖。路由错误恢复通过组件重试测试覆盖。

前期验证使用独立端口和临时 SQLite 数据库，验证镜像标记为 `xtv:next16-verify-20260913`。按用户要求，已于 2026-09-13 重新构建 `moontvplus:local` 并更新本地应用容器，运行 Next.js 16.3.5 / React 19.3.0，访问地址为 <http://localhost:3000>。正式 PostgreSQL / Redis 与数据卷保持原样；升级前后配置摘要一致，2 个订阅、34 个视频源、2 个用户与 3 条播放记录保留。已有会话继续访问和刷新、新登录、页面 SSR、匿名 API 拦截、媒体鉴权、PWA 公共资源及 Socket.IO 连接检查通过。备份与镜像回退信息见 [本地 Docker 运行说明](DOCKER-LOCAL.md)。

这些改动减少了明确可识别的等待、下载和重渲染工作，但没有以不同版本的旧构建产物做速度对比，也不宣称整站固定比例的性能提升。
