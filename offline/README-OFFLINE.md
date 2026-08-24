# Matrix测试需求管理工具 ARM64 离线部署

## 服务器要求

- Linux ARM64/aarch64
- Docker Engine 24或更高版本
- 至少8GB内存和30GB可用磁盘空间
- 外部防火墙仅需放行TCP `8089`
- 能访问内部模型服务；运行过程不需要访问互联网

## 安装

```bash
tar -xf requirements-manager-arm64-offline.tar.gz
cd requirements-manager-arm64-offline
chmod +x install.sh
./install.sh
```

安装脚本会校验文件、导入ARM64镜像并创建数据目录。首次执行后必须编辑：

```bash
vi .env
vi data/opencode-config/opencode.json
```

将 `.env` 中所有 `replace-with` 值替换为强密码，并把 `WEB_ORIGIN` 改为服务器实际地址，例如：

```dotenv
WEB_ORIGIN=http://192.168.1.100:8089
COOKIE_SECURE=false
```

离线服务器当前通过HTTP的`8089`端口访问，因此必须保持`COOKIE_SECURE=false`。后续配置HTTPS反向代理后再改为`true`。

在 `opencode.json` 中配置内网Provider、模型和认证方式，并保留：

```json
"plugin": ["file:///plugin/dist/index.js"]
```

## 启动与维护

```bash
./start.sh          # 校验配置并启动
./status.sh         # 查看容器状态
./logs.sh           # 查看全部实时日志
./logs.sh worker    # 仅查看生成任务日志
./stop.sh           # 停止服务并保留数据
```

启动后访问 `http://服务器IP:8089`。API、PostgreSQL、Redis、MinIO和OpenCode均只在容器内部网络通信，不应在防火墙上开放对应端口。

## 数据与备份

全部持久化数据位于部署目录的 `data/`：

- `data/postgres`：账号、项目和评审数据
- `data/redis`：任务队列
- `data/minio`：上传文件和导出工件
- `data/projects`：源文档及Matrix运行工件
- `data/opencode-config`：OpenCode运行配置

备份前建议执行 `./stop.sh`，然后整体备份 `data/` 和 `.env`。

## 故障排查

- **8089被占用**：执行 `ss -ltnp | grep 8089` 查找占用进程。
- **页面无法访问**：执行 `./status.sh` 和 `./logs.sh web api`。
- **任务不运行**：执行 `./logs.sh worker opencode`，检查内网模型地址、模型ID和Key。
- **镜像缺失**：重新执行 `./install.sh`，不得在离线服务器上执行在线拉取。
- **确认端口暴露**：执行 `docker ps`，只有Web容器应显示 `0.0.0.0:8089->80/tcp`。
