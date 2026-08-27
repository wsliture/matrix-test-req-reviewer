import {useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode} from "react";
import {createPortal} from "react-dom";
import {
    Alert,
    Badge,
    Button,
    Card,
    Checkbox,
    Col,
    Drawer,
    Empty,
    Form,
    Input,
    Layout,
    List,
    message,
    Modal,
    Popconfirm,
    Popover,
    Progress,
    Row,
    Select,
    Slider,
    Space,
    Spin,
    Splitter,
    Tag,
    Tabs,
    Tooltip,
    Tree,
    Typography,
    Upload
} from "antd";
import {
    ArrowLeftOutlined,
    CheckCircleFilled,
    CloseOutlined,
    CloseCircleFilled,
    DeleteOutlined,
    DownloadOutlined,
    ExportOutlined,
    FileZipOutlined,
    LogoutOutlined,
    MenuUnfoldOutlined,
    PlusOutlined,
    SettingOutlined,
    StopOutlined
} from "@ant-design/icons";
import {Navigate, Route, Routes, useNavigate, useParams} from "react-router-dom";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {
    api,
    ApiError,
    resetAuthenticationState,
    downloadApi,
    hasActiveAuthenticationMarker,
    hadAuthenticatedSession,
    markAuthenticated,
    recoverSession,
    type CurrentUser,
    type Phase2Run,
    type Project,
    type ReviewData,
    type ReviewRecord,
    type ReviewScores,
    type RunEvent,
    saveDownload,
    type SessionStatus,
    subscribeSessionStatus,
    type TraceLink
} from "./api";
import {DocxPreview} from "./DocxPreview";
import {Phase2DocumentRenderer} from "./Phase2DocumentRenderer";
import {useTraceStore} from "./traceStore";

const {Header, Content, Sider} = Layout;

type SplitSizes = Array<number | string>;
const splitStorageKey = (name: string) => `matrix-requirements-review:${name}`;

function loadSplitSizes(name: string): number[] | undefined {
    try {
        const value = JSON.parse(localStorage.getItem(splitStorageKey(name)) || "null");
        return Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every(item => typeof item === "number" && Number.isFinite(item) && item >= 0) ? value : undefined
    } catch {
        return undefined
    }
}

function saveSplitSizes(name: string, sizes: SplitSizes) {
    if (sizes.every(item => typeof item === "number" && Number.isFinite(item))) localStorage.setItem(splitStorageKey(name), JSON.stringify(sizes))
}

function snappedSizes(sizes: number[], threshold: number, bothSides: boolean) {
    const total = sizes[0] + sizes[1];
    if (sizes[0] < threshold && sizes[1] >= threshold) return [0, total];
    if (bothSides && sizes[1] < threshold && sizes[0] >= threshold) return [total, 0];
    return sizes
}

