# Matrix 测试策划工具联调

部署含新迁移的 API、Worker 和 Web。用管理员登录，在「设置 → Matrix 对接」保存 Worker 能访问的回调基地址，例如 `http://192.168.4.20:8086/jeecg-boot`。地址留空时暂停进度和结果回调。Matrix 与 requirements-manager 可部署在不同主机及网络。

启动和停止接口无需登录。浏览器可以直接打开或通过 iframe 嵌入 Matrix 项目的详情、需求工作台和版本比较，进行评分、编辑和下载。可访问服务且持有项目链接的用户都具有这些权限。匿名操作归入「Matrix 匿名访问」系统账号。

项目列表和手动创建的项目需要登录。删除项目仅限管理员。

在 Matrix 注册 `planning`，工具地址填 requirements-manager Web 基地址，启动和停止路径分别为 `/api/start` 和 `/api/stop`。使用默认 Web 路由时留空 `jumpPath`，工具返回 `/projects/<内部项目ID>`。

默认 Compose 和离线 ARM64 Compose 都给内置 Nginx 配置了专用代理网络。出现子网冲突时，在环境配置中同时调整 `MATRIX_WEB_PROXY_SUBNET`、`MATRIX_WEB_PROXY_IP` 和 `MATRIX_API_PROXY_IP`，确保 Web 和 API 的固定地址不同且在同一个子网。

在 Matrix 测试机上运行以下命令。先启动监听器，再在另一个终端发起生成。为验证成功路径，等待监听器打印 `completed` 并打开详情页。为验证取消路径，使用另一个 `run-id` 发起生成后立即调用 stop。

```sh
python scripts/matrix_http_mock.py listen --port 8086 --prefix /jeecg-boot
python scripts/matrix_http_mock.py start --url http://192.168.4.50:8080 --run-id planning-001 --doc-zip source.zip
python scripts/matrix_http_mock.py stop --url http://192.168.4.50:8080 --run-id planning-001 --listener http://192.168.4.20:8086/jeecg-boot
```

文档 ZIP 可包含其他普通文件，工具会提取 DOCX。至少提供一个有效的原始需求 DOCX。代码包字段暂不参与生成。重复启动使用同一个运行标识，下一轮使用新的运行标识。自动重试期间会继续上报进度；完成统计快照和回执保存在 `MatrixPlanningRun` 中。


停止后续跑时，保持外部 projectId，换一个未使用的 runId，再提交同一组 DOCX。sessionId 可以变化。工具返回原项目链接，待上一轮清理完成后继续生成。DOCX 的相对路径或内容变化会创建独立项目。重传旧 runId 只返回原链接。
