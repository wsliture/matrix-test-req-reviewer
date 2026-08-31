import {Worker} from "bullmq";
import type {Redis} from "ioredis";
import type {Pool} from "pg";
import {cp, mkdir, rm, stat} from "node:fs/promises";
import path from "node:path";
import {indexProject} from "./indexing.js";

const auth = Buffer.from(`${process.env.OPENCODE_USERNAME || "opencode"}:${process.env.OPENCODE_PASSWORD || ""}`).toString("base64");
const baseUrl = process.env.MATRIX_PHASE2_RUNNER_URL || "http://localhost:4097";
const modeByArtifact: Record<string, string[]> = {
    "chapter1-scope.json": ["finalize_chapter1_scope"],
    "chapter2-system-overview.json": ["finalize_chapter2_system_overview"],
    "hardware-interface-model.json": ["finalize_hardware_interface"],
    "functional-test-content.json": ["finalize_functional_other_content", "finalize_functional_test_content"],
    "performance-test-content.json": ["finalize_performance_test_content"],
    "interface-test-content.json": ["finalize_interface_test_content"],
    "reliability-safety-test-content.json": ["finalize_reliability_safety_test_content"],
    "margin-test-content.json": ["finalize_margin_test_content"],
    "boundary-test-content.json": ["finalize_boundary_test_content"],
    "data-processing-test-content.json": ["finalize_data_processing_test_content"],
    "recovery-test-content.json": ["finalize_recovery_test_content"],
    "strength-test-content.json": ["finalize_strength_test_content"]
};