function localMinute(value?: string) {
    if (!value) return "-";
    const date = new Date(value), pad = (number: number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function Login() {
    const nav = useNavigate(), qc = useQueryClient(), login = useMutation({
        mutationFn: (v: {
            username: string,
            password: string,
            rememberMe: boolean
        }) => api<CurrentUser>("/auth/login", {method: "POST", body: JSON.stringify(v)}, false), onSuccess: async user => {
            await qc.cancelQueries({queryKey: ["me"]});
            markAuthenticated();
            qc.setQueryData(["me"], user);
            nav("/", {replace: true})
        }
    });
    return <div className="login"><Card title="测试需求管理工具" style={{width: 420}}><Form layout="vertical"
                                                                                            initialValues={{rememberMe: false}}
                                                                                            onFinish={v => login.mutate(v)}><Form.Item
        name="username" label="用户名" rules={[{required: true}]}><Input/></Form.Item><Form.Item name="password"
                                                                                                 label="密码"
                                                                                                 rules={[{required: true}]}><Input.Password/></Form.Item><Form.Item
        name="rememberMe" valuePropName="checked"><Checkbox>保持登录（30天）</Checkbox></Form.Item>{hadAuthenticatedSession() &&
        <Alert type="warning" showIcon message="登录状态已失效，请重新登录"/>}{login.error &&
        <Alert type="error" message={login.error.message}/>}<Button block type="primary" htmlType="submit"
                                                                    loading={login.isPending}>登录</Button></Form></Card>
    </div>
}

function Shell({children, backTo, actions}: { children: React.ReactNode; backTo?: string; actions?: React.ReactNode }) {
    const nav = useNavigate(), qc = useQueryClient();
    return <Layout className="shell"><Header className="header"><b>Matrix测试需求管理</b>{backTo &&
        <Button ghost icon={<ArrowLeftOutlined/>} onClick={() => nav(backTo)}>返回项目</Button>}<span
        className="grow"/>{actions}<Button
        ghost icon={<LogoutOutlined/>} onClick={async () => {
        await api("/auth/logout", {method: "POST"});
        resetAuthenticationState();
        qc.setQueryData(["me"], null);
        nav("/login", {replace: true})
    }}>退出</Button></Header>{children}</Layout>
}

function Projects() {
    const qc = useQueryClient(), nav = useNavigate(), user = qc.getQueryData<CurrentUser>(["me"]), query = useQuery({
        queryKey: ["projects"],
        queryFn: () => api<Project[]>("/projects")
    }), [open, setOpen] = useState(false), [archiveFile, setArchiveFile] = useState<File | null>(null),
        [createForm] = Form.useForm(), [settingsOpen, setSettingsOpen] = useState(false),
        [passwordForm] = Form.useForm(), [userForm] = Form.useForm(),
        [configContent, setConfigContent] = useState(""), upload = useMutation({
        mutationFn: async ({name, file}: { name: string; file: File }) => {
            const form = new FormData();
            form.append("name", name);
            form.append("file", file);
            return api<Project>("/projects", {method: "POST", body: form})
        }, onSuccess: p => {
            setOpen(false);
            setArchiveFile(null);
            createForm.resetFields();
            qc.invalidateQueries({queryKey: ["projects"]});
            message.success("项目创建完成");
            location.href = `/projects/${p.id}`
        }
    }), configQuery = useQuery({
        queryKey: ["opencode-config"],
        queryFn: () => api<{ content: string }>("/settings/opencode"),
        enabled: settingsOpen && user?.role === "ADMIN"
    }), changePassword = useMutation({
        mutationFn: (values: { currentPassword: string; newPassword: string }) => api("/auth/change-password", {
            method: "POST", body: JSON.stringify(values)
        }), onSuccess: () => {
            message.success("密码修改成功，请重新登录");
            resetAuthenticationState();
            qc.setQueryData(["me"], null);
            nav("/login", {replace: true})
        }
    }), createUser = useMutation({
        mutationFn: (values: { username: string; password: string }) => api<{
            id: string;
            username: string;
            role: string;
            createdAt: string
        }>("/settings/users", {method: "POST", body: JSON.stringify(values)}),
        onSuccess: result => {
            userForm.resetFields();
            message.success(`用户“${result.username}”已创建`)
        }
    }), saveConfig = useMutation({
        mutationFn: () => api<{ content: string }>("/settings/opencode", {
            method: "PUT", body: JSON.stringify({content: configContent})
        }), onSuccess: result => {
            setConfigContent(result.content);
            qc.setQueryData(["opencode-config"], result);
            message.success("OpenCode配置已保存并生效")
        }
    }), remove = useMutation({
        mutationFn: (id: string) => api<{ id: string }>(`/projects/${id}`, {method: "DELETE"}),
        onSuccess: () => {
            qc.invalidateQueries({queryKey: ["projects"]});
            nav("/", {replace: true});
            message.success("项目已删除")
        },
        onError: error => message.error(error.message)
    });
    useEffect(() => {
        if (configQuery.data?.content) setConfigContent(configQuery.data.content)
    }, [configQuery.data?.content]);
    const settings = <Button ghost icon={<SettingOutlined/>} onClick={() => setSettingsOpen(true)}>设置</Button>;
    const settingsItems = [{
        key: "password", label: "修改密码", children: <Form form={passwordForm} layout="vertical"
            onFinish={values => changePassword.mutate({currentPassword: values.currentPassword, newPassword: values.newPassword})}>
            <Form.Item name="currentPassword" label="当前密码" rules={[{required: true, message: "请输入当前密码"}]}><Input.Password/></Form.Item>
            <Form.Item name="newPassword" label="新密码" rules={[{required: true, message: "请输入新密码"},
                {min: 8, max: 128, message: "密码长度必须为8至128个字符"}]}><Input.Password/></Form.Item>
            <Form.Item name="confirmPassword" label="确认新密码" dependencies={["newPassword"]} rules={[{required: true, message: "请再次输入新密码"},
                ({getFieldValue}: any) => ({validator(_: unknown, value: string) {
                    return !value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的新密码不一致"))
                }})]}><Input.Password/></Form.Item>
            {changePassword.error && <Alert type="error" showIcon message={changePassword.error.message}/>}<Button
                type="primary" htmlType="submit" loading={changePassword.isPending}>修改密码</Button></Form>
    }, ...(user?.role === "ADMIN" ? [{
        key: "users", label: "添加用户", children: <Form form={userForm} layout="vertical"
            onFinish={values => createUser.mutate({username: values.username.trim(), password: values.password})}>
            <Alert type="info" showIcon message="新用户将以评审人员身份创建，可使用项目创建、测试需求生成、评审和导出功能。"/>
            <Form.Item name="username" label="用户名" rules={[{required: true, whitespace: true, message: "请输入用户名"},
                {max: 64, message: "用户名不能超过64个字符"}]}><Input autoComplete="off" placeholder="请输入用户名"/></Form.Item>
            <Form.Item name="password" label="初始密码" rules={[{required: true, message: "请输入初始密码"},
                {min: 8, max: 128, message: "密码长度必须为8至128个字符"}]}><Input.Password autoComplete="new-password"/></Form.Item>
            <Form.Item name="confirmPassword" label="确认初始密码" dependencies={["password"]} rules={[{required: true, message: "请再次输入初始密码"},
                ({getFieldValue}: any) => ({validator(_: unknown, value: string) {
                    return !value || getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致"))
                }})]}><Input.Password autoComplete="new-password"/></Form.Item>
            {createUser.isSuccess && <Alert type="success" showIcon closable
                message={`用户“${createUser.data.username}”创建成功`}
                description="该用户现在可以使用初始密码登录系统。"
                onClose={() => createUser.reset()}/>}
            {createUser.error && <Alert type="error" showIcon message={createUser.error.message}/>}<Button
                type="primary" htmlType="submit" loading={createUser.isPending}>创建用户</Button></Form>
    }, {
        key: "opencode", label: "OpenCode配置", children: <div><Alert type="warning" showIcon
            message="配置中可能包含明文API Key，仅管理员可以查看和修改。保存时会自动保留Matrix插件。"/>
            {configQuery.isLoading ? <Spin/> : <><Input.TextArea className="opencode-config-editor" rows={20}
                value={configContent} onChange={event => setConfigContent(event.target.value)} spellCheck={false}/>
                {configQuery.error && <Alert type="error" showIcon message={configQuery.error.message}/>}
                {saveConfig.error && <Alert type="error" showIcon message={saveConfig.error.message}/>}<Space>
                    <Button onClick={() => {
                        try {
                            setConfigContent(JSON.stringify(JSON.parse(configContent), null, 2) + "\n")
                        } catch {
                            message.error("当前内容不是合法JSON")
                        }
                    }}>格式化JSON</Button><Button type="primary" loading={saveConfig.isPending}
                                              onClick={() => saveConfig.mutate()}>保存并应用</Button></Space></>}
        </div>
    }] : [])];
    return <Shell actions={settings}><Content className="page"><Space
        style={{width: "100%", justifyContent: "space-between"}}><Typography.Title level={3}>项目列表</Typography.Title><Button
        type="primary" icon={<PlusOutlined/>} onClick={() => setOpen(true)}>新建项目</Button></Space><Row
        gutter={[16, 16]}>{query.data?.slice().sort((left, right) => {
            const createdAtDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
            return createdAtDifference || right.id.localeCompare(left.id)
        }).map(p => <Col xs={24} md={12} xl={8} key={p.id}><Card hoverable title={p.name}
                                                                                             onClick={() => location.href = `/projects/${p.id}`}
                                                                                             extra={<div
                                                                                                 data-project-action
                                                                                                 onClick={event => event.stopPropagation()}>
                                                                                                 <Space><Status
                                                                                                     value={p.status}/><Popconfirm
                                                                                                     title="删除项目"
                                                                                                     description="将永久删除项目、源文档、生成工件和评审记录，是否继续？"
                                                                                                     okText="删除"
                                                                                                     cancelText="取消"
                                                                                                     okButtonProps={{danger: true}}
                                                                                                     onConfirm={() => remove.mutate(p.id)}><Button
                                                                                                     danger type="text"
                                                                                                     icon={
                                                                                                         <DeleteOutlined/>}
                                                                                                     loading={remove.isPending && remove.variables === p.id}
                                                                                                     onClick={event => event.stopPropagation()}/></Popconfirm></Space>
                                                                                             </div>}>
        <p>创建时间：{localMinute(p.createdAt)}</p><p>最新任务：{p.runs[0]?.status || "无"}</p><Progress
        percent={p.runs[0]?.progress || 0}/></Card></Col>)}</Row><Modal open={open} title="新建项目"
        okText="创建项目" cancelText="取消" confirmLoading={upload.isPending}
        onCancel={() => {
            setOpen(false);
            setArchiveFile(null);
            upload.reset();
            createForm.resetFields()
        }} onOk={() => createForm.submit()}><Form form={createForm} layout="vertical" onFinish={values => {
        if (!archiveFile) return message.error("请选择源文档ZIP压缩包");
        upload.mutate({name: values.name.trim(), file: archiveFile})
    }}><Form.Item name="name" label="项目名称" rules={[{required: true, whitespace: true, message: "请输入项目名称"},
        {max: 100, message: "项目名称不能超过100个字符"},
        {validator: (_, value) => {
            const normalized = String(value || "").trim();
            return normalized && query.data?.some(project => project.name === normalized)
                ? Promise.reject(new Error("项目名称已存在，请使用其他名称"))
                : Promise.resolve()
        }}]}><Input placeholder="请输入项目名称"/></Form.Item>
        <Form.Item label="源文档压缩包" required><Upload.Dragger accept=".zip" maxCount={1}
            beforeUpload={file => {
                setArchiveFile(file);
                return false
            }} onRemove={() => setArchiveFile(null)}><p><FileZipOutlined className="upload-icon"/></p>
            <p>上传仅包含DOCX源文档的ZIP压缩包</p><p className="upload-hint">不允许包含DOC、PDF、.matrix或其他格式文件</p>
        </Upload.Dragger></Form.Item></Form>{upload.error && <Alert type="error" showIcon message={upload.error.message}/>}</Modal>
        <Modal open={settingsOpen} title="系统设置" width={760} footer={null} destroyOnHidden
               onCancel={() => setSettingsOpen(false)}><Tabs items={settingsItems}/></Modal></Content></Shell>
}

function Status({value}: { value: string }) {
    const colors: Record<string, string> = {
        READY_FOR_REVIEW: "green",
        GENERATING: "blue",
        FAILED: "red",
        INCOMPLETE_MATRIX: "orange"
    };
    return <Tag color={colors[value] || "default"}>{value}</Tag>
}

const CHAPTERS = [
    ["第一章：范围", "finalize_chapter1_scope", "chapter1-scope.json"],
    ["第二章：系统概述", "finalize_chapter2_system_overview", "chapter2-system-overview.json"],
    ["第三章：硬件接口", "finalize_hardware_interface", "hardware-interface-model.json"],
    ["4.1：功能测试", "finalize_functional_test_content", "functional-test-content.json"],
    ["4.2：性能测试", "finalize_performance_test_content", "performance-test-content.json"],
    ["4.3：接口测试", "finalize_interface_test_content", "interface-test-content.json"],
    ["4.4：可靠性安全性测试", "finalize_reliability_safety_test_content", "reliability-safety-test-content.json"],
    ["4.5：余量测试", "finalize_margin_test_content", "margin-test-content.json"],
    ["4.6：边界测试", "finalize_boundary_test_content", "boundary-test-content.json"],
    ["4.7：数据处理测试", "finalize_data_processing_test_content", "data-processing-test-content.json"],
    ["4.8：恢复性测试", "finalize_recovery_test_content", "recovery-test-content.json"],
    ["4.9：强度测试", "finalize_strength_test_content", "strength-test-content.json"],
    ["测试需求追溯关系", "generate_phase2_traceability", "phase2-test-traceability.json"]
] as const;

const STAGE_NAMES: Record<string, string> = {
    discover_documents: "识别源文档",
    prepare_document_artifacts: "准备文档工件",
    prepare_chapter1_scope: "准备第一章：范围",
    finalize_chapter1_scope: "生成第一章：范围",
    prepare_chapter2_system_overview: "准备第二章：系统概述",
    finalize_chapter2_system_overview: "生成第二章：系统概述",
    discover_hardware_interface_candidates: "识别硬件接口",
    prepare_hardware_interface_batches: "准备硬件接口",
    merge_hardware_interface_blocks: "合并硬件接口",
    finalize_hardware_interface: "生成第三章：硬件接口",
    prepare_functional_title_tree: "准备功能标题树",
    finalize_functional_title_tree: "生成功能标题树",
    prepare_functional_init_content: "准备初始化功能需求",
    finalize_functional_init_content: "生成初始化功能需求",
    prepare_functional_other_content: "准备非初始化功能需求",
    get_functional_other_content_worker_batch: "准备非初始化功能需求",
    finalize_functional_other_content: "生成非初始化功能需求",
    finalize_functional_test_content: "生成4.1：功能测试",
    prepare_performance_test_content: "准备性能测试",
    finalize_performance_test_content: "生成4.2：性能测试",
    prepare_interface_test_content: "准备接口测试",
    finalize_interface_test_content: "生成4.3：接口测试",
    prepare_reliability_safety_test_content: "准备可靠性安全性测试",
    finalize_reliability_safety_test_content: "生成4.4：可靠性安全性测试",
    prepare_margin_test_content: "准备余量测试",
    finalize_margin_test_content: "生成4.5：余量测试",
    prepare_boundary_test_content: "准备边界测试",
    finalize_boundary_test_content: "生成4.6：边界测试",
    prepare_data_processing_test_content: "准备数据处理测试",
    finalize_data_processing_test_content: "生成4.7：数据处理测试",
    prepare_recovery_test_content: "准备恢复性测试",
    finalize_recovery_test_content: "生成4.8：恢复性测试",
    prepare_strength_test_content: "准备强度测试",
    finalize_strength_test_content: "生成4.9：强度测试",
    generate_phase2_traceability: "生成测试需求追溯关系",
    finalize_phase2_document: "生成最终测试需求文档"
};

function stageName(value: string, batchIndex?: unknown) {
    const [mode, encodedIndex] = value.split(":", 2), index = Number(batchIndex ?? encodedIndex);
    if (mode === "get_functional_other_content_worker_batch") {
        return Number.isInteger(index) && index > 0 ? `准备第${index}个非初始化功能需求` : "准备非初始化功能需求"
    }
    return STAGE_NAMES[mode] || mode
}

function eventText(item: RunEvent) {
    const mode = String(item.payload.mode || ""), stage = stageName(mode, item.payload.batchIndex);
    if (item.type === "run.queued") return "任务已进入执行队列";
    if (item.type === "run.started") return "Worker已开始执行任务";
    if (item.type === "model.selected") return `使用模型：${String(item.payload.name || item.payload.model || "OpenCode当前配置模型")}`;
    if (item.type === "session.created") return "OpenCode会话创建成功";
    if (item.type === "command.started") return "已提交测试需求生成命令";
    if (item.type === "stage.running") return `开始：${stage}`;
    if (item.type === "stage.completed") return `完成：${stage}`;
    if (item.type === "run.succeeded") return "测试需求生成完成";
    if (item.type === "run.cancelled") return "用户已终止测试需求生成";
    if (item.type === "run.failed") return `生成失败：${String(item.payload.message || "未知错误")}`;
    return item.type
}

function RunLogs({run, onEvents}: { run?: Phase2Run; onEvents: () => void }) {
    const [events, setEvents] = useState<RunEvent[]>([]), [connection, setConnection] = useState("等待任务");
    useEffect(() => {
        setEvents([]);
        if (!run) return;
        let active = true;
        const merge = (rows: RunEvent[]) => setEvents(previous => {
            const values = new Map(previous.map(item => [item.id, item]));
            rows.forEach(item => values.set(item.id, item));
            return [...values.values()].sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)))
        });
        api<Phase2Run>(`/phase2-runs/${run.id}`).then(value => {
            if (active) merge([...(value.events || [])].reverse())
        }).catch(() => undefined);
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.status)) {
            setConnection("任务已结束");
            return () => {
                active = false
            }
        }
        let source: EventSource | undefined, reconnectTimer: number | undefined;
        const connect = () => {
            if (!active) return;
            setConnection("正在连接实时日志");
            source = new EventSource(`/api/phase2-runs/${run.id}/events`, {withCredentials: true});
            source.addEventListener("run-events", raw => {
                const rows = JSON.parse((raw as MessageEvent).data) as RunEvent[];
                if (rows.length) {
                    merge(rows);
                    onEvents()
                }
                setConnection("实时日志已连接")
            });
            source.onerror = () => {
                source?.close();
                setConnection("连接中断，正在恢复登录状态");
                recoverSession().then(() => {
                    if (active) reconnectTimer = window.setTimeout(connect, 500)
                }).catch(() => setConnection("登录状态已失效"))
            }
        };
        connect();
        return () => {
            active = false;
            source?.close();
            if (reconnectTimer) window.clearTimeout(reconnectTimer)
        }
    }, [run?.id, run?.status]);
    return <Card size="small" title="实时运行日志" extra={<Tag>{connection}</Tag>} className="run-log-card">
        {events.length ? <List size="small" dataSource={events} renderItem={item => <List.Item
            className={`run-log ${item.type === "run.failed" ? "error" : item.type.endsWith("succeeded") || item.type === "stage.completed" ? "success" : "info"}`}>
            <span className="run-log-time">{localMinute(item.createdAt)}</span><span>{eventText(item)}</span>
        </List.Item>}/> : <div className="run-log-empty">正在等待任务启动...</div>}
    </Card>
}

