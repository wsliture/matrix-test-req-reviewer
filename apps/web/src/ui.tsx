import {useEffect, useMemo, useState} from "react";
import {
    Alert,
    Badge,
    Button,
    Card,
    Col,
    Descriptions,
    Divider,
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
    Tree,
    Tooltip,
    Typography,
    Upload
} from "antd";
import {ArrowLeftOutlined, CheckCircleFilled, CloseCircleFilled, DeleteOutlined, FileZipOutlined, LogoutOutlined, PlusOutlined, StopOutlined} from "@ant-design/icons";
import {Navigate, Route, Routes, useNavigate, useParams} from "react-router-dom";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {api, ApiError, type DocumentNode, type Phase2Run, type Project, type RequirementNode, type ReviewData, type RunEvent, type TraceLink} from "./api";
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
    } catch { return undefined }
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
            password: string
        }) => api("/auth/login", {method: "POST", body: JSON.stringify(v)}), onSuccess: user => {
            qc.setQueryData(["me"], user);
            nav("/", {replace: true})
        }
    });
    return <div className="login"><Card title="测试需求管理工具" style={{width: 420}}><Form layout="vertical"
                                                                                            onFinish={v => login.mutate(v)}><Form.Item
        name="username" label="用户名" rules={[{required: true}]}><Input/></Form.Item><Form.Item name="password"
                                                                                                 label="密码"
                                                                                                 rules={[{required: true}]}><Input.Password/></Form.Item>{login.error &&
        <Alert type="error" message={login.error.message}/>}<Button block type="primary" htmlType="submit"
                                                                    loading={login.isPending}>登录</Button></Form></Card>
    </div>
}

function Shell({children, backTo}: { children: React.ReactNode; backTo?: string }) {
    const nav = useNavigate(), qc = useQueryClient();
    return <Layout className="shell"><Header className="header"><b>Matrix测试需求管理</b>{backTo &&
        <Button ghost icon={<ArrowLeftOutlined/>} onClick={() => nav(backTo)}>返回项目</Button>}<span className="grow"/><Button
        ghost icon={<LogoutOutlined/>} onClick={async () => {
        await api("/auth/logout", {method: "POST"});
        qc.setQueryData(["me"], null);
        nav("/login", {replace: true})
    }}>退出</Button></Header>{children}</Layout>
}

function Projects() {
    const qc = useQueryClient(), nav = useNavigate(), query = useQuery({
        queryKey: ["projects"],
        queryFn: () => api<Project[]>("/projects")
    }), [open, setOpen] = useState(false), upload = useMutation({
        mutationFn: async (file: File) => {
            const form = new FormData();
            form.append("file", file);
            return api<Project>("/projects/import", {method: "POST", body: form})
        }, onSuccess: p => {
            setOpen(false);
            qc.invalidateQueries({queryKey: ["projects"]});
            message.success("项目导入完成");
            location.href = `/projects/${p.id}`
        }
    }), remove = useMutation({
        mutationFn: (id: string) => api<{id: string}>(`/projects/${id}`, {method: "DELETE"}),
        onSuccess: () => {
            qc.invalidateQueries({queryKey: ["projects"]});
            nav("/", {replace: true});
            message.success("项目已删除")
        },
        onError: error => message.error(error.message)
    });
    return <Shell><Content className="page"><Space
        style={{width: "100%", justifyContent: "space-between"}}><Typography.Title level={3}>项目列表</Typography.Title><Button
        type="primary" icon={<PlusOutlined/>} onClick={() => setOpen(true)}>导入项目</Button></Space><Row
        gutter={[16, 16]}>{query.data?.map(p => <Col xs={24} md={12} xl={8} key={p.id}><Card hoverable title={p.name}
                                                                                             onClick={() => location.href = `/projects/${p.id}`}
                                                                                             extra={<div data-project-action onClick={event => event.stopPropagation()}><Space><Status
                                                                                                 value={p.status}/><Popconfirm title="删除项目"
                                                                                                 description="将永久删除项目、源文档、生成工件和评审记录，是否继续？"
                                                                                                 okText="删除" cancelText="取消"
                                                                                                 okButtonProps={{danger: true}}
                                                                                                 onConfirm={() => remove.mutate(p.id)}><Button
                                                                                                 danger type="text" icon={<DeleteOutlined/>}
                                                                                                 loading={remove.isPending && remove.variables === p.id}
                                                                                                 onClick={event => event.stopPropagation()}/></Popconfirm></Space></div>}>
        <p>创建时间：{localMinute(p.createdAt)}</p><p>最新任务：{p.runs[0]?.status || "无"}</p><Progress
        percent={p.runs[0]?.progress || 0}/></Card></Col>)}</Row><Modal open={open} title="上传源文档压缩包"
                                                                        footer={null}
                                                                        onCancel={() => setOpen(false)}><Upload.Dragger
        accept=".zip" maxCount={1} beforeUpload={file => {
        upload.mutate(file);
        return false
    }}><p><FileZipOutlined className="upload-icon"/></p><p>上传“源文档”或“源文档 + .matrix”ZIP压缩包</p>
    </Upload.Dragger>{upload.isPending && <Spin/>}{upload.error && <Alert type="error" message={upload.error.message}/>}
    </Modal></Content></Shell>
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
    if (item.type === "model.selected") return `使用模型：${String(item.payload.name || item.payload.model || "DeepSeek V4 Flash")}`;
    if (item.type === "session.created") return "OpenCode会话创建成功";
    if (item.type === "command.started") return "已提交测试需求生成命令";
    if (item.type === "stage.running") return `开始：${stage}`;
    if (item.type === "stage.completed") return `完成：${stage}`;
    if (item.type === "run.succeeded") return "测试需求生成完成";
    if (item.type === "run.cancelled") return "用户已终止测试需求生成";
    if (item.type === "run.failed") return `生成失败：${String(item.payload.message || "未知错误")}`;
    return item.type
}