async function call<T = any>(endpoint: string, body: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${endpoint}`, {method: "POST", headers: {"Content-Type": "application/json", Authorization: `Basic ${auth}`}, body: JSON.stringify(body)});
    const result = await response.json().catch(() => ({})) as any;
    if (!response.ok || result.ok === false) throw new Error(result.error || `runner HTTP ${response.status}`);
    return result
}

async function copyIfExists(source: string, target: string) {
    try { await stat(source); await cp(source, target, {recursive: true}) } catch (error: any) { if (error?.code !== "ENOENT") throw error }
}

async function backup(workspace: string, runId: string) {
    const root = path.join(workspace, ".matrix", "history", "phase2-edits", runId);
    await mkdir(root, {recursive: true});
    await copyIfExists(path.join(workspace, ".matrix", "data"), path.join(root, "data"));
    await copyIfExists(path.join(workspace, ".matrix", "reports"), path.join(root, "reports"));
    return root
}

async function restore(workspace: string, root: string) {
    for (const name of ["data", "reports"]) {
        const target = path.join(workspace, ".matrix", name), source = path.join(root, name);
        await rm(target, {recursive: true, force: true});
        await copyIfExists(source, target)
    }
}

export function startPhase2EditWorker(connection: Redis, db: Pool) {
    return new Worker("phase2-edit", async job => {
        const runId = String(job.data.editRunId);
        const row = (await db.query(`select r.*,p."workspacePath" from "Phase2EditRun" r join "Project" p on p.id=r."projectId" where r.id=$1`, [runId])).rows[0];
        if (!row) throw new Error("Phase2编辑任务不存在");
        const projectLock = `phase2-edit-lock:${row.projectId}`, token = `${process.pid}-${Date.now()}`;
        if (await connection.set(projectLock, token, "PX", 30 * 60_000, "NX") !== "OK") throw new Error("项目已有编辑重建任务");
        let backupPath = "";
        try {
            await db.query(`update "Phase2EditRun" set status='RUNNING',"startedAt"=now(),"currentStage"='backup',progress=5 where id=$1`, [runId]);
            backupPath = await backup(row.workspacePath, runId);
            await db.query(`update "Phase2EditRun" set "backupPath"=$1,"currentStage"='apply',progress=10 where id=$2`, [backupPath, runId]);
            const request = typeof row.request === "string" ? JSON.parse(row.request) : row.request;
            const batch = row.operation === "batch";
            const applied = await call<any>(batch ? "/v1/phase2/editor/apply-batch" : "/v1/phase2/editor/apply", request);
            const artifacts: string[] = batch ? applied.artifacts : [String(applied.artifact || request.artifact)];
            let modes = [...new Set(artifacts.flatMap(artifact => modeByArtifact[artifact] || []))];
            if (!modes.length) throw new Error(`不支持重建工件 ${artifacts.join(", ")}`);
            if (artifacts.includes("functional-test-content.json")) {
                const paths: string[] = applied.raw_paths || [applied.raw_path];
                modes = modes.filter(mode => mode !== "finalize_functional_other_content");
                const functionalModes: string[] = [];
                if (paths.some(value => String(value).endsWith("functional-init-content.raw.json"))) functionalModes.push("finalize_functional_init_content");
                if (paths.some(value => !String(value).endsWith("functional-init-content.raw.json"))) functionalModes.push("finalize_functional_other_content");
                modes.unshift(...functionalModes)
            }
            const all = [...modes, "generate_phase2_traceability", "finalize_phase2_document"];
            for (let i = 0; i < all.length; i++) {
                await db.query(`update "Phase2EditRun" set "currentStage"=$1,progress=$2 where id=$3`, [all[i], 15 + Math.floor(i / all.length * 70), runId]);
                await call("/v1/phase2/workflow/execute", {directory: row.workspacePath, mode: all[i]})
            }
            const total = path.join(row.workspacePath, ".matrix", "reports", "phase2-test-requirements.docx");
            if ((await stat(total)).size === 0) throw new Error("重建后的总DOCX为空");
            await db.query(`update "Phase2EditRun" set "currentStage"='index',progress=90 where id=$1`, [runId]);
            await indexProject(db, row.projectId, row.workspacePath, applied.requirement_id_renames || []);
            const client = await db.connect();
            try {
                await client.query("begin");
                await client.query(`update "Phase2EditRun" set status='SUCCEEDED',progress=100,"currentStage"='complete',"finishedAt"=now() where id=$1`, [runId]);
                await client.query(`update "Project" set status='READY_FOR_REVIEW',"updatedAt"=now() where id=$1`, [row.projectId]);
                await client.query(`insert into "AuditLog" ("userId",action,"resourceType","resourceId",detail) values ($1,'PHASE2_EDIT_REBUILT','Phase2EditRun',$2,$3)`,
                    [row.userId, runId, JSON.stringify({operation: row.operation, targetBusinessId: row.targetBusinessId,
                        requirementId: applied.requirement_id, requirementIdRenames: applied.requirement_id_renames || [],
                        previousValue: applied.previous_value, backupPath})]);
                await client.query("commit")
            } catch (error) { await client.query("rollback"); throw error } finally { client.release() }
            return {ok: true}
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            try {
                if (backupPath) { await restore(row.workspacePath, backupPath); await indexProject(db, row.projectId, row.workspacePath) }
                await db.query(`update "Project" set status='READY_FOR_REVIEW',"updatedAt"=now() where id=$1`, [row.projectId]);
                await db.query(`update "Phase2EditRun" set status='FAILED',"errorMessage"=$1,"finishedAt"=now() where id=$2`, [`${message}（已恢复原版本）`, runId])
            } catch (rollbackError) {
                await db.query(`update "Project" set status='FAILED',"updatedAt"=now() where id=$1`, [row.projectId]);
                await db.query(`update "Phase2EditRun" set status='FAILED',"errorMessage"=$1,"finishedAt"=now() where id=$2`, [`${message}；回滚失败：${String(rollbackError)}`, runId])
            }
            throw error
        } finally {
            await connection.eval(`if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`, 1, projectLock, token)
        }
    }, {connection, concurrency: +(process.env.PHASE2_EDIT_CONCURRENCY || 1)})
}