function ChapterStatus({project, run}: { project: Project; run?: Phase2Run }) {
    const completed = new Set(run?.completedStages || []), missing = new Set(project.missingArtifacts || []),
        failed = run?.status === "FAILED";
    return <Card title="章节生成状态" className="chapter-status"><Row
        gutter={[12, 12]}>{CHAPTERS.map(([name, stage, artifact]) => {
        const ready = run ? completed.has(stage) : !missing.has(artifact);
        return <Col xs={24} md={12} xl={8} key={stage}>
            <div className="chapter-status-row"><span>{name}</span>{ready ?
                <CheckCircleFilled className="chapter-ok" title="已成功生成"/> :
                <CloseCircleFilled className={failed ? "chapter-failed" : "chapter-pending"}
                                   title={failed ? "未生成" : "尚未生成"}/>}</div>
        </Col>
    })}</Row></Card>
}

function ProjectPage() {
    const {id = ""} = useParams(), nav = useNavigate(), qc = useQueryClient(), query = useQuery({
        queryKey: ["project", id],
        queryFn: () => api<Project>(`/projects/${id}`),
        refetchInterval: 3000,
        retry: false
    }), run = useMutation({
        mutationFn: () => api<Phase2Run>(`/phase2-runs/project/${id}`, {method: "POST"}),
        onSuccess: () => qc.invalidateQueries({queryKey: ["project", id]})
    }), cancel = useMutation({
        mutationFn: (runId: string) => api<Phase2Run>(`/phase2-runs/${runId}/cancel`, {method: "POST"}),
        onSuccess: () => {
            qc.invalidateQueries({queryKey: ["project", id]});
            qc.invalidateQueries({queryKey: ["projects"]});
            message.success("已终止测试需求生成")
        }
    });
    if (query.isLoading) return <Shell><Spin/></Shell>;
    if (query.error) {
        return <Shell><Content className="page"><Alert type="warning" showIcon
                                                       message="项目不存在或已被删除"
                                                       description={query.error.message}
                                                       action={<Button type="primary" onClick={() => {
                                                           nav("/", {replace: true})
                                                       }}>返回项目列表</Button>}/></Content></Shell>
    }
    if (!query.data) return <Shell><Spin/></Shell>;
    const p = query.data, latest = p.runs[0];
    const running = latest?.status === "RUNNING" || latest?.status === "QUEUED";
    return <Shell><Content className="page"><Space><Button onClick={() => nav("/")}>返回</Button><Typography.Title
        level={3}>{p.name}</Typography.Title><Status value={p.status}/></Space><ChapterStatus project={p} run={latest}/>
        {p.status === "READY_FOR_REVIEW" &&
            <Button type="primary" onClick={() => nav(`/projects/${id}/review`)}>进入评审</Button>}
        <Card title="Phase 2测试需求生成"><Progress percent={latest?.progress || 0}
                                                    status={latest?.status === "FAILED" ? "exception" : running ? "active" : "normal"}/>
            <p>当前阶段：{latest?.status === "CANCELLED" ? "已终止" : latest?.currentStage ? stageName(latest.currentStage) : running ? "任务启动中" : latest?.status === "FAILED" ? "生成失败" : "尚未开始"}</p>
            {latest?.errorMessage &&
                <Alert type="error" showIcon message="测试需求生成失败" description={latest.errorMessage}/>}<Button
                type="primary"
                loading={run.isPending} disabled={running}
                onClick={() => run.mutate()}>{running ? "正在生成测试需求" : "开始生成测试需求"}</Button>
            {running && latest && <Popconfirm title="终止测试需求生成？"
                                              description="终止后保留已完成阶段工件，并可重新开始生成。"
                                              okText="终止" cancelText="继续运行" okButtonProps={{danger: true}}
                                              onConfirm={() => cancel.mutate(latest.id)}><Button danger
                                                                                                 icon={<StopOutlined/>}
                                                                                                 loading={cancel.isPending}>终止生成</Button></Popconfirm>}
            {latest?.status === "CANCELLED" && <Alert type="info" showIcon message="测试需求生成已终止"/>}
            {(run.error || cancel.error) &&
                <Alert type="error" showIcon message={(run.error || cancel.error)?.message}/>}<RunLogs run={latest}
                                                                                                       onEvents={() => qc.invalidateQueries({queryKey: ["project", id]})}/>
        </Card></Content></Shell>
}

