# OpenTV Alpha 优化实施计划

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and review the independent tasks below. The user approved the reviewed recommendations and explicitly requested development in the current directory on an optimization branch.

**Goal:** 收敛代理安全边界、数据库行为与类型、播放状态编排，并建立可持续的质量检查。

**Architecture:** 复用已有安全出站请求与 DatabaseAdapter，在领域边界共享业务逻辑。将播放进度与换源策略从页面提取为可测试模块。质量门禁按文件和规则锁定存量问题，已清理的服务端日志不再允许裸 console。

**Tech Stack:** Next.js 16、React 19、TypeScript、PostgreSQL / SQLite / D1 / Turso、Redis、Jest、ESLint、Docker。

**Workspace:** `D:\bbs\MoonTVPlus`，分支 `codex/alpha-hardening`。版本继续使用 `0.1.0-alpha.1`。不改变数据卷、数据库键、Android 包名或已保存的实例配置。

## 1. 代理安全与访问策略

- [x] 对图片和旧直播代理补充未授权及 SSRF 回归，拒绝前不得发起网络请求。
- [x] 将 `src/app/api/image-proxy/route.ts` 与 `src/app/api/proxy/{logo,m3u8,key,segment}/route.ts` 纳入共享鉴权与出站校验。
- [x] 任意客户端 URL 默认仅允许公网；管理员配置的受信任来源按明确 origin 限定内网访问，重定向逐跳检查，DNS 校验结果用于实际连接。
- [x] 保持已配置 Bangumi HTTP 代理和内网 IPTV 可用，不信任客户端自报的 source。
- [x] 对 API 路由建立访问类别清单，验证实际 Next matcher、静态例外边界和专用令牌入口，新路由必须归类。

验证：运行新 handler / access-policy 测试，以及 `tests/proxy.test.js`、`tests/session.test.js`、`tests/middleware-pwa.test.js`、`tests/search-routes.test.js`。

## 2. DB 契约、去重与类型

- [x] 使用真实 SQLite 重现设置并发覆盖、错误被吞和批量写入回滚问题。
- [x] 统一用户设置原子版本比较：expectedVersion=0 仅创建，非零版本仅匹配更新，冲突不写入；读写失败明确抛出。
- [x] 为播放记录、收藏和用户设置抽取共享 SQL 领域仓储，保留后端方言、事务和返回值差异。
- [x] 补齐 IStorage 与领域能力类型，移除 db.ts 中已收敛领域的无类型转发，Redis 保留适合其后端的实现。
- [x] 同一组契约在真实 SQLite 与测试 PostgreSQL 上运行，覆盖用户隔离、更新、删除、冲突和事务回滚。

验证：新 storage 契约测试、现有 DB 回归、`pnpm typecheck`，最终 `pnpm test:postgres-redis` 使用独立测试容器。

## 3. 播放进度与换源编排

- [x] 固定退出保存、切集续播、同集换源迁移及快速切换时旧异步响应隔离的行为测试。
- [x] 从 `src/app/play/page.tsx` 提取进度快照、恢复决策及保存协调模块。
- [x] 提取类型明确的切集/换源协调器，避免仅搬运巨函数或扩大 hook 参数面。
- [x] 保留播放器生命周期、弹幕、AI、下载、观影室及原有视觉与快捷操作。

验证：新增播放策略/协调测试与现有 player、download、playlist 测试。

## 4. ESLint 增量门禁

- [x] 新建按相对文件路径 + 规则统计的基线与检查脚本；单个分组超出基线即失败，新增文件默认零警告。
- [x] 用行为测试证明总数持平但问题转移到其他文件/规则时仍然失败。
- [x] 将门禁接入 `pnpm check` 和现有 CI；基线更新必须显式执行，并可追溯。
- [x] 服务端源码禁止裸 console，logger 实现与受限 vendor 目录拥有明确例外；移除绕过该规则的整文件禁用。

验证：门禁单元测试、实际基线检查、源码 AST 日志扫描与 logger 脱敏回归。

## 5. 依赖和 Jest

- [x] 移除无引用的 `vidstack`、`@vidstack/react`、`media-icons` 并更新 lockfile。
- [x] 将 Jest 与 jest-environment-jsdom 升级到当前稳定 30.x，协调 next/jest、DOM mock、定时器及 Testing Library 入口。
- [x] 统一 CI 与 Docker 的 Node.js 24，验证冻结 lockfile 安装。

验证：全部测试、类型检查、生产构建及认证/Socket.IO 烟测。升级前通知并行实现者，避免测试过程中改动 node_modules。

## 6. 镜像健康检查

- [x] 为 Dockerfile 和 Dockerfile.lite 增加共用的 `/api/health` HTTP 探测命令。
- [x] 探测遵循 PORT、有超时、失败退出非零，不能仅执行导出函数的 health.js 模块。
- [x] 使用相同探测脚本简化 Compose 健康检查，保留数据库故障与 Redis 降级语义。

验证：用临时 HTTP 服务验证成功、503、连接失败与超时；生产烟测验证 `/api/health`。

## 7. 集成与审查

- [x] 分别审查功能要求和代码质量，修复发现的问题后再执行最终检查。
- [x] `pnpm check`、`pnpm build`、`pnpm test:smoke`、`pnpm test:smoke:production`。
- [x] Docker 可用后执行 PostgreSQL/Redis 集成测试；测试不得连接当前业务库。
- [x] 更新开发/安全/部署说明，记录实际验证结果、剩余存量债务及本轮边界。

当前基线（改动前）：ESLint 912 warnings / 0 errors；上一轮 Jest 59 suites、602 passed、13 skipped。最终报告使用本轮重新执行的结果。
