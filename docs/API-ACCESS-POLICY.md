# API 访问边界与代理出站策略

本清单对应 `tests/helpers/api-access-policy.json` 的 253 个 API 路由（包含本轮为 Lite 服务新增的健康检查入口）。该 JSON 是逐项登记的审查清单，不是根据 matcher 自动推断权限的快照。新增、删除路由必须同步审查登记；测试比较实际 `route.ts` 文件清单，未归类路由和重复归类均失败。

## 访问矩阵

| 分类               | 数量 | Cookie middleware | 实际访问条件                                                                                                                               |
| ------------------ | ---: | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| session-middleware |  211 | 执行              | 有效签名；API 不接受数据库模式下过期的 access token；进程内撤销状态也生效。管理、功能与持久会话权限由各处理器继续检查。                    |
| public-discovery   |    5 | 不执行            | 健康检查、登录前所需 server-config、主题 CSS、Telegram 配置与 QR 图像生成；不把它们当作需要 Cookie 的私有读接口。                                    |
| login-flow         |   12 | 不执行            | 登录／注册／退出，以及 OIDC、QR、Telegram 登录过程。登录可合法创建认证状态；QR status/cancel 使用 QR 会话 token；退出无登录也可清 Cookie。 |
| session-route      |    3 | 不执行            | QR confirm、Emby sources、OpenList play 在处理器验证当前用户／功能权限；不能因为 matcher 排除就认定匿名公开。                              |
| refresh-session    |    1 | 不执行            | 通过签名和持久 refresh session 刷新；过期 access token 本身不意味着禁止刷新。                                                              |
| media-token        |   11 | 不执行            | `isMediaProxyAuthorized` 验证当前会话、签名媒体 token 或服务端配置的媒体／TVBox 凭证；无 Cookie 的合法播放器有意允许。                     |
| library-token      |    7 | 不执行            | TVBox 全局／个人订阅 token；部分播放与字幕路径也允许登录会话，固定 `proxy` 字符串本身不授予匿名权限。                                      |
| cron-secret        |    1 | 不执行            | cron 处理器验证调度凭证。                                                                                                                  |
| webhook-secret     |    1 | 不执行            | Telegram webhook 处理器验证专用 secret。                                                                                                   |
| internal-worker    |    1 | 执行但精确跳过    | 仅 `/api/ai-comments/worker`；处理器验证进程内 worker secret，浏览器 Cookie 不能替代它。                                                   |

`tests/route-access-policy.test.js` 调用 Next 官方 `unstable_doesMiddlewareMatch`，使用真实编译后的 matcher 判断是否会执行 middleware；不是只直接调用 middleware 模拟路由。每个 middleware 分类的实际路径分别用 GET/POST、缺失 Cookie、无效 Cookie 和伪造签名验证 401，拒绝时不会调用下游处理器。清单不是对每个业务处理器内部权限的完整动态证明；媒体处理器另有真实鉴权／出站策略回归测试，已有 session 和 worker 测试继续覆盖其边界。

matcher 的认证例外现限定到确切端点或实际动态路径结构。类似 `/api/login-admin`、`/api/openlist/playback`、`/api/proxy/vod/unknown` 的新路径不会继承登录或播放器例外。公开播放器资源、service worker、登录页、TV 登录页等静态例外继续保留。数据库模式的过期 access token 可用于载入页面壳以便刷新，但 API 会拒绝；localstorage 模式使用其已有 refresh 生命周期，不能套用数据库模式的过期断言。

## 图片与旧直播代理