type TreeItem = { key: string; title: React.ReactNode; children?: TreeItem[] };

type FloatingPosition = { x: number; y: number };

function EvaluationWindow({open, children, loading, subject, onSubjectClick, onCancel, onSave}: {
    open: boolean;
    children: ReactNode;
    loading: boolean;
    subject?: string;
    onSubjectClick?: () => void;
    onCancel: () => void;
    onSave: () => void
}) {
    const panelRef = useRef<HTMLDivElement>(null), dragRef = useRef<{x: number; y: number} | undefined>(undefined),
        [position, setPosition] = useState<FloatingPosition>();
    const clampPosition = (next: FloatingPosition) => {
        const panel = panelRef.current, margin = 12,
            width = panel?.offsetWidth || Math.min(520, window.innerWidth - margin * 2),
            height = panel?.offsetHeight || Math.min(680, window.innerHeight - margin * 2);
        return {
            x: Math.min(Math.max(next.x, margin), Math.max(margin, window.innerWidth - width - margin)),
            y: Math.min(Math.max(next.y, margin), Math.max(margin, window.innerHeight - height - margin))
        }
    };
    useEffect(() => {
        if (!open) return;
        const frame = requestAnimationFrame(() => {
            const panel = panelRef.current;
            if (!panel) return;
            setPosition(clampPosition({
                x: (window.innerWidth - panel.offsetWidth) / 2,
                y: (window.innerHeight - panel.offsetHeight) / 2
            }))
        });
        return () => cancelAnimationFrame(frame)
    }, [open]);
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
                if (event.key === "Escape") onCancel()
            },
            onResize = () => setPosition(current => current ? clampPosition(current) : current);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("resize", onResize)
        }
    }, [open, onCancel]);
    if (!open) return null;
    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
            if ((event.target as HTMLElement).closest("button")) return;
            const rect = panelRef.current?.getBoundingClientRect();
            if (!rect) return;
            dragRef.current = {x: event.clientX - rect.left, y: event.clientY - rect.top};
            event.currentTarget.setPointerCapture(event.pointerId)
        },
        drag = (event: ReactPointerEvent<HTMLDivElement>) => {
            if (!dragRef.current) return;
            setPosition(clampPosition({x: event.clientX - dragRef.current.x, y: event.clientY - dragRef.current.y}))
        },
        stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
            dragRef.current = undefined;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        };
    return createPortal(<div ref={panelRef} className="evaluation-window" role="dialog" aria-modal="false"
                             aria-labelledby="evaluation-window-title"
                             style={position ? {left: position.x, top: position.y} : {visibility: "hidden"}}>
        <div className="evaluation-window-titlebar" onPointerDown={startDrag} onPointerMove={drag}
             onPointerUp={stopDrag} onPointerCancel={stopDrag}>
            <div className="evaluation-window-heading">
                <b id="evaluation-window-title">内容质量评估</b>
                {subject && <button type="button" className="evaluation-window-subject" title={subject}
                                    onClick={onSubjectClick}>{subject}</button>}
            </div>
            <Button type="text" icon={<CloseOutlined/>} aria-label="关闭内容质量评估" onClick={onCancel}/>
        </div>
        <div className="evaluation-window-body">{children}</div>
        <div className="evaluation-window-footer">
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" loading={loading} onClick={onSave}>保存评估</Button>
        </div>
    </div>, window.document.body)
}

