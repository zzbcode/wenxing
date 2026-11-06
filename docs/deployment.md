# 自托管、备份与回退

此配置把文行天下作为独立 Node 服务部署到已有 HTTPS 网关之后。它不会占用宿主机 80/443，不复用其他项目的数据库，不要求停止其他应用。

## Docker

以下均为通用部署示例，不对应维护者的实际服务器。需要 Docker Compose 与部署者自建的外部网络；示例名称为 `wenxing-gateway`，可通过 `.env` 的 `GATEWAY_NETWORK` 修改。若是全新服务器，先创建网络并自行配置 HTTPS 入口；已有服务器先核对网络归属，不能覆盖其他服务。

```bash
cp .env.example .env
chmod 600 .env
mkdir -p data backups
chmod 700 data backups
# 编辑.env，填入自己的服务端API密钥
docker network inspect wenxing-gateway
docker compose config --quiet
docker compose up -d --build
docker compose ps
python3 scripts/create-user.py --docker --username author --name 作者
```

容器以 `node` 用户（UID 1000）运行，`./data` 必须由对应用户可写。不同宿主机 UID 时，仅调整本项目目录权限或 Compose 用户，不要对其他应用目录做递归 `chown`。

Compose 强制 `SECURE_COOKIES=true`，需从 HTTPS 入口登录。此安全 Cookie 配置无法用于普通 HTTP 公网入口。`.env` 由 Compose 注入容器，镜像不包含密钥或作品。

## 现有 Nginx 网关新增规则

先备份当前规则，追加以下独立路径，不替换原有站点。网关与应用在同一个 Docker 网络，`wenxing-app` 为本项目服务别名。

```nginx
location = /wenxing { return 301 /wenxing/; }
location /wenxing/ {
    proxy_pass http://wenxing-app:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 10s;
    proxy_read_timeout 660s;
    proxy_send_timeout 660s;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    client_max_body_size 8m;
}
```

`proxy_pass` 没有尾随 `/`，保留 `/wenxing/` 前缀。不要把此项目放在通用 `/api/`：同服务器可能已有其他应用占用。健康检查为 `/wenxing/api/health`，不得返回密钥、数据库路径、作品或账号详情。

规则保存后先运行网关的 `nginx -t`，通过才 reload。首次 DNS 解析需要新容器已运行。客户端与网关证书问题应独立修复，不能通过关闭生产 HTTPS 或禁用安全 Cookie 绕过。

## 上线验收

1. 构建、服务端行为测试、依赖审计通过；在浏览器完成桌面与手机主要交互验收。
2. 独立验收人确认登录、作品隔离、编辑保存、冲突提示、生成取消/失败、预览采用、历史回溯和导出。
3. 验证 `/wenxing/`、资源 URL、健康检查；未登录不能访问作品 API。
4. 执行一次合成内容的真实模型请求，明确采用后重载，检查保存；不要用私人作品做公开截图。
5. 重启本项目容器，确认账号与稿件仍在。
6. 核对原有服务与路由、原有数据卷和密钥文件权限保持正常。

## 一致性备份

应用运行时使用 SQLite `VACUUM INTO` 创建一致性快照，不直接复制活动中的主数据库：

```bash
# 本地或宿主机直接运行
node --env-file=.env server/backup.mjs backups/wenxing-before-upgrade.sqlite

# Docker：快照先写到已挂载的数据目录，再复制到受保护备份目录
docker compose exec -T app node server/backup.mjs /app/data/pre-upgrade.sqlite
cp data/pre-upgrade.sqlite backups/wenxing-before-upgrade.sqlite
chmod 600 backups/wenxing-before-upgrade.sqlite
```

每次使用新文件名，备份工具不覆盖已有文件。快照含用户隐私和密码哈希，应按私密数据保存；不要上传到 Issue、公开对象存储或 Git。额外在离线加密存储中保留副本，并定期在隔离目录做恢复演练。

## 升级与回退

升级前记录当前源码提交、镜像 ID 与网关备份位置，创建数据库快照。新版本先完成本地与独立验收，再仅替换本服务。不要运行 `docker compose down -v`、`docker volume prune` 或覆盖其他项目 `.env`。

若仅前端/服务代码有问题，恢复之前镜像/源码并重新启动本服务。数据库模式有变更时，先停止本服务，把当前整个 `data/` 目录保留到新的受保护位置，再在**新建空数据目录**放入一致性备份并设正确权限，之后启动对应旧版服务。不要把备份直接覆盖到正在运行的 WAL 数据库。

需要撤销入口时，只移除本次新增的 `/wenxing` 两条 location，保留之后其他项目变更；`nginx -t` 通过才 reload。数据库与 `.env` 留存以便排查，不做清理删除。

