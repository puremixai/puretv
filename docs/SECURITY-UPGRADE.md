# 安全与维护升级说明

后续 Alpha 加固已补齐图片与旧直播代理的鉴权、出站限制和 API 路由策略测试。当前访问规则及受信任内网来源配置见 [API 访问策略](API-ACCESS-POLICY.md)。下文保留早期安全升级的背景与迁移说明。

本轮基于 `e3d15dcf33518467e1a35936d410740c72e196b2`，分支 `fix/security-and-maintenance`。部署前备份数据库和环境配置。

## 登录与会话

- 会话版本升级到 v2，签名覆盖身份、角色、时间和设备凭据。旧 Cookie 需要重新登录，不执行批量用户密码重置。
- `auth` 为 HttpOnly Cookie；前端从 `auth_info` 读取用户名等非敏感资料。HTTPS 请求会设置 Secure。反向代理应正确传递协议头。
- 推荐设置独立随机 `AUTH_SECRET`；为空时兼容使用 `PASSWORD`。更换签名密钥会使已有会话失效。站长密码仍从环境变量读取，不写进 Cookie。
- 浏览器登录响应只返回公开资料；没有浏览器 Fetch Metadata 的原生客户端仍可取得 Bearer token。原生客户端应从登录响应保存 token，不从 `auth_info` 构造凭据。
- 数据库模式下，使用统一身份入口的 API 和内置 Socket 校验持久化设备会话，并重新读取封禁、角色信息。撤销后的 Socket 在下一次发包时断开；客户端通过 HttpOnly 刷新接口重新连接，已撤销会话无法刷新。
- `localstorage` 模式没有共享设备会话表，只适合兼容使用；跨进程设备撤销需要数据库模式。页面外壳的中间件只校验签名，具体数据接口执行持久化校验。
- 新密码使用随机盐、600000 次 PBKDF2-SHA256；已有 SHA-256 密码在正确登录后升级。Redis 旧配置用户迁移成功后删除旧明文密码；旧密码缺失时使用随机值，需管理员重置。此实现的工作因子参考 [OWASP 密码存储说明](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。

## 媒体代理

- 通用 M3U8、VOD、视频和 CMS 代理拒绝匿名请求。浏览器通过会话 Cookie 使用代理；外部播放器使用 `/api/proxy-token` 签发的媒体专用令牌，最长 6 小时，且受原设备会话撤销约束。
- TVBox 订阅令牌可用于生成的媒体代理链接。需要固定共享令牌时设置服务端 `PROXY_M3U8_TOKEN`；旧 `NEXT_PUBLIC_PROXY_M3U8_TOKEN` 不再授予代理权限。更新收藏的外部播放链接。
- Node 代理每次跳转重新校验目标，拒绝非公网地址，并把通过校验的 DNS 结果绑定到实际连接；不向上游转发站点 Cookie 或 Authorization。播放列表有大小限制。
- 内网媒体服务应使用对应的 OpenList、Emby 等专用配置入口；通用代理不作为内网访问入口。
- Cloudflare / EdgeOne 无法使用 Node 的 DNS Agent，通用代理改用明确的 `MEDIA_PROXY_ALLOWED_HOSTS` 主机名单，例如 `media.example.com,cdn.example.com`。跳转后的域名也必须列入。此名单要求运营者信任这些上游及其 DNS，不等同于 Node 的 DNS 绑定保证。

## 脚本和定时任务

- `ALLOW_SERVER_SCRIPTS` 默认关闭。只有环境变量指定的站长可以编辑/测试服务端视频源脚本；启用前应审查脚本来源。这些脚本使用真实服务器权限，并非沙箱。
- 自定义服务端去广告代码同样受该开关控制。普通管理员不能修改服务端去广告代码或浏览器分析脚本。Edge 平台不启用服务端脚本执行。
- 定时任务不再使用默认 `mtvpls` 密码。设置 `CRON_SECRET` 后，调度器调用 `/api/cron/run` 并传 `Authorization: Bearer <secret>`。
- `CRON_PASSWORD` 和显式路径密码作为旧部署兼容入口保留，无默认值；建议迁移到 Header。Vercel 配置路径已同步更新，需在平台配置 `CRON_SECRET`。Cron 请求不再记录含路径密码的完整 URL。

## Windows 本地开发

要求 Node.js 22 或更新的兼容版本、pnpm 10.14.0。本轮本机验证环境为 Node.js 24.18.0 / Windows。

```powershell
Copy-Item .env.example .env.local
# 在 .env.local 填写 ADMIN_USERNAME、随机 PASSWORD 和 AUTH_SECRET
pnpm install --frozen-lockfile
pnpm dev
```

Node 启动支持 `ADMIN_USERNAME`，用它覆盖旧变量 `USERNAME`，避免 Windows 系统自带 USERNAME 抢占配置；云平台仍按原有方式设置 `USERNAME`。开发产物放在 `.next-dev`，生产产物放在 `.next`；Windows 使用项目本身运行生产服务，standalone 打包在 Linux/Docker 完成。

默认示例使用 `NEXT_PUBLIC_STORAGE_TYPE=d1`，在 Node 下对应项目 `.data/puretv.db` 的 SQLite；服务器会在读取环境文件后自动初始化。Cloudflare 的同名选项对应平台 D1 绑定。Turso/Postgres/Redis 等后端需要各自连接配置。

```powershell
pnpm check
pnpm build
pnpm start
```

本地完整链路可通过 `pnpm test:smoke` 验证；构建后使用 `pnpm test:smoke:production` 验证生产服务。脚本使用随机端口和凭据，在 `.data/smoke-*` 保存临时测试库与服务日志，结束后停止测试服务。

`db:reset` 会删除数据库，只允许项目实际 `.data` 目录内的 `.db` 文件及其 WAL/SHM；拒绝外部路径和目录链接。运行前需自行备份。此命令也会读取环境文件。

## 部署边界与验证范围

- Docker 完整版使用自定义 Node 服务器，包含内置 Socket、TV 遥控。Lite 和无常驻 Node 的平台不提供同等内置 Socket 能力；观影室需要配置外部服务器。
- 房间、设备路由等仍依赖进程内状态。完整交互按单实例部署，本次没有加入共享 Socket Adapter、多实例房间存储或负载均衡粘性会话。
- 当前 Next.js 16 的构建命令不执行 ESLint；类型、lint 和测试通过 `pnpm check` 与 CI 执行。CI 在 Linux 构建，并在 Windows 验证基础检查。历史 warnings 通过按文件和规则的基线限制增长；第三方 `pancheck/vendor/checkers` 保留原有 `@ts-nocheck`，通过仅针对该目录的规则例外说明。
- 仓库含多种第三方视频、网盘、邮件、OIDC、Telegram 和云数据库集成。本轮本地验证不代表这些外部服务已逐一连通，也没有向云平台部署。
- README 许可名称已与当前 LICENSE 文件内容对齐；LICENSE 原文保持不变。
