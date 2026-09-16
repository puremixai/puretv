# PureTV Android TV

<div align="center">
  <img src="../../public/logo.png" alt="PureTV Android TV Logo" width="120" height="120">
</div>

这是 PureTV 的 Android TV 壳工程，支持系统 WebView 和 GeckoView 两种浏览器内核，用于打开 PureTV 的 `/tv` 电视端页面。

默认桌面名称为 `PureTV`。启动器、圆形图标入口和 TV 横幅使用与网页、PWA 一致的 PureTV 标识。

## 构建参数

- `BASE_URL`: 服务端 Base URL，不需要带 `/tv`，例如 `https://example.com` 或 `http://192.168.1.10:3000`
- `APP_NAME`: Android TV 桌面显示名称，默认 `PureTV`
- `VERSION_NAME`: APK 展示版本名，默认读取仓库根目录的 [VERSION.txt](../../VERSION.txt)；可通过 Gradle 属性或环境变量覆盖，空值回退到源码版本
- `VERSION_CODE`: Android 安装更新使用的整数版本号，默认 `2`；每次向已有安装分发更新时必须递增，不随展示版本重新编号或降级
- `MIN_SDK`: Android 外壳的最低 API，标准版为 `23`（Android 6+），兼容版为 `21`（Android 5+）；网页兼容性还取决于浏览器内核，见下文
- `GECKOVIEW_VERSION`: GeckoView 依赖版本，仅 GeckoView 版本使用，默认 `128.0.20240725162350`

PureTV 采用 `0.x` 开发版本体系，详见[版本策略](../../docs/DEVELOPMENT.md#版本维护)。GitHub Actions 的 `version_name` 留空时使用所选源码的版本，并统一用于 APK 构建和产物名称。`VERSION_NAME` 从初始化标记 `1.0.0` 调整为 `0.1.0-alpha.1` 不代表 Android 安装版本倒退；本次将默认 `VERSION_CODE` 从 `1` 提升至 `2`。如果已安装的 APK 使用了 `2` 或更大的版本号，构建下一次更新时必须显式传入更大的整数，并保持包名及签名一致。

App 启动时会自动打开：

```text
BASE_URL 去掉末尾 / 后 + /tv
```

`BASE_URL` 必须能从电视访问。项目的本地 Compose 默认只绑定电脑的 `127.0.0.1:3000`，需配置可达的反向代理地址或调整端口绑定及防火墙后再供电视使用；电视中的 `localhost` 指向电视自身。

## 特性

- GitHub Actions 默认构建四个版本：`webview-android6plus`、`webview-android5plus`、`geckoview-android6plus`、`geckoview-android5plus`
- GitHub Actions 未配置签名 secrets 时只构建 debug APK；配置完整签名 secrets 后只构建 release APK
- `webview` 版本使用系统 Android WebView，体积小，需要内核满足当前网页的浏览器要求
- `gecko` 版本自带 GeckoView 浏览器内核；所选内核须同时满足网页要求与设备的 Android 版本要求
- 锁定横屏
- 支持 Android TV Launcher
- 允许 HTTP 明文访问
- 允许 HTTPS 页面加载 HTTP 视频/图片等混合内容
- 使用仓库根目录的 [public/logo.png](../../public/logo.png) 作为图标来源
- 内置局域网遥控服务，手机与电视在同一局域网时可打开遥控页面

## 图标与兼容性

网页已迁移至 Tailwind CSS 4，官方浏览器基线为 Chrome 111+、Safari 16.4+ 和 Firefox 128+，详见 [Tailwind 4 升级说明](../../docs/TAILWIND4-UPGRADE.md#浏览器与电视端)。Android WebView 应使用 Chromium 111 或更新内核；GeckoView 应选择基于 Firefox 128 或更新内核的版本，并在目标电视上验证页面、焦点导航与播放。

`MIN_SDK` 和 APK 名称中的 `android5plus` / `android6plus` 只说明 Android 外壳的构建目标，不能保证设备自带的旧 WebView 能显示当前网页。本轮将默认 GeckoView 从 126 升至 `128.0.20240725162350`，以满足 Tailwind 4 的 CSS 浏览器基线，保留 `MIN_SDK=21/23`。已核对官方 AAR 的 SDK 元数据；尚未执行 Android APK 构建或设备测试。旧设备若无法运行符合要求的内核，不能仅通过切换壳版本解决。

GeckoView 内核随 APK 打包，更新网页或服务端 Docker 不会更新电视上已安装的内核；调整 `GECKOVIEW_VERSION` 后需要重新构建并安装 APK。系统 WebView 则需要在电视设备上更新，能否更新取决于设备支持。

Android 使用 [app/src/main/res/drawable/logo.png](app/src/main/res/drawable/logo.png) 作为图标资源。GitHub Actions 构建会从仓库根目录的 `public/logo.png` 自动复制；本地替换 Logo 后，也需同步该文件再构建 APK。

Android 包名为 `com.puretv.tv`，GeckoView 版本为 `com.puretv.tv.gecko`。JavaScript 桥接标识为 `PureTVLocalRemote`，遥控事件使用 `puretv:local-remote-*`，WebView 注入变量为 `__PURETV_LOCAL_REMOTE_URL`。`webview` 版本在 User-Agent 中追加 `PureTVAndroidTV WebView`，默认应用展示名称为 PureTV，继续使用现有 logo。

## 本地构建

可使用与 GitHub Actions 一致的构建环境：JDK 17、Gradle 8.10.2、Android SDK Platform 35 和 Build Tools 35.0.0。仓库未包含 Gradle Wrapper，以下命令使用已安装的 `gradle`。

在 `apps/android-tv` 目录执行：

```bash
gradle assembleWebviewDebug -PBASE_URL="http://192.168.1.10:3000"
gradle assembleGeckoDebug -PBASE_URL="http://192.168.1.10:3000"
```
