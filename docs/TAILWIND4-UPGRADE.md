# Tailwind 4 升级说明

本轮将 OpenTV 的样式框架从 Tailwind CSS 3 升级至 4，保持现有页面布局与功能。框架迁移阶段未引入 `apple-tv-hero`，未发布新的 OpenTV 项目版本；当时沿用初始化阶段暂用的 `1.0.0` 标记。项目现已改用[开发预览版本体系](DEVELOPMENT.md#版本维护)，本记录保留当时的验证事实，不表示已有部署自动更新了版本。后续海报动效见 [实现说明](CINEMATIC-HERO.md)，本地部署记录见 [Docker 运行说明](DOCKER-LOCAL.md)。

## 依赖与配置

| 依赖                          | 本轮版本               |
| ----------------------------- | ---------------------- |
| `tailwindcss`                 | `4.3.3`                |
| `@tailwindcss/postcss`        | `4.3.3`                |
| `tailwind-merge`              | `3.7.0`                |
| `prettier`                    | `3.9.6`                |
| `prettier-plugin-tailwindcss` | `0.8.1`                |
| Android TV 默认 GeckoView     | `128.0.20240725162350` |

`@tailwindcss/postcss` 是 Tailwind 的 PostCSS 插件；PostCSS 核心仍使用 8.x。实际安装版本以 [pnpm-lock.yaml](../pnpm-lock.yaml) 为准。

配置集中在 [src/styles/tailwind.css](../src/styles/tailwind.css)，由两份全局样式入口导入。使用 `@import 'tailwindcss'`、`@theme`、`@custom-variant`、`@plugin` 和 `@utility` 配置主题及工具类，移除原来的 `tailwind.config.ts`。源码扫描范围为 `src`。

[postcss.config.js](../postcss.config.js) 改用 `@tailwindcss/postcss`，移除独立的 `autoprefixer` 配置与直接依赖。Prettier 插件通过全局 CSS 入口读取 Tailwind 配置，无需再指定 JavaScript 配置文件。

保留现有 `.dark` 切换、`mobile-landscape` 横屏变体、主色与字体、闪烁及进出场动画、径向与锥形渐变工具类，以及 forms、typography 插件。边框、占位文字、焦点环和按钮光标的兼容规则用于保持原有控件表现。

## 样式迁移要点

旧工具类按 Tailwind 4 命名迁移，例如 `shadow-sm` → `shadow-xs`、`rounded` → `rounded-sm`、`blur-sm` → `blur-xs`、`outline-none` → `outline-hidden`、`bg-gradient-to-*` → `bg-linear-to-*`。自定义可组合工具类使用 `@utility`。

自动迁移之外，已完成以下针对性处理：

- `cinema-ui.css` 中按类名匹配渐变按钮的属性选择器，跟随新的 `bg-linear-to-*` 名称更新。
- `globals.css` 的 body 默认文字色放入基础层，避免无 layer 的规则覆盖浅色、深色主题工具类。
- 首页海报卡片统一变换规则，消除 CSS `transform` 与 Tailwind 独立 `scale` 属性叠加，保持原有悬停尺寸。
- 通知的已读、删除操作在触屏设备上可见，并支持键盘焦点显示，不依赖仅在可悬停设备生效的 `group-hover`。
- 管理后台隐藏面板、弹幕面板及备份内容说明中受 `space-y` 新规则影响的布局改用 `gap`，处理隐藏兄弟与子元素自带 margin 的间距冲突。
- 26 处旧 `bg-opacity-50` 用法改为 `bg-black/50`，保留遮罩的半透明黑色背景。

迁移规则与差异依据 [Tailwind CSS 官方升级指南](https://tailwindcss.com/docs/upgrade-guide)。本轮保留现有首页轮播和页面设计。

## 浏览器与电视端

Tailwind 4 的官方浏览器基线为 **Chrome 111+、Safari 16.4+、Firefox 128+**。低于此基线的浏览器可能无法正确解析样式。依据见 [官方浏览器要求](https://tailwindcss.com/docs/upgrade-guide#browser-requirements)。

Android 外壳的最低系统版本与网页的浏览器要求分开计算。Android 5/6 能安装某个 APK，不等于设备内置 WebView 满足网页要求；WebView 需使用 Chromium 111 或更新内核。默认 GeckoView 配套从 126 升至 `128.0.20240725162350`，保留原有 SDK 与功能。详情见 [Android TV 使用说明](../apps/android-tv/README.md#图标与兼容性)。

已只读核对 [GeckoView 128 官方 AAR](https://maven.mozilla.org/maven2/org/mozilla/geckoview/geckoview/128.0.20240725162350/geckoview-128.0.20240725162350.aar)：最低 Android API 为 21。其直接依赖 [Core 1.13.1](https://dl.google.com/dl/android/maven2/androidx/core/core/1.13.1/core-1.13.1.aar)、[Lifecycle 2.7.0](https://dl.google.com/dl/android/maven2/androidx/lifecycle/lifecycle-process/2.7.0/lifecycle-process-2.7.0.aar) 要求的最低编译 API 为 34，当前工程使用 35，因此可以保留 `MIN_SDK=21/23`。这是已检查制品的元数据结论，尚未执行 APK 构建、完整传递依赖验证或设备测试。

本机有 Java 17，但缺少可用的 Gradle、Gradle Wrapper 与 Android SDK，未进行 APK 编译。网页和 Docker 的验证不代表 Android TV 设备验证通过。

GeckoView 的更新需要重新构建并安装 APK；已安装的内核不会随网页或 Docker 更新。系统 WebView 需由电视设备单独更新。

## 验证

2026-09-13 框架迁移阶段的验证记录如下；后续海报动效完成后的 57 套、543 项全量测试及正式本地部署结果见 [Docker 运行说明](DOCKER-LOCAL.md)。

| 检查项                          | 结果                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                    | 通过。类型检查通过；ESLint 0 错误、912 条已有警告；当时测试为 53 套、465 项通过、13 项跳过。                                       |
| PostgreSQL/Redis 与最终全量测试 | `pnpm test:postgres-redis` 通过；最终全量测试 54 套、503 项全部通过，包含新增的 25 项真实 CSS 编译回归。                           |
| Webpack 生产构建与烟测          | 生产构建通过，认证与 Socket 烟测通过。                                                                                             |
| 独立 Linux Docker 验证          | 镜像 `xtv:tailwind4-verify-20260913` 构建通过；启动、登录、匿名 CSS 资源、首页与注销运行检查通过。当时尚未更新 3000 端口正式容器。 |
| 桌面浏览器对照                  | 已对照首页、详情、后台设置的浅色/深色主题及卡片悬停；详情页检查的关键尺寸与颜色完全相同。                                          |
| 移动端布局                      | `390×844` 视口无溢出，DOM 尺寸检查通过。内置浏览器（IAB）150% 物理缩放导致截图裁切，未完成可靠的像素对照。                         |
| 通知面板                        | 空列表面板正常打开，遮罩实测为 50% 黑色；触屏与键盘操作按钮的动态显示未完成验证，测试通知请求拦截未生效。                          |
| Turbopack 生产构建与烟测        | `pnpm build:turbo` 与生产烟测通过，包含登录、HttpOnly Cookie、代理鉴权、媒体签名、Socket 身份和设备撤销检查。                      |

在项目根目录顺序执行，避免两个构建同时写入 `.next`：

```powershell
pnpm check
pnpm test:postgres-redis
pnpm build
pnpm test:smoke:production
pnpm build:turbo
pnpm test:smoke:production
```

移动端像素对照、通知按钮触屏/键盘动态验证与 Android TV 实机验证仍未完成；浏览器验证结果不能替代目标 Android TV 内核的设备验证。浏览器测试会话已注销，临时预览服务及独立验证容器已停止并清理，现有正式容器保持运行。