IPTV 播放默认由浏览器直连上游；PureTV 登录与直播权限检查不改变媒体请求路径。只有来源明确设置 `m3u8-only` 或 `full` 时，HLS 请求才按该模式进入代理，失败不会自动升级模式。未设置模式的旧源默认直连，已保存的代理选择保留。网页、TV 页面和客户端测速共用地址规则，详见 [IPTV 配置](CONFIGURATION.md#iptv-直播)。

下面的 DNS 固定、LAN origin 和 CONNECT 策略适用于 Node/Docker 运行时。边缘构建使用下文单列的受限实现。

`/api/image-proxy`、`/api/proxy/{logo,m3u8,key,segment}` 在读取配置、DB 业务数据或发起出站请求前先调用共享媒体鉴权。无凭证／无效 Cookie 会获得不可共享缓存的 401。有效媒体 token 无需浏览器 Cookie；重写的直播播放列表保留 token、源 key、嵌套播放列表、音轨、密钥和初始化分片，并以最终重定向 URL 为相对地址基准。`allowCORS=true` 继续允许媒体分片直连，嵌套播放列表保留该选项。签名 URL 只解码外层 query 一次。

每一跳都验证 HTTP(S)、URL 凭证、IP 和全部 DNS 结果。普通目标不能访问环回、私网、metadata/link-local、保留地址或混合公网／私网 DNS 答案。连接使用刚刚检查过的 IP，重定向必须重新验证，最多 5 次；站点 Cookie、Authorization、Host 和 Proxy-Authorization 不会转发。跨源重定向还会移除 Referer。

图片和 logo 只接受常见 `image/*` 类型，返回 `nosniff` 与禁止活动内容的 CSP（包含 SVG 文档沙箱）。缓存改为浏览器私有缓存，CDN 不缓存；密钥与媒体使用 private/no-store。key 最大 64 KiB，播放列表最大 5 MiB，图片最大 10 MiB，segment 最大 64 MiB。`m3u8` 入口也兼容连续 MPEG-TS 等非播放列表流，因此在确认是播放列表后才施加文本限制，流式 fallback 没有 5 MiB 总长度限制。流在超过适用限制或下游取消时关闭上游；DNS／响应等待及流空闲时间默认 30 秒，图片为 15 秒。持续传输的媒体使用空闲计时，不因整个视频超过 30 秒而被截断。

## 管理员配置的 LAN 兼容

直播源必须启用。源配置 `LiveConfig[].url` 的精确 origin（协议、主机、端口）可访问管理员信任的 LAN 服务；它不授权同网段其他主机，也不授权其他端口。该来源允许的私有地址仅限 RFC1918、环回和 IPv6 ULA；metadata/link-local、未指定、组播和其他保留网段始终拒绝。已检查的 DNS 答案仍固定到连接，因此不会在连接时重新解析。

如果播放列表位于公网，但其频道或分片来自其他 LAN 服务，管理员需明确配置服务端环境变量：

```dotenv
LIVE_PROXY_TRUSTED_ORIGINS={"home-iptv":["http://192.168.1.20:8080","http://iptv.home:8090"]}
```

JSON key 必须是已启用直播源的 key；value 是最多 32 个精确 HTTP(S) origin，不接受路径、query、URL 凭证或通配符。客户端传 `puretv-source` 只能选择已有来源，不能新增授权。没有该配置时，来源以外的 LAN 地址拒绝；第三方播放列表内的任意私网 URL 不会自动升级为信任配置。管理员应仅把允许观看者请求的 IPTV 服务登记为信任 origin，因为 origin 授权覆盖该服务的全部路径。无效额外配置会关闭对应请求而非退回不受限 fetch。

Bangumi 图片 base URL 仅由真实 Bangumi 图片 URL 构造。请求参数 `source=bangumi` 不能把任意内网 URL 转成可信来源，客户端直接传入 base 的任意路径也不会获得 LAN 授权。已有 `BangumiImageBaseUrl` 可指向私有图片反向代理；它的精确 origin 是管理员授权边界。服务器配置的 `BangumiProxy` 支持 HTTP(S) CONNECT，代理端点的 DNS 也固定，CONNECT 目标使用已校验的数字 IP，并保留原始 TLS SNI/证书检查。代理账号只发送给配置的代理，不发送给图片源。要求代理远程解析目的域名的旧代理需要支持数字 IP CONNECT；否则请求关闭，不退回可绕过校验的代理方式。

## 边缘运行时限制

Cloudflare/EdgeOne 构建通过既有 webpack alias 使用 `edge-public-fetch.ts`；调用方统一使用 `@/lib/server/public-fetch`，防止相对导入绕过替换并引入 Node 网络模块。边缘 fetch 无法使用 Node 的固定 DNS 连接，因此只接受运营者在 `MEDIA_PROXY_ALLOWED_HOSTS` 中登记的精确主机名，每次重定向都重新检查。该白名单沿用主机名粒度，不限定端口；运营者需控制这些上游及其 DNS，不能把它理解为 Node DNS 固定的等价保护。

`LiveConfig[].url`、`LIVE_PROXY_TRUSTED_ORIGINS` 和 `BangumiImageBaseUrl` 的 Node origin 授权不会扩大边缘主机名白名单。未登记的 LAN 或公网目标均被拒绝。边缘不支持 `BangumiProxy` 的 CONNECT 策略：配置后相关请求明确失败，不能静默改走直连；边缘部署可使用已登记主机名的 `BangumiImageBaseUrl` 反向代理。

边缘实现同样清除认证请求头、跨源 Referer 和上游 Set-Cookie，执行第三个参数中的体积与超时限制，保留最终响应 URL。响应等待有截止时间；流持续传输时刷新空闲计时，连续直播没有额外总时长上限。调用方取消、超限或空闲超时会取消上游，不返回看似成功的截断结果。`tests/edge-public-fetch.test.js` 在原生 fetch transport 边界提供替身，验证这些行为且不允许实际出网；本轮没有在托管 Cloudflare/EdgeOne 上部署验证。

## 验证范围

`tests/proxy-route-security.test.js` 使用真实会话签名、真实共享媒体鉴权、真实 SSRF 与重定向策略；只在配置／存储和 DNS／HTTP transport 边界提供测试替身，并禁止全局原生 fetch 出网。覆盖匿名拒绝、私网与混合 DNS、每跳验证、LAN origin/端口隔离、禁用来源、Bangumi 参数伪装、CONNECT 目的与代理 IP 固定、签名 query、分片 Range、资源上限与媒体 token 传播。已有 `proxy.test.js`、`session.test.js`、`middleware-pwa.test.js`、`playlist.test.js` 一起执行。

本次未把其它服务器主动抓取入口（例如管理员维护直播源时刷新源列表、其他第三方聚合服务）统一迁移到此策略；这些入口的行为需要按其独立权限和可信配置边界另行审查。此清单也不会把公共登录接口的合法状态写入错误地当作匿名越权。