function treeOf<T extends {
    id: string;
    parentId?: string | null;
    orderIndex: number
}>(nodes: T[], title: (node: T) => React.ReactNode): TreeItem[] {
    const children = new Map<string | undefined, T[]>();
    nodes.forEach(node => {
        const parentId = node.parentId ?? undefined;
        children.set(parentId, [...(children.get(parentId) || []), node])
    });
    const build = (parentId?: string): TreeItem[] => (children.get(parentId) || []).sort((a, b) => a.orderIndex - b.orderIndex)
        .map(node => ({key: node.id, title: title(node), children: build(node.id)}));
    return build()
}

function Review() {
    const [reviewMessage, reviewMessageContext] = message.useMessage();
    const {id = ""} = useParams(),
        qc = useQueryClient(), [documentId, setDocumentId] = useState<string>(), [evalOpen, setEvalOpen] = useState(false),
        [evaluationTargetId, setEvaluationTargetId] = useState<string>(), [scores, setScores] = useState<ReviewScores>({
            correctness: 4,
            coverage: 4,
            testability: 4
        }), [reviewComment, setReviewComment] = useState(""),
        {activeSourceNodeId, activeRequirementId, setSource, setRequirement} = useTraceStore(), data = useQuery({
            queryKey: ["review-data", id],
            queryFn: () => api<ReviewData>(`/projects/${id}/review-data`),
            retry: false
        }),
        trace = useQuery({
            queryKey: ["trace-links", id, activeSourceNodeId],
            queryFn: () => api<TraceLink[]>(`/projects/${id}/trace-links?sourceNodeId=${activeSourceNodeId}&includeDescendants=true`),
            enabled: Boolean(activeSourceNodeId)
        }),
        reviews = useQuery({
            queryKey: ["reviews", id],
            queryFn: () => api<ReviewRecord[]>(`/projects/${id}/reviews`),
            retry: false
        });
    const [tracePopoverNodeId, setTracePopoverNodeId] = useState<string>();
    const [sourceNavigationKey, setSourceNavigationKey] = useState(0);
    const [reviewCenterOpen, setReviewCenterOpen] = useState(false);
    const [reviewFilter, setReviewFilter] = useState<"all" | "reviewed" | "pending">("all");
    const [reviewSearch, setReviewSearch] = useState("");
    const [pendingAttention, setPendingAttention] = useState(false);
    const [mainSizes, setMainSizes] = useState<SplitSizes | undefined>(() => loadSplitSizes("main"));
    const [sourceDirectoryOpen, setSourceDirectoryOpen] = useState(false);
    const [requirementDirectoryOpen, setRequirementDirectoryOpen] = useState(false);
    const sourceCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const requirementCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const tracePopoverNodeIdRef = useRef(tracePopoverNodeId);
    tracePopoverNodeIdRef.current = tracePopoverNodeId;
    const cancelDirectoryClose = (timer: typeof sourceCloseTimer) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = undefined
    };
    const scheduleSourceDirectoryClose = () => {
        cancelDirectoryClose(sourceCloseTimer);
        sourceCloseTimer.current = setTimeout(() => {
            if (!tracePopoverNodeIdRef.current) setSourceDirectoryOpen(false)
        }, 300)
    };
    const scheduleRequirementDirectoryClose = () => {
        cancelDirectoryClose(requirementCloseTimer);
        requirementCloseTimer.current = setTimeout(() => setRequirementDirectoryOpen(false), 300)
    };
    useEffect(() => {
        if (!documentId && data.data?.documents[0]) setDocumentId(data.data.documents[0].id)
    }, [data.data, documentId]);
    const selectedDocument = data.data?.documents.find(item => item.id === documentId),
        requirements = data.data?.requirements || [],
        selectedRequirement = requirements.find(item => item.id === activeRequirementId) || requirements[0],
        sourceCounts = useMemo(() => new Map((data.data?.links || []).map(link => link.sourceNodeId).map((sourceId, _, all) => [sourceId, all.filter(item => item === sourceId).length])), [data.data?.links]),
        requirementTree = useMemo(() => treeOf(requirements.filter(node => node.nodeType !== "requirement"), node =>
            <span>{node.number ? `${node.number} ` : ""}{node.title}</span>), [requirements]);
    const latestReviews = useMemo(() => {
        const latest = new Map<string, ReviewRecord>();
        for (const review of reviews.data || []) if (!latest.has(review.nodeId)) latest.set(review.nodeId, review);
        return latest
    }, [reviews.data]);
    const evaluationTarget = requirements.find(item => item.id === evaluationTargetId);
    const reviewScores = useMemo(() => Object.fromEntries([...latestReviews].map(([nodeId, review]) => [nodeId, review.weightedScore])), [latestReviews]);
    const requirementById = useMemo(() => new Map(requirements.map(item => [item.id, item])), [requirements]);
    const reviewItems = useMemo(() => (data.data?.phase2Document?.chapters || []).flatMap(chapter => chapter.blocks)
        .filter(block => block.type === "heading" && block.evaluable === true && Boolean(block.anchorId))
        .map(block => {
            const node = requirementById.get(block.anchorId!), review = latestReviews.get(block.anchorId!);
            return {
                id: block.anchorId!,
                number: node?.number || "",
                title: node?.title || block.text || "未命名评审项",
                review
            }
        }), [data.data?.phase2Document?.chapters, requirementById, latestReviews]);
    const reviewedCount = reviewItems.filter(item => Boolean(item.review)).length;
    const pendingCount = reviewItems.length - reviewedCount;
    const reviewPercent = reviewItems.length ? Math.round(reviewedCount / reviewItems.length * 100) : 0;
    const saveReview = useMutation({
        mutationFn: () => {
            if (!evaluationTargetId) throw new Error("未选择评估节点");
            return api<ReviewRecord>(`/projects/${id}/reviews`, {
                method: "POST",
                body: JSON.stringify({nodeId: evaluationTargetId, scores, comment: reviewComment})
            })
        },
        onSuccess: async () => {
            await qc.invalidateQueries({queryKey: ["reviews", id]});
            setEvalOpen(false);
            message.success("评估已保存")
        }
    });
    const downloadRequirements = useMutation({
        mutationFn: () => downloadApi(`/projects/${id}/test-requirements-docx`),
        onSuccess: result => {
            saveDownload(result.blob, result.filename);
            message.success("第三方测试需求下载完成")
        },
        onError: error => message.error(error.message)
    });
    const exportReport = useMutation({
        mutationFn: () => downloadApi(`/projects/${id}/review-report`),
        onSuccess: result => {
            saveDownload(result.blob, result.filename);
            message.success("评审报告导出完成")
        },
        onError: error => {
            if (error instanceof ApiError && error.status === 409 && Array.isArray(error.details?.missingReviews)) {
                setReviewCenterOpen(true);
                setReviewFilter("pending");
                setPendingAttention(true);
                reviewMessage.warning("仍有测试需求尚未完成评审")
            } else message.error(error.message)
        }
    });
    useEffect(() => {
        if (!activeRequirementId && requirements[0]) setRequirement(requirements[0].id)
    }, [requirements, activeRequirementId]);
    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setTracePopoverNodeId(undefined)
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape)
    }, []);
    useEffect(() => () => {
        cancelDirectoryClose(sourceCloseTimer);
        cancelDirectoryClose(requirementCloseTimer)
    }, []);
    const gotoRequirement = (targetId: string) => {
            setTracePopoverNodeId(undefined);
            setSourceDirectoryOpen(false);
            setRequirementDirectoryOpen(false);
            setRequirement(targetId);
            setTimeout(() => window.document.getElementById(`requirement-${targetId}`)?.scrollIntoView({
                behavior: "smooth",
                block: "start"
            }), 0)
        },
        gotoSource = (link: TraceLink) => {
            setRequirementDirectoryOpen(false);
            setDocumentId(link.sourceNode.document?.id);
            setSource(link.sourceNodeId);
            setSourceNavigationKey(value => value + 1)
        },
        total = scores.correctness * .4 + scores.coverage * .35 + scores.testability * .25,
        grade = total >= 4.5 ? "优秀" : total >= 3.5 ? "良好" : total >= 2.5 ? "合格" : "不合格",
        openEvaluation = (targetId: string) => {
            if (evalOpen) {
                reviewMessage.warning("已有内容质量评估窗口，请先保存或关闭当前窗口");
                return false
            }
            const latest = latestReviews.get(targetId);
            setRequirement(targetId);
            setEvaluationTargetId(targetId);
            setScores({
                correctness: Number(latest?.scores.correctness ?? 4),
                coverage: Number(latest?.scores.coverage ?? 4),
                testability: Number(latest?.scores.testability ?? 4)
            });
            setReviewComment(latest?.comment || "");
            saveReview.reset();
            setEvalOpen(true);
            return true
        };
    const uniqueTraceLinks = [...new Map((trace.data || []).map(link => [link.targetNodeId, link])).values()],
        sectionLinks = uniqueTraceLinks.filter(link => link.targetNode.nodeType !== "requirement"),
        requirementLinks = uniqueTraceLinks.filter(link => link.targetNode.nodeType === "requirement"),
        traceGroup = (title: string, links: TraceLink[], compact = false) => links.length ?
            <section className="trace-popover-group"><b>{title}</b><List size="small" dataSource={links}
                                                                         renderItem={link => <List.Item
                                                                             onClick={() => gotoRequirement(link.targetNodeId)}>
                                                                             <div
                                                                                 className={compact ? "trace-target trace-target-compact" : "trace-target"}>
                                                                                 <span
                                                                                     className="trace-target-number">{link.targetNode.number}</span>
                                                                                 {compact ? <Tooltip
                                                                                         title={link.targetNode.title}><span
                                                                                         className="trace-target-summary">{link.targetNode.title}</span></Tooltip> :
                                                                                     <span>{link.targetNode.title}</span>}
                                                                             </div>
                                                                             {link.direct ?
                                                                                 <Tag color="green">直接</Tag> :
                                                                                 <Tag>子章节</Tag>}
                                                                         </List.Item>}/></section> : null,
        traceContent = <div className="trace-popover-content">{trace.isLoading ?
            <Spin/> : uniqueTraceLinks.length ? <>{traceGroup("测试章节", sectionLinks)}{traceGroup("测试需求TR", requirementLinks, true)}</> :
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前章节暂无追溯"/>}</div>,
        sourceTree = treeOf(selectedDocument?.nodes || [], node => <Popover open={tracePopoverNodeId === node.id}
                                                                            placement="rightTop" trigger="click" arrow
                                                                            autoAdjustOverflow
                                                                            getPopupContainer={() => window.document.body}
                                                                            overlayClassName="trace-popover"
                                                                            title={`${node.number && node.number !== "PREAMBLE" ? node.number : node.title} 的追溯关系`}
                                                                            content={traceContent}
                                                                            onOpenChange={open => {
                                                                                if (open) {
                                                                                    cancelDirectoryClose(sourceCloseTimer);
                                                                                    setSourceDirectoryOpen(true);
                                                                                    setSource(node.id);
                                                                                    setTracePopoverNodeId(node.id)
                                                                                } else if (tracePopoverNodeId === node.id) {
                                                                                    setTracePopoverNodeId(undefined);
                                                                                    scheduleSourceDirectoryClose()
                                                                                }
                                                                            }}><span
            className="source-tree-title">{node.number && node.number !== "PREAMBLE" ? `${node.number} ` : ""}{node.title}{sourceCounts.get(node.id) ?
            <Badge count={sourceCounts.get(node.id)} className="trace-count"/> : null}</span></Popover>),
        sourceNodeMap = new Map((selectedDocument?.nodes || []).map(node => [node.id, node])),
        isInsideCollapsedNode = (collapsedId: string, nodeId: string) => {
            let currentId: string | undefined = nodeId;
            while (currentId) {
                if (currentId === collapsedId) return true;
                currentId = sourceNodeMap.get(currentId)?.parentId || undefined
            }
            return false
        };
    if (data.isLoading) return <Spin fullscreen/>;
    if (data.error) return <Shell backTo={`/projects/${id}`}><Alert type="error" message="评审数据加载失败"
                                                                    description={data.error.message}/></Shell>;
    const sourceDirectory = <aside className="tree-pane review-tree-pane"><Typography.Title
        level={5}>源文档</Typography.Title>
        <Select style={{width: "100%"}} value={documentId} onChange={value => {
            setTracePopoverNodeId(undefined);
            setDocumentId(value);
            setSource(undefined)
        }} options={data.data?.documents.map(item => ({value: item.id, label: item.name}))}/>
        {selectedDocument?.parseStatus === "FAILED" &&
            <Alert type="error" message="DOCX结构解析失败" description={selectedDocument.parseError}/>}<Tree blockNode
                                                                                                             showLine
                                                                                                             treeData={sourceTree}
                                                                                                             selectedKeys={activeSourceNodeId ? [activeSourceNodeId] : []}
                                                                                                             defaultExpandAll
                                                                                                             onExpand={(_, info) => {
                                                                                                                 if (!info.expanded && tracePopoverNodeId && isInsideCollapsedNode(String(info.node.key), tracePopoverNodeId)) setTracePopoverNodeId(undefined)
                                                                                                             }}
                                                                                                             onSelect={keys => {
                                                                                                                 setSource(String(keys[0] || ""));
                                                                                                                 setTimeout(() => {
                                                                                                                     if (!tracePopoverNodeIdRef.current) setSourceDirectoryOpen(false)
                                                                                                                 }, 50)
                                                                                                             }}/>
    </aside>;
    const sourceDocument = <main className="document docx-pane review-document-pane"><DocxPreview
        documentId={documentId} nodes={selectedDocument?.nodes || []} activeNodeId={activeSourceNodeId}
        navigationKey={sourceNavigationKey}
        onNodeClick={setSource}/></main>;
    const requirementDirectory = <aside className="tree-pane review-tree-pane"><Typography.Title
        level={5}>测试需求目录</Typography.Title><Tree blockNode showLine treeData={requirementTree}
                                                       selectedKeys={selectedRequirement ? [selectedRequirement.id] : []}
                                                       defaultExpandAll
                                                       onSelect={keys => gotoRequirement(String(keys[0] || ""))}/>
    </aside>;
    const requirementDocument = <main className="document requirement-pane review-document-pane"><Phase2DocumentRenderer
        chapters={data.data?.phase2Document?.chapters || []} links={data.data?.links || []}
        activeId={selectedRequirement?.id} onSource={gotoSource} onEvaluate={openEvaluation}
        reviewScores={reviewScores}/></main>;
    const persist = (name: string, setter: (sizes: SplitSizes) => void, threshold: number, bothSides: boolean) => (sizes: number[]) => {
        const next = snappedSizes(sizes, threshold, bothSides);
        setter(next);
        saveSplitSizes(name, next)
    };
    const hoverDirectory = (kind: "source" | "requirement", open: boolean) => {
        const timer = kind === "source" ? sourceCloseTimer : requirementCloseTimer;
        cancelDirectoryClose(timer);
        if (open) (kind === "source" ? setSourceDirectoryOpen : setRequirementDirectoryOpen)(true);
        else (kind === "source" ? scheduleSourceDirectoryClose : scheduleRequirementDirectoryClose)()
    };
    const workspace = (kind: "source" | "requirement", directory: React.ReactNode, documentPane: React.ReactNode) => {
        const open = kind === "source" ? sourceDirectoryOpen : requirementDirectoryOpen;
        const setOpen = kind === "source" ? setSourceDirectoryOpen : setRequirementDirectoryOpen;
        const label = kind === "source" ? "源文档目录" : "测试需求目录";
        return <div className={`review-workspace review-workspace-${kind}`}>
            <button type="button" className={`directory-hover-rail${open ? " is-open" : ""}`} aria-label={label}
                    aria-expanded={open}
                    onMouseEnter={() => hoverDirectory(kind, true)} onMouseLeave={() => hoverDirectory(kind, false)}
                    onClick={() => {
                        cancelDirectoryClose(kind === "source" ? sourceCloseTimer : requirementCloseTimer);
                        setOpen(!open)
                    }}>
                <MenuUnfoldOutlined/><span>{label}</span>
            </button>
            <div className={`directory-overlay directory-overlay-${kind}${open ? " is-open" : ""}`}
                 onMouseEnter={() => hoverDirectory(kind, true)} onMouseLeave={() => hoverDirectory(kind, false)}>
                {directory}
            </div>
            <div className="review-workspace-document" onMouseDown={() => {
                if (kind === "requirement" || !tracePopoverNodeIdRef.current) setOpen(false)
            }}>{documentPane}</div>
        </div>
    };
    const normalizedSearch = reviewSearch.trim().toLowerCase();
    const visibleReviewItems = reviewItems.filter(item => {
        if (reviewFilter === "reviewed" && !item.review) return false;
        if (reviewFilter === "pending" && item.review) return false;
        return !normalizedSearch || `${item.number} ${item.title}`.toLowerCase().includes(normalizedSearch)
    });
    const reviewGroups = [
        {key: "other", title: "其他章节", match: (number: string) => /^(1|2)(\.|$)/.test(number)},
        {key: "hardware", title: "硬件接口", match: (number: string) => /^3\.1(?:\.|$)/.test(number)},
        {key: "functional", title: "功能需求", match: (number: string) => /^4\.1(?:\.|$)/.test(number)},
        {key: "nonfunctional", title: "非功能需求", match: (number: string) => /^4\.[2-9](?:\.|$)/.test(number)}
    ].map(group => ({...group, items: visibleReviewItems.filter(item => group.match(item.number))}))
        .filter(group => group.items.length);
    const gotoReviewItem = (targetId: string) => {
        setReviewCenterOpen(false);
        gotoRequirement(targetId)
    };
    const evaluateReviewItem = (targetId: string) => {
        if (!openEvaluation(targetId)) return;
        setReviewCenterOpen(false);
        gotoRequirement(targetId)
    };
    const handleReviewExport = () => {
        if (pendingCount) {
            setReviewFilter("pending");
            setReviewSearch("");
            setPendingAttention(true);
            return
        }
        exportReport.mutate()
    };
    const exportActions = <Space>
        <Button ghost icon={<DownloadOutlined/>} loading={downloadRequirements.isPending}
                onClick={() => downloadRequirements.mutate()}>下载第三方测试需求</Button>
        <Button className={pendingCount ? "review-center-trigger is-pending" : "review-center-trigger is-complete"}
                icon={pendingCount ? <ExportOutlined/> : <CheckCircleFilled/>}
                onClick={() => {
                    setPendingAttention(false);
                    setReviewCenterOpen(true)
                }}>评审中心 {reviewedCount}/{reviewItems.length}</Button>
    </Space>;
    return <Shell backTo={`/projects/${id}`} actions={exportActions}>{reviewMessageContext}<Layout className="review trace-review">
        <div className="review-splitter-reset review-main-reset" onDoubleClick={event => {
            if ((event.target as HTMLElement).closest(".review-splitter-reset") === event.currentTarget && (event.target as HTMLElement).closest(".ant-splitter-bar")) {
                setMainSizes(["50%", "50%"]);
                localStorage.removeItem(splitStorageKey("main"))
            }
        }}>
            <Splitter className="review-main-splitter" onResize={setMainSizes}
                      onResizeEnd={persist("main", setMainSizes, 80, true)}>
                <Splitter.Panel size={mainSizes?.[0]} defaultSize="50%" min={0}
                                collapsible={{end: true, showCollapsibleIcon: true}}>
                    {workspace("source", sourceDirectory, sourceDocument)}
                </Splitter.Panel>
                <Splitter.Panel size={mainSizes?.[1]} defaultSize="50%" min={0}
                                collapsible={{start: true, showCollapsibleIcon: true}}>
                    {workspace("requirement", requirementDirectory, requirementDocument)}
                </Splitter.Panel>
            </Splitter>
        </div>
        <EvaluationWindow open={evalOpen} loading={saveReview.isPending}
                          subject={evaluationTarget ? `${evaluationTarget.number ? `${evaluationTarget.number} ` : ""}${evaluationTarget.title}` : undefined}
                          onSubjectClick={evaluationTargetId ? () => gotoRequirement(evaluationTargetId) : undefined}
                          onCancel={() => setEvalOpen(false)}
                          onSave={() => saveReview.mutate()}>
            <Evaluation scores={scores} setScores={setScores} comment={reviewComment} setComment={setReviewComment}/>
            {saveReview.error &&
                <Alert type="error" showIcon message="评估保存失败" description={saveReview.error.message}/>}
            <div className="evaluation-summary"><Typography.Title level={3}>{total.toFixed(2)} /
                5.0</Typography.Title><Tag
                color={total >= 4.5 ? "green" : total >= 3.5 ? "blue" : total >= 2.5 ? "orange" : "red"}>{grade}</Tag>
            </div>
        </EvaluationWindow>
        <Drawer className="review-center-drawer" width={520} title="评审中心" open={reviewCenterOpen}
                onClose={() => setReviewCenterOpen(false)}
                footer={<Button block type={pendingCount ? "default" : "primary"} icon={<ExportOutlined/>}
                                loading={exportReport.isPending} onClick={handleReviewExport}>
                    {pendingCount ? `还需完成 ${pendingCount} 项评审` : "导出评审报告"}
                </Button>}>
            <div className="review-center-summary">
                <div><b>{reviewPercent}%</b><span>总体完成率</span></div>
                <div><b>{reviewedCount}</b><span>已评</span></div>
                <div><b>{pendingCount}</b><span>待评</span></div>
            </div>
            <Progress percent={reviewPercent} status={pendingCount ? "active" : "success"}/>
            <div className="review-center-tools">
                <Space.Compact block>
                    {(["all", "reviewed", "pending"] as const).map(filter => <Button key={filter}
                        type={reviewFilter === filter ? "primary" : "default"} onClick={() => {
                        setReviewFilter(filter);
                        setPendingAttention(false)
                    }}>{filter === "all" ? "全部" : filter === "reviewed" ? "已评" : `待评 ${pendingCount}`}</Button>)}
                </Space.Compact>
                <Input allowClear value={reviewSearch} placeholder="搜索章节号或标题"
                       onChange={event => setReviewSearch(event.target.value)}/>
            </div>
            {reviewGroups.length ? <div className="review-center-groups">{reviewGroups.map(group =>
                <section key={group.key} className="review-center-group">
                    <h3>{group.title}<Tag>{group.items.length}</Tag></h3>
                    {group.items.map(item => <div key={item.id}
                        className={`review-center-item${item.review ? " is-reviewed" : " is-pending"}${pendingAttention && !item.review ? " needs-attention" : ""}`}
                        onClick={() => gotoReviewItem(item.id)}>
                        <div className="review-center-item-main">
                            <div className="review-center-item-title"><span>{item.number || "未编号"}</span>{item.title}</div>
                            {item.review ? <div className="review-center-item-meta">
                                <Tag color="blue">{item.review.weightedScore.toFixed(2)}</Tag>
                                <Tag color={item.review.grade === "优秀" ? "green" : item.review.grade === "良好" ? "blue" : item.review.grade === "合格" ? "orange" : "red"}>{item.review.grade}</Tag>
                                {item.review.comment && <Tooltip title={item.review.comment}
                                    overlayClassName="review-center-comment-tooltip">
                                    <span className="review-center-comment">{item.review.comment}</span>
                                </Tooltip>}
                            </div> : <Tag color="orange">待评</Tag>}
                        </div>
                        <Button className="review-center-item-action" size="small"
                                type={item.review ? "default" : "primary"} onClick={event => {
                            event.stopPropagation();
                            evaluateReviewItem(item.id)
                        }}>{item.review ? "查看/修改" : "开始评估"}</Button>
                    </div>)}
                </section>)}</div> : <Empty description="没有符合条件的评审项"/>}
        </Drawer>
    </Layout></Shell>
}

