# 首页与详情的电影海报动效

参考 [DerekCounihan/apple-tv-hero](https://github.com/DerekCounihan/apple-tv-hero/) 的视觉顺序，在 PureTV 现有首页和详情弹层中实现图片氛围、渐显、缓慢缩放及滚动视差。使用 PureTV 自有组件和图片来源，无新增运行时依赖。

## 使用效果

- 首页当前海报由柔化的背景过渡到清晰画面，片名与简介依次浮现。缩放只作用于图片，按钮始终可以操作。
- 底部进度条与轮播计时同步；切换影片时，缩略图列表保持当前项可见。暂停、键盘焦点和页面隐藏继续遵守原有规则。
- 首页新增详情按钮；打开后暂停轮播和预告片，关闭后从完整间隔重新计时，保留主动暂停状态。
- 详情弹层与抽屉共享海报主视觉，使用已取得的横图，缺少横图时以竖海报补充。原有演员、剧集、照片墙、来源切换与图片查看功能继续使用。

## 图片与性能

[CinematicArtwork](../src/components/hero/CinematicArtwork.tsx) 复用 `ProxyImage` 的代理、响应式图片和失败回退。首页仍输出首屏图片与文字，不等待取色请求。

已加载图片在小尺寸 canvas 中采样，缓存上限为 100 个 URL。取色不新增网络请求；跨域图片不允许 canvas 读取时使用默认深色，并保留原图构成的氛围层。取色失败不会隐藏图片或内容；图片失败仍保留背景与操作入口。切换图片会隔离加载状态，旧图片事件不会覆盖新图片。

[useHeroParallax](../src/components/hero/useHeroParallax.ts) 在滚动时以 `requestAnimationFrame` 合并更新 CSS 变量，不触发逐帧 React 渲染；离屏、隐藏页面、关闭和卸载时停止相应工作。详情视差使用弹层自己的滚动容器。

移动端减弱图片缩放及模糊，粗指针设备关闭视差。系统开启“减少动态效果”时关闭缩放、入场位移和视差，并保留首页默认暂停自动轮播的行为。

## 验证入口

```powershell
pnpm exec jest tests/banner-carousel.test.js tests/cinematic-artwork.test.js tests/hero-parallax.test.js tests/detail-hero.test.js --runInBand
pnpm typecheck
pnpm build
pnpm test:smoke:production
```

## 验证结果（2026-09-13）

- 最终全量 `pnpm test:postgres-redis`：57 套、543 项全部通过。包含图片加载/失败、暂停、视差监听清理、详情数据源快照、旧响应隔离及关闭重开的回归。
- `pnpm build`：Webpack 生产构建、TypeScript 检查与 PWA 生成通过；生产认证与 Socket 烟测通过。
- 修改文件 ESLint：0 错误，29 条既有组件警告；新 Hero 组件无警告。`git diff --check` 通过。
- 桌面浏览器：自动/手动切换、9 秒进度条、暂停缩放、详情进出场与滚动视差通过；图片查看器的 Escape 只关闭顶层，关闭详情后焦点返回入口。
- 移动浏览器：390px 首页无横向溢出，详情宽 358px、可独立滚动；选中的缩略图自动进入可见区域。
- 减少动态效果：实测图片动画与视差关闭，内容保持可见。跨域图片取色回退时原图正常展示。

浏览器检查使用隔离的开发预览及测试账号，没有实际播放外部视频，预览账号已登出。后续提交与本地部署记录见 [本地 Docker 运行说明](DOCKER-LOCAL.md)。
