# Matrix 测试需求管理工具

实现登录、DOCX源文档项目创建、Phase 2任务调度、OpenCode结构化进度、DOCX在线预览和评审工作台。

## 启动

1. 将 `.env.example` 复制为 `.env` 并修改密码、模型供应商密钥。
2. 执行 `docker compose up --build`。
3. 首次启动后执行数据库迁移，并通过种子脚本创建管理员。

## 新建项目

- 填写项目名称并上传ZIP压缩包。
- 压缩包中的普通文件只允许为 `.docx`，禁止 `.doc`、`.pdf`、`.matrix`及其他文件。
- 新建项目统一进入 `PENDING_GENERATION`，随后可启动 `/matrix-phase2`。

管理员可在项目列表的“设置”中修改密码或编辑OpenCode运行配置。配置保存时系统会保留Matrix插件并自动重启OpenCode服务。

OpenCode进度只读取 `filldata_phase2_workflow` 工具的结构化事件；`session.idle`不等于成功，必须同时校验
`finalize_phase2_document.ok=true` 与最终DOCX存在。
