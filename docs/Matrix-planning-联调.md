# Matrix 测试策划工具联调

部署含新迁移的 API、Worker 和 Web。用管理员登录，在「设置 → Matrix 对接」保存回调基地址，例如 `http://192.168.4.20:8086/jeecg-boot`。回调基地址填写 Worker 能访问的 Matrix 地址。Nginx 或 API 看到的 Matrix 启停请求来源 IP 必须与回调基地址中的 IP 一致。内网独立部署时，Matrix 访问 requirements-manager 宿主机发布的 Web 端口，Worker 访问 Matrix 发布的回调端口。两边可部署在不同主机和 Docker 网络。

Windows Docker Desktop 本机联调时，来源可能被转发为 Docker 网关 IP，回调则需要使用 Worker 可达的 Windows 宿主机 IP。如果这两个 IP 不同，启停会返回 HTTP 401。可将模拟器放到能被 Worker 回调、且源 IP 可直接识别的同一联调网络中。

浏览器访问项目详情时按正常流程登录。

在 Matrix 注册 `planning`，工具地址填 requirements-manager Web 基地址，启动和停止路径分别为 `/api/start` 和 `/api/stop`。使用默认 Web 路由时留空 `jumpPath`，工具返回 `/projects/<内部项目ID>`。

默认 Compose 和离线 ARM64 Compose 都给内置 Nginx 配置了专用代理网络。出现子网冲突时，在环境配置中同时调整 `MATRIX_WEB_PROXY_SUBNET`、`MATRIX_WEB_PROXY_IP` 和 `MATRIX_API_PROXY_IP`，确保 Web 和 API 的固定地址不同且在同一个子网。自定义部署若使用反向代理，设置 `MATRIX_TRUSTED_PROXY_IPS` 为直接连接 API 的可信代理 IP，多个地址用逗号隔开，并让该代理覆盖 `X-Real-IP`。直连时无需配置代理。符合来源 IP 的无 Cookie 请求以只读身份访问 API，启停接口也使用这个来源检查。

在 Matrix 测试机上运行以下命令。先启动监听器，再在另一个终端发起生成。为验证成功路径，等待监听器打印 `completed` 并打开详情页。为验证取消路径，使用另一个 `run-id` 发起生成后立即调用 stop。

```sh
python scripts/matrix_http_mock.py listen --port 8086 --prefix /jeecg-boot
python scripts/matrix_http_mock.py start --url http://192.168.4.50:8080 --run-id planning-001 --doc-zip source.zip
python scripts/matrix_http_mock.py stop --url http://192.168.4.50:8080 --run-id planning-001 --listener http://192.168.4.20:8086/jeecg-boot
```

文档 ZIP 可包含其他普通文件，工具会提取 DOCX。至少提供一个有效的原始需求 DOCX。代码包字段暂不参与生成。重复启动使用同一个运行标识，下一轮使用新的运行标识。自动重试期间会继续上报进度；完成统计快照和回执保存在 `MatrixPlanningRun` 中。


停止后续跑时，保持外部 projectId，换一个未使用的 runId，再提交同一组 DOCX。sessionId 可以变化。工具返回原项目链接，待上一轮清理完成后继续生成。DOCX 的相对路径或内容变化会创建独立项目。重传旧 runId 只返回原链接。