function RunLogs({run, onEvents}: {run?: Phase2Run; onEvents: () => void}) {
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
            return () => { active = false }
        }
        setConnection("正在连接实时日志");
        const source = new EventSource(`/api/phase2-runs/${run.id}/events`, {withCredentials: true});
        source.addEventListener("run-events", raw => {
            const rows = JSON.parse((raw as MessageEvent).data) as RunEvent[];
            if (rows.length) {
                merge(rows);
                onEvents()
            }
            setConnection("实时日志已连接")
        });
        source.onerror = () => setConnection("连接中断，正在自动重连");
        return () => {
            active = false;
            source.close()
        }
    }, [run?.id, run?.status]);
    return <Card size="small" title="实时运行日志" extra={<Tag>{connection}</Tag>} className="run-log-card">
        {events.length ? <List size="small" dataSource={events} renderItem={item => <List.Item className={`run-log ${item.type === "run.failed" ? "error" : item.type.endsWith("succeeded") || item.type === "stage.completed" ? "success" : "info"}`}>
            <span className="run-log-time">{localMinute(item.createdAt)}</span><span>{eventText(item)}</span>
        </List.Item>}/> : <div className="run-log-empty">正在等待任务启动...</div>}
    </Card>
}

function ChapterStatus({project, run}: {project: Project; run?: Phase2Run}) {
    const completed = new Set(run?.completedStages || []), missing = new Set(project.missingArtifacts || []), failed = run?.status === "FAILED";
    return <Card title="章节生成状态" className="chapter-status"><Row gutter={[12, 12]}>{CHAPTERS.map(([name, stage, artifact]) => {
        const ready = run ? completed.has(stage) : !missing.has(artifact);
        return <Col xs={24} md={12} xl={8} key={stage}><div className="chapter-status-row"><span>{name}</span>{ready ?
            <CheckCircleFilled className="chapter-ok" title="已成功生成"/> :
            <CloseCircleFilled className={failed ? "chapter-failed" : "chapter-pending"} title={failed ? "未生成" : "尚未生成"}/>}</div></Col>
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
        const expired = query.error instanceof ApiError && query.error.status === 401;
        return <Shell><Content className="page"><Alert type="warning" showIcon
            message={expired ? "登录已过期" : "项目不存在或已被删除"}
            description={expired ? "请重新登录后继续使用。" : query.error.message}
            action={<Button type="primary" onClick={() => {
                if (expired) qc.setQueryData(["me"], null);
                nav(expired ? "/login" : "/", {replace: true})
            }}>{expired ? "返回登录界面" : "返回项目列表"}</Button>}/></Content></Shell>
    }
    if (!query.data) return <Shell><Spin/></Shell>;
    const p = query.data, latest = p.runs[0];
    const running = latest?.status === "RUNNING" || latest?.status === "QUEUED";
    return <Shell><Content className="page"><Space><Button onClick={() => nav("/")}>返回</Button><Typography.Title
        level={3}>{p.name}</Typography.Title><Status value={p.status}/></Space><ChapterStatus project={p} run={latest}/>
        {p.status === "READY_FOR_REVIEW" && <Button type="primary" onClick={() => nav(`/projects/${id}/review`)}>进入评审</Button>}
        <Card title="Phase 2测试需求生成"><Progress percent={latest?.progress || 0}
                                                    status={latest?.status === "FAILED" ? "exception" : running ? "active" : "normal"}/>
            <p>当前阶段：{latest?.status === "CANCELLED" ? "已终止" : latest?.currentStage ? stageName(latest.currentStage) : running ? "任务启动中" : latest?.status === "FAILED" ? "生成失败" : "尚未开始"}</p>
            {latest?.errorMessage && <Alert type="error" showIcon message="测试需求生成失败" description={latest.errorMessage}/>}<Button type="primary"
                loading={run.isPending} disabled={running} onClick={() => run.mutate()}>{running ? "正在生成测试需求" : "开始生成测试需求"}</Button>
            {running && latest && <Popconfirm title="终止测试需求生成？"
                                                   description="终止后保留已完成阶段工件，并可重新开始生成。"
                                                   okText="终止" cancelText="继续运行" okButtonProps={{danger: true}}
                                                   onConfirm={() => cancel.mutate(latest.id)}><Button danger
                                                                                                           icon={<StopOutlined/>}
                                                                                                           loading={cancel.isPending}>终止生成</Button></Popconfirm>}
            {latest?.status === "CANCELLED" && <Alert type="info" showIcon message="测试需求生成已终止"/>}
            {(run.error || cancel.error) && <Alert type="error" showIcon message={(run.error || cancel.error)?.message}/>}<RunLogs run={latest} onEvents={() => qc.invalidateQueries({queryKey: ["project", id]})}/>
        </Card></Content></Shell>
}

type TreeItem = {key: string; title: React.ReactNode; children?: TreeItem[]};

function treeOf<T extends {id: string; parentId?: string | null; orderIndex: number}>(nodes: T[], title: (node: T) => React.ReactNode): TreeItem[] {
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
    const {id = ""} = useParams(), [documentId, setDocumentId] = useState<string>(), [evalOpen, setEvalOpen] = useState(false), [scores, setScores] = useState([4, 4, 4, 4]),
        {activeSourceNodeId, activeRequirementId, setSource, setRequirement} = useTraceStore(), data = useQuery({queryKey: ["review-data", id], queryFn: () => api<ReviewData>(`/projects/${id}/review-data`), retry: false}),
        trace = useQuery({queryKey: ["trace-links", id, activeSourceNodeId], queryFn: () => api<TraceLink[]>(`/projects/${id}/trace-links?sourceNodeId=${activeSourceNodeId}&includeDescendants=true`), enabled: Boolean(activeSourceNodeId)});
    const [tracePopoverNodeId, setTracePopoverNodeId] = useState<string>();
    const [mainSizes, setMainSizes] = useState<SplitSizes | undefined>(() => loadSplitSizes("main"));
    const [sourceSizes, setSourceSizes] = useState<SplitSizes | undefined>(() => loadSplitSizes("source-directory"));
    const [requirementSizes, setRequirementSizes] = useState<SplitSizes | undefined>(() => loadSplitSizes("requirement-directory"));
    useEffect(() => { if (!documentId && data.data?.documents[0]) setDocumentId(data.data.documents[0].id) }, [data.data, documentId]);
    const selectedDocument = data.data?.documents.find(item => item.id === documentId), requirements = data.data?.requirements || [], selectedRequirement = requirements.find(item => item.id === activeRequirementId) || requirements[0],
        sourceCounts = useMemo(() => new Map((data.data?.links || []).map(link => link.sourceNodeId).map((sourceId, _, all) => [sourceId, all.filter(item => item === sourceId).length])), [data.data?.links]),
        requirementTree = useMemo(() => treeOf(requirements.filter(node => node.nodeType !== "requirement"), node => <span>{node.number ? `${node.number} ` : ""}{node.title}</span>), [requirements]);
    useEffect(() => { if (!activeRequirementId && requirements[0]) setRequirement(requirements[0].id) }, [requirements, activeRequirementId]);
    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setTracePopoverNodeId(undefined) };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape)
    }, []);
    const gotoRequirement = (targetId: string) => {
            setTracePopoverNodeId(undefined);
            setRequirement(targetId);
            setTimeout(() => window.document.getElementById(`requirement-${targetId}`)?.scrollIntoView({behavior: "smooth", block: "start"}), 0)
        },
        gotoSource = (link: TraceLink) => { setDocumentId(link.sourceNode.document?.id); setSource(link.sourceNodeId) },
        total = scores[0] * .35 + scores[1] * .25 + scores[2] * .2 + scores[3] * .2;
    const uniqueTraceLinks = [...new Map((trace.data || []).map(link => [link.targetNodeId, link])).values()],
        sectionLinks = uniqueTraceLinks.filter(link => link.targetNode.nodeType !== "requirement"),
        requirementLinks = uniqueTraceLinks.filter(link => link.targetNode.nodeType === "requirement"),
        traceGroup = (title: string, links: TraceLink[], compact = false) => links.length ? <section className="trace-popover-group"><b>{title}</b><List size="small" dataSource={links} renderItem={link => <List.Item onClick={() => gotoRequirement(link.targetNodeId)}>
            <div className={compact ? "trace-target trace-target-compact" : "trace-target"}>
                <span className="trace-target-number">{link.targetNode.number}</span>
                {compact ? <Tooltip title={link.targetNode.title}><span className="trace-target-summary">{link.targetNode.title}</span></Tooltip> : <span>{link.targetNode.title}</span>}
            </div>{link.direct ? <Tag color="green">直接</Tag> : <Tag>子章节</Tag>}
        </List.Item>}/></section> : null,
        traceContent = <div className="trace-popover-content">{trace.isLoading ? <Spin/> : uniqueTraceLinks.length ? <>{traceGroup("测试章节", sectionLinks)}{traceGroup("测试需求TR", requirementLinks, true)}</> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前章节暂无追溯"/>}</div>,
        sourceTree = treeOf(selectedDocument?.nodes || [], node => <Popover open={tracePopoverNodeId === node.id} placement="rightTop" trigger="click" arrow autoAdjustOverflow getPopupContainer={() => window.document.body}
            overlayClassName="trace-popover" title={`${node.number && node.number !== "PREAMBLE" ? node.number : node.title} 的追溯关系`} content={traceContent}
            onOpenChange={open => {
                if (open) { setSource(node.id); setTracePopoverNodeId(node.id) }
                else if (tracePopoverNodeId === node.id) setTracePopoverNodeId(undefined)
            }}><span className="source-tree-title">{node.number && node.number !== "PREAMBLE" ? `${node.number} ` : ""}{node.title}{sourceCounts.get(node.id) ? <Badge count={sourceCounts.get(node.id)} className="trace-count"/> : null}</span></Popover>),
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
    if (data.error) return <Shell backTo={`/projects/${id}`}><Alert type="error" message="评审数据加载失败" description={data.error.message}/></Shell>;
    const sourceDirectory = <aside className="tree-pane review-tree-pane"><Typography.Title level={5}>源文档</Typography.Title>
        <Select style={{width: "100%"}} value={documentId} onChange={value => {setTracePopoverNodeId(undefined); setDocumentId(value); setSource(undefined)}} options={data.data?.documents.map(item => ({value: item.id, label: item.name}))}/>
        {selectedDocument?.parseStatus === "FAILED" && <Alert type="error" message="DOCX结构解析失败" description={selectedDocument.parseError}/>}<Tree blockNode showLine treeData={sourceTree} selectedKeys={activeSourceNodeId ? [activeSourceNodeId] : []} defaultExpandAll
            onExpand={(_, info) => { if (!info.expanded && tracePopoverNodeId && isInsideCollapsedNode(String(info.node.key), tracePopoverNodeId)) setTracePopoverNodeId(undefined) }}
            onSelect={keys => setSource(String(keys[0] || ""))}/>
    </aside>;
    const sourceDocument = <main className="document docx-pane review-document-pane"><DocxPreview documentId={documentId} nodes={selectedDocument?.nodes || []} activeNodeId={activeSourceNodeId} onNodeClick={setSource}/></main>;
    const requirementDirectory = <aside className="tree-pane review-tree-pane"><Typography.Title level={5}>测试需求目录</Typography.Title><Tree blockNode showLine treeData={requirementTree} selectedKeys={selectedRequirement ? [selectedRequirement.id] : []} defaultExpandAll onSelect={keys => gotoRequirement(String(keys[0] || ""))}/></aside>;
    const requirementDocument = <main className="document requirement-pane review-document-pane"><Phase2DocumentRenderer chapters={data.data?.phase2Document?.chapters || []} links={data.data?.links || []} activeId={selectedRequirement?.id} onSource={gotoSource} onEvaluate={targetId => {setRequirement(targetId); setEvalOpen(true)}}/></main>;
    const persist = (name: string, setter: (sizes: SplitSizes) => void, threshold: number, bothSides: boolean) => (sizes: number[]) => {
        const next = snappedSizes(sizes, threshold, bothSides);
        setter(next);
        saveSplitSizes(name, next)
    };
    const persistDirectory = (name: string, setter: (sizes: SplitSizes) => void) => (sizes: number[]) => {
        const next = [sizes[0] < 56 ? 0 : Math.min(480, Math.max(180, sizes[0]))];
        setter(next);
        saveSplitSizes(name, next)
    };
    return <Shell backTo={`/projects/${id}`}><Layout className="review trace-review">
        <div className="review-splitter-reset review-main-reset" onDoubleClick={event => {if ((event.target as HTMLElement).closest(".review-splitter-reset") === event.currentTarget && (event.target as HTMLElement).closest(".ant-splitter-bar")) {setMainSizes(["50%", "50%"]); localStorage.removeItem(splitStorageKey("main"))}}}>
            <Splitter className="review-main-splitter" onResize={setMainSizes} onResizeEnd={persist("main", setMainSizes, 80, true)}>
                <Splitter.Panel size={mainSizes?.[0]} defaultSize="50%" min={0} collapsible={{end: true, showCollapsibleIcon: true}}>
                    <div className="review-splitter-reset" onDoubleClick={event => {if ((event.target as HTMLElement).closest(".review-splitter-reset") === event.currentTarget && (event.target as HTMLElement).closest(".ant-splitter-bar")) {setSourceSizes([290]); localStorage.removeItem(splitStorageKey("source-directory"))}}}>
                        <Splitter className="review-inner-splitter" onResize={sizes => setSourceSizes([sizes[0]])} onResizeEnd={persistDirectory("source-directory", setSourceSizes)}>
                            <Splitter.Panel size={sourceSizes?.[0]} defaultSize={290} min={0} max={480} collapsible={{end: true, showCollapsibleIcon: true}}>{sourceDirectory}</Splitter.Panel>
                            <Splitter.Panel min={240}>{sourceDocument}</Splitter.Panel>
                        </Splitter>
                    </div>
                </Splitter.Panel>
                <Splitter.Panel size={mainSizes?.[1]} defaultSize="50%" min={0} collapsible={{start: true, showCollapsibleIcon: true}}>
                    <div className="review-splitter-reset" onDoubleClick={event => {if ((event.target as HTMLElement).closest(".review-splitter-reset") === event.currentTarget && (event.target as HTMLElement).closest(".ant-splitter-bar")) {setRequirementSizes([320]); localStorage.removeItem(splitStorageKey("requirement-directory"))}}}>
                        <Splitter className="review-inner-splitter" onResize={sizes => setRequirementSizes([sizes[0]])} onResizeEnd={persistDirectory("requirement-directory", setRequirementSizes)}>
                            <Splitter.Panel size={requirementSizes?.[0]} defaultSize={320} min={0} max={480} collapsible={{end: true, showCollapsibleIcon: true}}>{requirementDirectory}</Splitter.Panel>
                            <Splitter.Panel min={320}>{requirementDocument}</Splitter.Panel>
                        </Splitter>
                    </div>
                </Splitter.Panel>
            </Splitter>
        </div>
        <Modal open={evalOpen} title="内容质量评估" onCancel={() => setEvalOpen(false)} onOk={() => setEvalOpen(false)}><Evaluation scores={scores} setScores={setScores}/><Typography.Title level={3}>{total.toFixed(2)} / 5.0</Typography.Title></Modal>
    </Layout></Shell>
}

function Evaluation({scores, setScores}: { scores: number[]; setScores: (x: number[]) => void }) {
    return <>{["正确性 35%", "完整性 25%", "覆盖性 20%", "可测试性 20%"].map((name, i) => <div key={name}>
        <b>{name}</b><Slider min={1} max={5} value={scores[i]}
                             onChange={value => setScores(scores.map((x, j) => j === i ? value : x))}/></div>)}</>
}

export function App() {
    const me = useQuery({queryKey: ["me"], queryFn: () => api("/auth/me"), retry: false});
    if (me.isLoading) return <Spin fullscreen/>;
    return <Routes><Route path="/login" element={<Login/>}/><Route path="/" element={me.data ? <Projects/> :
        <Navigate to="/login"/>}/><Route path="/projects/:id"
                                         element={me.data ? <ProjectPage/> : <Navigate to="/login"/>}/><Route
        path="/projects/:id/review" element={me.data ? <Review/> : <Navigate to="/login"/>}/></Routes>
}
