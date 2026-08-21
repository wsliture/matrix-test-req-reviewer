# Matrix 测试需求管理工具

首版实现登录、项目压缩包导入、Phase 2任务调度、OpenCode结构化进度、DOCX转PDF预览和评审工作台。

## 启动

1. 将 `.env.example` 复制为 `.env` 并修改密码、模型供应商密钥。
2. 执行 `docker compose up --build`。
3. 首次启动后执行数据库迁移，并通过种子脚本创建管理员。

## 项目识别

- 压缩包不包含 `.matrix`：状态为 `PENDING_GENERATION`，允许启动 `/matrix-phase2`。
- 包含完整 Phase 2 最终工件：状态为 `READY_FOR_REVIEW`。
- 包含不完整 `.matrix`：状态为 `INCOMPLETE_MATRIX`，列出缺失工件并允许继续生成。

OpenCode进度只读取 `filldata_phase2_workflow` 工具的结构化事件；`session.idle`不等于成功，必须同时校验 `finalize_phase2_document.ok=true` 与最终DOCX存在。
