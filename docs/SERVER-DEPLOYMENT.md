# 部署到已有 Docker 服务器

[Docker 基础配置](DOCKER.md) · [Go 模块说明](../services/go-worker/README.md)

此方式适用于服务器已有 Nginx 容器和共享反向代理网络的情况。PureTV 使用独立数据库与数据卷；仅应用容器加入代理网络，Go、PostgreSQL 和 Redis 留在项目内部网络，所有服务均不发布宿主机端口。

## 准备

需要 Docker Compose 2.24.4 或更高版本，以支持清除基础配置的端口映射。按 Docker 基础配置创建三个 `.env.*.local` 文件，使用独立随机密码，并将 `SITE_BASE` 和 `NEXT_PUBLIC_SITE_URL` 设为实际 HTTPS 域名。新数据库会在启动时自动初始化，站长账号由 `ADMIN_USERNAME` 和 `PASSWORD` 创建。

获取 `main` 分支源码：

```sh
git clone --branch main --single-branch https://github.com/puremixai/puretv.git
cd puretv
```

另建不入库的 `.env.go-worker.local`，配置 Go 服务令牌、需要开启的模块及下列部署变量：

```dotenv
PURETV_PROXY_NETWORK=my_net
PURETV_IMAGE=puretv:RELEASE_COMMIT
PURETV_GO_IMAGE=puretv-go-worker:RELEASE_COMMIT
PUID=1001
PGID=1001
```

将 `RELEASE_COMMIT` 替换为实际提交的短哈希，网络名替换为 Nginx 已加入的网络。完整 Go 开关见模块说明；共享令牌须在 Node 和 Go 两端一致，不向浏览器提供。模块开关仅选择执行引擎，离线下载等产品功能还需要原有功能开关和管理员权限。

首次部署建议使用镜像默认的 `1001:1001`。如需其他 UID/GID，应在启动 Go 下载服务前初始化下载卷属主；状态卷由 Compose 初始化服务处理。不要复制其他实例的环境文件或数据卷作为新实例凭证。

## 构建与启动

```sh
docker compose --env-file .env.go-worker.local -f compose.local.yaml -f compose.go-worker.yaml -f compose.server.yaml config --quiet
docker compose --env-file .env.go-worker.local -f compose.local.yaml -f compose.go-worker.yaml -f compose.server.yaml build puretv puretv-go
docker compose --env-file .env.go-worker.local -f compose.local.yaml -f compose.go-worker.yaml -f compose.server.yaml up -d --no-build --wait --wait-timeout 180
```

服务项目名为 `puretv-server`，数据卷均以 `puretv-server_` 开头，代理网络别名为 `puretv-web`。复用此配置部署第二个实例时，需同时修改项目名、卷名和代理网络别名，避免共享数据或错误路由。

根据 [Nginx 模板](../deploy/nginx/puretv.conf.example) 配置域名和证书路径，放入现有 Nginx 的配置目录。模板支持 WebSocket、SSE 和应用容器更新后的 Docker DNS 重新解析。先确认应用与 Go 健康，再执行 `nginx -t` 和无中断 reload。

若使用 Cloudflare Origin CA，DNS 应开启代理，SSL 模式使用 Full (strict)，证书必须覆盖目标域名。保留已有域名配置，仅新增本次站点的虚拟主机。

## 发布验证与回退

- 检查 `/api/health` 的数据库与缓存状态，并确认四个常驻服务均健康。
- 通过 HTTPS 检查登录、受保护 API 未登录返回 401，以及登录后进入首页和管理页面。
- 确认容器没有发布 Go、数据库、缓存或应用宿主机端口。
- 更新时记录部署分支及提交，先备份数据库、环境文件、下载和 Go 状态卷，并保留原镜像标签。
- 在原分支执行 `git pull --ff-only`，更新两个镜像标签，构建成功后用上述完整参数重建服务。
- 回退时恢复原环境及镜像标签，用同一组 Compose 参数启动；涉及数据库结构变化时按数据库备份流程恢复。保留状态卷中的下载收据，先核对未完成写任务，避免重复提交。

新实例首次登录后需在管理后台配置视频源、订阅和元数据服务。源码发布不会自动迁移本地账号、收藏或视频源配置。