function Evaluation({scores, setScores, comment, setComment}: {
    scores: ReviewScores;
    setScores: (scores: ReviewScores) => void;
    comment: string;
    setComment: (comment: string) => void
}) {
    const dimensions: { key: keyof ReviewScores; label: string }[] = [
        {key: "correctness", label: "准确性 40%"},
        {key: "coverage", label: "覆盖性 35%"},
        {key: "testability", label: "可测试性 25%"}
    ];
    return <div className="evaluation-form">{dimensions.map(item => <div className="evaluation-form-row" key={item.key}>
        <b>{item.label}</b><Slider min={1} max={5} marks={{1: "1", 2: "2", 3: "3", 4: "4", 5: "5"}}
                                   value={scores[item.key]}
                                   onChange={value => setScores({...scores, [item.key]: value})}/></div>)}
        <div className="evaluation-comment"><b>测试人员提出的问题、修改建议</b><Input.TextArea rows={5} maxLength={2000}
                                                                                              showCount value={comment}
                                                                                              onChange={event => setComment(event.target.value)}
                                                                                              placeholder="请填写需要修改、补充或澄清的内容（可选）"/>
        </div>
    </div>
}

export function App() {
    const qc = useQueryClient(), [sessionStatus, setSessionStatus] = useState<SessionStatus>("ready");
    const me = useQuery({queryKey: ["me"], queryFn: () => api<CurrentUser>("/auth/me"), retry: false});
    useEffect(() => subscribeSessionStatus(setSessionStatus), []);
    useEffect(() => {
        // 登录成功会同步写入认证标记；即使React队列里仍残留一次旧的expired通知，
        // 也不能再清空刚写入的当前用户，避免首次登录闪回登录页。
        if (sessionStatus === "expired" && !hasActiveAuthenticationMarker()) qc.setQueryData(["me"], null)
    }, [qc, sessionStatus]);
    useEffect(() => {
        if (!me.data) return;
        let active = true;
        const refresh = () => recoverSession().then(user => {
            if (active) qc.setQueryData(["me"], user)
        }).catch(() => undefined);
        const timer = window.setInterval(refresh, 25 * 60 * 1000);
        const onVisible = () => {
            if (document.visibilityState === "visible") void refresh()
        };
        const onOnline = () => void refresh();
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("online", onOnline);
        return () => {
            active = false;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("online", onOnline)
        }
    }, [me.data?.id, qc]);
    if (me.isLoading) return <Spin fullscreen/>;
    return <>{sessionStatus === "recovering" && <Alert className="session-recovery-banner" type="info" showIcon
        message="正在恢复登录状态"/>}<Routes><Route path="/login" element={<Login/>}/><Route path="/" element={me.data ? <Projects/> :
        <Navigate to="/login"/>}/><Route path="/projects/:id"
                                         element={me.data ? <ProjectPage/> : <Navigate to="/login"/>}/><Route
        path="/projects/:id/review" element={me.data ? <Review/> : <Navigate to="/login"/>}/></Routes></>
}
