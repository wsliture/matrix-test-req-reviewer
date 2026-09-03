import "dotenv/config";
import {Queue, Worker} from "bullmq";
import {Redis} from "ioredis";
import {Pool} from "pg";
import {createOpencodeClient, type Event, type ToolPart} from "@opencode-ai/sdk/v2";
import {access, readFile, stat} from "node:fs/promises";
import path from "node:path";
import {missingCompletionStages, parseToolOutput, progressOf} from "./progress.js";
import {indexProject} from "./indexing.js";
import {startPhase2EditWorker} from "./phase2-edit.js";
import {createRequirementRevision, removeRequirementRevision} from "./requirement-revisions.js";

const connection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {maxRetriesPerRequest: null}),
    db = new Pool({connectionString: process.env.DATABASE_URL}),
    phase2Queue = new Queue("phase2", {connection});
const auth = Buffer.from(`${process.env.OPENCODE_USERNAME || "opencode"}:${process.env.OPENCODE_PASSWORD || ""}`).toString("base64");
const client = createOpencodeClient({
    baseUrl: process.env.OPENCODE_URL || "http://localhost:4096",
    headers: {Authorization: `Basic ${auth}`}
});

const STAGE_ARTIFACTS: Record<string, string> = {
    finalize_chapter1_scope: "chapter1-scope.json",
    finalize_chapter2_system_overview: "chapter2-system-overview.json",
    finalize_hardware_interface: "hardware-interface-model.json",
    finalize_functional_test_content: "functional-test-content.json",
    finalize_performance_test_content: "performance-test-content.json",
    finalize_interface_test_content: "interface-test-content.json",
    finalize_reliability_safety_test_content: "reliability-safety-test-content.json",
    finalize_margin_test_content: "margin-test-content.json",
    finalize_boundary_test_content: "boundary-test-content.json",
    finalize_data_processing_test_content: "data-processing-test-content.json",
    finalize_recovery_test_content: "recovery-test-content.json",
    finalize_strength_test_content: "strength-test-content.json",
    generate_phase2_traceability: "phase2-test-traceability.json"
};
async function configuredModel() {
    const configPath = process.env.OPENCODE_CONFIG_PATH || "/opencode-config/opencode.json";
    try {
        const config = JSON.parse(await readFile(configPath, "utf8")) as {model?: unknown};
        return typeof config.model === "string" && config.model.trim()
            ? config.model.trim()
            : "OpenCode默认模型"
    } catch {
        return "OpenCode当前配置模型"
    }
}

async function event(runId: string, type: string, payload: unknown) {
    await db.query('insert into "RunEvent" ("runId","type","payload") values ($1,$2,$3)', [runId, type, JSON.stringify(payload)])
}

async function update(runId: string, data: {
    status?: string;
    stage?: string;
    progress?: number;
    session?: string;
    error?: string;
    completed?: Set<string>
}) {
    const fields: string[] = [], values: unknown[] = [];
    const add = (column: string, value: unknown) => {
        values.push(value);
        fields.push(`"${column}"=$${values.length}`)
    };
    if (data.status) add("status", data.status);
    if (data.stage !== undefined) add("currentStage", data.stage);
    if (data.progress !== undefined) add("progress", data.progress);
    if (data.session) add("opencodeSessionId", data.session);
    if (data.error) add("errorMessage", data.error);
    if (data.completed) add("completedStages", JSON.stringify([...data.completed]));
    if (data.status === "RUNNING") add("startedAt", new Date());
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(data.status || "")) add("finishedAt", new Date());
    values.push(runId);
    await db.query(`update "Phase2Run"
                    set ${fields.join(",")}
                    where id = $${values.length}`, values)
}

async function claim(runId: string) {
    const result = await db.query('update "Phase2Run" set status=$1,"startedAt"=$2 where id=$3 and status=$4 returning id', ["RUNNING", new Date(), runId, "QUEUED"]);
    return result.rowCount === 1
}

async function cancelled(runId: string) {
    const result = await db.query('select status from "Phase2Run" where id=$1', [runId]);
    return result.rows[0]?.status === "CANCELLED"
}

async function project(runId: string) {
    const result = await db.query('select p.id,p."workspacePath",r."completedStages" from "Project" p join "Phase2Run" r on r."projectId"=p.id where r.id=$1', [runId]);
    if (!result.rows[0]) throw new Error("任务项目不存在");
    return result.rows[0] as { id: string; workspacePath: string; completedStages: unknown }
}

