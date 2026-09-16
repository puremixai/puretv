# OpenTV Next.js 16 与前端优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 升级受维护的 Next.js 16，减少首页等待、图片与隐藏功能开销，隔离下载进度更新，验证现有播放、鉴权与部署链路。

**Architecture:** 先保留 Webpack 完成框架兼容，再逐项优化前端。个人权限与媒体 token 不进入公共缓存。新构建器和缓存能力以实际兼容测试为接入依据。

**Tech Stack:** Next.js 16、React 19、TypeScript、pnpm、Jest、Node 24、Docker、OpenNext、EdgeOne。

**Spec:** 本任务用户已接受的前端评估与“按建议实施”指令。

## Global Constraints

- Windows PowerShell，所有源码与文档 UTF-8。
- 保留 OpenTV 品牌、现有数据、接口鉴权、PWA API NetworkOnly、Socket.IO 与 TV 功能。
- 不自动提交、推送或远程部署；本地运行使用独立端口和临时测试数据库。
- 行为变更先编写可失败的回归测试，再修复并验证；配置与低风险懒加载通过类型、lint、构建和浏览器验证。
- 当前已有轮播键盘/点击/暂停逻辑、图片优先级、播放器插件懒加载继续保留。

## 1. 框架与工具链兼容

Files: package.json、pnpm-lock.yaml、next.config.js、server.js、eslint.config.mjs、tsconfig.json、scripts/*。

- [x] 从 npm 核对 Next 16 稳定补丁、React 和 peer 要求，固定 Next 与 @next/env 一致版本。
- [x] 对齐 React/DOM/types、TypeScript >= 5.1、ESLint 9 与 Testing Library；迁移 flat config，保留当前质量规则。
- [x] 构建使用 `next build --webpack`，自定义开发入口使用 `next({ dev, hostname, port, webpack: true })`。
- [x] 删除过期 Next 配置，迁移顶层 serverExternalPackages；验证 PWA 与各平台 aliases。
- [x] 迁移 14 个 route.ts 中 17 个同步 params；测试 Promise 参数下响应与鉴权行为。
- [x] 类型检查、全量测试、lint、生产构建、独立开发/生产冒烟，修复所有引入的失败。

## 2. 首页数据与图片

Files: src/app/page.tsx、src/components/BannerCarousel.tsx、首页 hooks/helpers、tests/*。

- [x] 先用可控延迟与缓存 fixture 验证独立刷新、关闭模块不请求、错误隔离。
- [x] 按模块缓存与 loading，消除四组请求后再串行短剧/即将上映。
- [x] 首页缓存先显示，卸载与重新配置时忽略过期响应。
- [x] TMDB hero、海报、小缩略图选择不同尺寸并支持响应式源，完整外部 URL 保留原代理行为。
- [x] 为首屏轮播建立服务端数据种子，避免冷访问 hydration 后再发现首图；首屏服务端请求有超时和降级。

## 3. 客户端依赖与恢复体验

Files: src/components/VideoCard.tsx、src/app/page.tsx、src/components/UserMenu.tsx、src/app/{loading,error,global-error}.tsx。

- [x] AI、详情、图片查看等隐藏面板动态加载，检查所有首页入口。
- [x] 设置中仅展示用的 Workers 脚本在面板打开后加载。
- [x] 增加路由加载、局部错误恢复和根错误恢复，组件回归确认中文反馈与重试可用。

## 4. 下载与播放状态

Files: src/contexts/DownloadContext.tsx、src/lib/download-db.ts、新下载调度模块、src/app/play/page.tsx、src/components/player/usePlayerEngine.ts、tests/*。

- [x] 回归测试覆盖进度合并、异步保存顺序、暂停/完成立即刷新，以及动作消费者不随进度重渲染。
- [x] 导出 `useDownloadActions()` 与 `useDownloadProgress()`，保留兼容 `useDownload()`。
- [x] UI 与持久化分别节流，增量保存活动任务，取消删除任务，串行写入避免旧状态覆盖新状态。
- [x] 播放页改用动作 Context；首次初始化不固定等待，原生/MP4 不阻塞于不需要的 Hls 导入。

## 5. Next 16 新能力与平台集成

Files: next.config.js、PWA 构建脚本、缓存/首屏服务模块、部署文档。

- [x] 验证 Turbopack 对 SVG、客户端/服务端模块隔离与 PWA 的支持；成功后提供可验证的运行入口。
- [x] 逐项验证 React Compiler 与 Cache Components；只有回归通过的配置进入默认路径。
- [x] 验证 Cloudflare 与 EdgeOne 构建。保留兼容的 Edge middleware，针对生成代码格式修复 EdgeOne 适配。
- [x] 更新 README 与实施结果，记录命令、通过项和无法验证的环境限制，不使用旧构建产物冒充性能基准。

## 6. 集成验收

- [x] `pnpm check`。
- [x] `pnpm build`、`pnpm test:smoke`、`pnpm test:smoke:production`。
- [x] 浏览器验证首页、轮播、搜索、设置；播放初始化与失败恢复通过组件回归验证，确认检查流程中无新增关键错误。
- [x] 独立代码审查，处理发现后重跑受影响检查，记录最终差异。

## 验收记录

完整结果与边界见 [Next 16 升级说明](../../NEXT16-UPGRADE.md)。Cache Components 经评估保持关闭；播放器启动与错误恢复由回归测试覆盖，浏览器检查未包含真实片源的完整播放。外部 PostgreSQL/Redis 集成测试按原条件跳过。临时 Turbo fixture 的清理被自动审批策略阻止，保留在项目外。