async function verify(workspace: string) {
    const report = path.join(workspace, ".matrix", "reports", "phase2-test-requirements.docx");
    await access(report);
    if ((await stat(report)).size === 0) throw new Error("最终Phase 2 DOCX为空")
}

async function verifyStageArtifact(workspace: string, stage: string) {
    const artifact = STAGE_ARTIFACTS[stage];
    if (!artifact) return;
    const file = path.join(workspace, ".matrix", "data", artifact);
    try {
        JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
        throw new Error(`${stage}: 最终工件 ${artifact} 不存在或不是有效JSON（${error instanceof Error ? error.message : String(error)}）`)
    }
}

async function consume(runId: string, sessionId: string, directory: string, completed: Set<string>, signal: AbortSignal) {
    const subscription = await client.event.subscribe({directory});
    for await(const item of subscription.stream) {
        if (signal.aborted) return;
        const e = item as Event;
        if (e.type === "message.part.updated") {
            const part = e.properties.part;
            if (part.type !== "tool" || part.sessionID !== sessionId || part.tool !== "filldata_phase2_workflow") continue;
            await handleTool(runId, part, completed, directory)
        } else if (e.type === "session.error" && e.properties.sessionID === sessionId) throw new Error(JSON.stringify(e.properties.error || "OpenCode会话错误")); else if (e.type === "session.idle" && e.properties.sessionID === sessionId) return
    }
}

async function sessionStopSummary(sessionId: string, directory: string) {
    try {
        const response = await client.session.messages({sessionID: sessionId, directory, limit: 10});
        const messages = response.data || [];
        for (let index = messages.length - 1; index >= 0; index--) {
            if (messages[index].info.role !== "assistant") continue;
            const text = messages[index].parts
                .filter(part => part.type === "text")
                .map(part => part.text)
                .join("\n")
                .replace(/\s+/g, " ")
                .trim();
            if (text) return text.slice(0, 500)
        }
    } catch {
    }
    return "OpenCode会话已结束，但未完成全部Phase 2最终阶段"
}

async function handleTool(runId: string, part: ToolPart, completed: Set<string>, workspace: string) {
    const mode = String(part.state.input.mode || "");
    const batchIndex = mode === "get_functional_other_content_worker_batch"
        ? Number(part.state.input.functional_other_content_worker_batch_index)
        : undefined;
    const stage = Number.isInteger(batchIndex) && batchIndex! > 0 ? `${mode}:${batchIndex}` : mode;
    if (part.state.status === "running") {
        await update(runId, {stage});
        await event(runId, "stage.running", {mode, batchIndex});
        return
    }
    if (part.state.status === "error") throw new Error(`${mode}: ${part.state.error}`);
    if (part.state.status !== "completed") return;
    const output = parseToolOutput(part.state.output);
    if (output.ok !== true) throw new Error(`${mode}: ${output.error || "业务执行失败"}`);
    const actual = output.mode || mode;
    await verifyStageArtifact(workspace, actual);
    completed.add(actual);
    const progress = progressOf(completed);
    const completedStage = Number.isInteger(batchIndex) && batchIndex! > 0 ? `${actual}:${batchIndex}` : actual;
    await update(runId, {stage: completedStage, progress, completed});
    await event(runId, "stage.completed", {
        mode: actual,
        batchIndex,
        progress,
        summary: output.summary,
        output: output.output
    })
}

new Worker("phase2", async job => {
    const runId = String(job.data.runId), p = await project(runId),
        completed = new Set<string>(Array.isArray(p.completedStages) ? p.completedStages.map(String) : []),
        abort = new AbortController();
    let generatedBaselineId = "";
    if (!await claim(runId)) return {cancelled: true};
    await event(runId, "run.started", {projectId: p.id});
    try {
        await event(runId, "model.selected", {model: await configuredModel()});
        if (await cancelled(runId)) return {cancelled: true};
        const created = await client.session.create({directory: p.workspacePath, title: `Phase 2 ${p.id}`});
        if (!created.data) throw new Error("创建OpenCode会话失败");
        const sessionId = created.data.id;
        await update(runId, {session: sessionId});
        if (await cancelled(runId)) {
            await client.session.abort({sessionID: sessionId, directory: p.workspacePath}).catch(() => undefined);
            return {cancelled: true}
        }
        await event(runId, "session.created", {sessionId});
        const eventTask = consume(runId, sessionId, p.workspacePath, completed, abort.signal);
        await event(runId, "command.started", {command: "/matrix-phase2"});
        await client.session.command({
            sessionID: sessionId,
            directory: p.workspacePath,
            command: "matrix-phase2",
            arguments: ""
        });
        await eventTask;
        const missingStages = missingCompletionStages(completed);
        if (missingStages.length) {
            const summary = await sessionStopSummary(sessionId, p.workspacePath);
            throw new Error(`Phase 2工作流提前结束，仅完成：${[...completed].join(", ") || "无"}。${summary}`)
        }
        await verify(p.workspacePath);
        if (await cancelled(runId)) return {cancelled: true};
        await indexProject(db, p.id, p.workspacePath);
        const baseline: any = await createRequirementRevision(db, {projectId: p.id, workspace: p.workspacePath, kind: "GENERATED_BASELINE"});
        generatedBaselineId = baseline.revisionId || "";
        await update(runId, {status: "SUCCEEDED", progress: 100, stage: "finalize_phase2_document", completed});
        await db.query('update "Project" set status=$1,"missingArtifacts"=$2,"updatedAt"=now() where id=$3', ["READY_FOR_REVIEW", JSON.stringify([]), p.id]);
        await event(runId, "run.succeeded", {});
        return {ok: true}
    } catch (error) {
        abort.abort();
        if (generatedBaselineId) await removeRequirementRevision(db, generatedBaselineId).catch(() => undefined);
        if (await cancelled(runId)) return {cancelled: true};
        const message = error instanceof Error ? error.message : String(error);
        await update(runId, {status: "FAILED", error: message, completed});
        await db.query('update "Project" set status=$1,"updatedAt"=now() where id=$2', ["FAILED", p.id]);
        await event(runId, "run.failed", {message});
        throw error
    }
}, {
    connection,
    concurrency: +(process.env.PHASE2_CONCURRENCY || 2)
}).on("error", error => console.error("Phase2 worker error", error));

new Worker("document-index", async job => {
    const {projectId, workspacePath} = job.data as { projectId: string; workspacePath: string };
    await indexProject(db, projectId, workspacePath);
    return {ok: true}
}, {connection, concurrency: 2}).on("error", error => console.error("Document index worker error", error));

startPhase2EditWorker(connection, db).on("error", error => console.error("Phase2 edit worker error", error));

setTimeout(async () => {
    try {
        const projects = await db.query(`select p.id,p."workspacePath" from "Project" p where
            not exists (select 1 from "DocumentNode" n join "Document" d on d.id=n."documentId" where d."projectId"=p.id)
            or not exists (select 1 from "TestRequirementNode" n where n."projectId"=p.id and n."nodeType"='requirement' and n.artifact='performance-test-content.json')`);
        for (const item of projects.rows) await indexProject(db, item.id, item.workspacePath)
    } catch (error) {
        console.error("Existing project indexing failed", error)
    }
}, 5000);

setTimeout(async () => {
    try {
        const staleRuns = await db.query('select id,"projectId" from "Phase2Run" where status=$1', ["RUNNING"]);
        for (const run of staleRuns.rows) {
            await db.query('update "Phase2Run" set status=$1,"opencodeSessionId"=null,"finishedAt"=null where id=$2 and status=$3', ["QUEUED", run.id, "RUNNING"]);
            await event(run.id, "run.resumed", {reason: "Worker重启，复用已有Raw工件继续执行"});
            await phase2Queue.add("matrix-phase2-resume", {runId: run.id, projectId: run.projectId}, {
                jobId: `${run.id}-resume-${Date.now()}`,
                removeOnComplete: 100,
                removeOnFail: 100
            })
        }
    } catch (error) {
        console.error("Stale Phase2 run recovery failed", error)
    }
}, 2000);

setTimeout(async () => {
    try {
        const stale = await db.query(`select id,"projectId","backupPath" from "Phase2EditRun" where status='RUNNING'`);
        for (const run of stale.rows) {
            await db.query(`update "Phase2EditRun" set status='FAILED',"errorMessage"='编辑worker重启，任务已停止；备份保留供诊断',"finishedAt"=now() where id=$1`, [run.id]);
            await db.query(`update "Project" set status='READY_FOR_REVIEW',"updatedAt"=now() where id=$1 and status='REBUILDING'`, [run.projectId])
        }
    } catch (error) { console.error("Stale Phase2 edit recovery failed", error) }
}, 2500);
