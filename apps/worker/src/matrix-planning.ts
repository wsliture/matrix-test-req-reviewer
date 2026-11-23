import type {Pool} from "pg";
import type {Queue} from "bullmq";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {PHASE2_RETRY_BASE_DELAY_MS} from "./retry-policy.js";

export function planningSummary(trace: {summary: {requirement_count: number}; rows: {
    source_ref: string; test_requirement_ids: string[];
}[]}, indexedIds: Set<string>) {
    const requirementCount = trace.summary.requirement_count;
    if (!Number.isInteger(requirementCount) || requirementCount < 0 || requirementCount > 2147483647) {
        throw new Error("Phase 2 正式追踪产物的需求数量无效");
    }
    const sources = new Set<string>(), covered = new Set<string>();
    for (const row of trace.rows) {
        sources.add(row.source_ref);
        if (row.test_requirement_ids.some(id => indexedIds.has(id))) covered.add(row.source_ref);
    }
    const requirementCoverage = sources.size ? Math.round(10000 * covered.size / sources.size) / 100 : 0;
    return {requirementCount, requirementCoverage};
}

export async function loadPlanningSummary(db: Pool, projectId: string, workspace: string) {
    const trace = JSON.parse(await readFile(path.join(workspace, ".matrix/data/phase2-test-traceability.json"), "utf8"));
    const indexed = await db.query<{businessId: string}>(`
        select "businessId" from "TestRequirementNode" where "projectId"=$1 and "nodeType"='requirement'`, [projectId]);
    return planningSummary(trace, new Set(indexed.rows.map(row => row.businessId)));
}

function poll(name: string, fn: () => Promise<void>) {
    async function tick() {
        try {
            await fn();
        } catch (error) {
            console.error(name, error);
        } finally {
            setTimeout(tick, 2000).unref();
        }
    }
    void tick();
}

type AbortSession = (id: string, directory: string) => Promise<void>;

export async function requeueAbandonedMatrixRun(db: Pool, id: string, attemptCount: number, abortSession: AbortSession) {
    const current = await db.query(`select r."opencodeSessionId",p."workspacePath"
        from "Phase2Run" r join "Project" p on p.id=r."projectId"
        where r.id=$1 and r.status='RUNNING' and r."attemptCount"=$2`, [id, attemptCount]);
    const run = current.rows[0];
    if (!run) return false;
    if (run.opencodeSessionId) await abortSession(run.opencodeSessionId, run.workspacePath);
    await db.query(`update "Phase2Run" set status='QUEUED',"currentStage"='retry_queued',
        "accumulatedElapsedMs"="accumulatedElapsedMs" + coalesce(
            greatest(0,floor(extract(epoch from ((statement_timestamp() at time zone 'UTC') - "attemptStartedAt")) * 1000))::bigint,0),
        "attemptStartedAt"=null,"opencodeSessionId"=null
        where id=$1 and status='RUNNING' and "attemptCount"=$2`, [id, attemptCount]);
    return true;
}

export function dispatchMatrixJobs(db: Pool, queue: Queue, abortSession: AbortSession) {
    poll("Matrix planning enqueue", async () => {
        const pending = await db.query(`
            select r.id,r."projectId",r."attemptCount" from "Phase2Run" r
            join "MatrixPlanningRun" m on m."phase2RunId"=r.id
            where r.status='QUEUED' and not exists (
                select 1 from "MatrixPlanningRun" old
                join "Phase2Run" stopped on stopped.id=old."phase2RunId"
                where old."projectId"=r."projectId" and stopped.status='CANCELLED' and old."cancelSettledAt" is null
            ) order by r."startedAt" nulls first,r.id`);
        for (const run of pending.rows) {
            const matrixAttempt = run.attemptCount;
            const jobId = `${run.id}-matrix-${matrixAttempt}`;
            const existing = await queue.getJob(jobId);
            if (existing) {
                const state = await existing.getState();
                if (state !== "failed" && state !== "completed") continue;
                // Recheck the run and attempt before removing a retained job.
                const current = await db.query('select status,"attemptCount" from "Phase2Run" where id=$1', [run.id]);
                if (current.rows[0]?.status !== "QUEUED" || current.rows[0].attemptCount !== matrixAttempt) continue;
                await existing.remove();
            }
            const job = await queue.add("matrix-phase2", {runId: run.id, projectId: run.projectId, matrixAttempt}, {
                jobId, delay: matrixAttempt ? PHASE2_RETRY_BASE_DELAY_MS : 0,
                removeOnComplete: 100, removeOnFail: 100
            });
            // A cancellation can commit between the database read and add().
            const current = await db.query('select status from "Phase2Run" where id=$1', [run.id]);
            if (current.rows[0]?.status === "CANCELLED" && await job.getState() !== "active") await job.remove();
        }
    });
    poll("Matrix planning abandoned-job recovery", async () => {
        const running = await db.query(`select r.id,r."attemptCount" from "Phase2Run" r
            join "MatrixPlanningRun" m on m."phase2RunId"=r.id
            where r.status='RUNNING' and r."attemptStartedAt" < (now() at time zone 'UTC') - interval '30 seconds'`);
        for (const run of running.rows) {
            const job = await queue.getJob(run.id + "-matrix-" + (run.attemptCount - 1));
            const state = await job?.getState();
            if (!state || ["failed", "completed", "unknown"].includes(state)) {
                await requeueAbandonedMatrixRun(db, run.id, run.attemptCount, abortSession);
            }
        }
    });
    poll("Matrix planning cancellation cleanup", async () => {
        const pending = await db.query(`select r.id,r."attemptCount",r."opencodeSessionId",p."workspacePath"
            from "MatrixPlanningRun" m join "Phase2Run" r on m."phase2RunId"=r.id
            join "Project" p on p.id=r."projectId"
            where r.status='CANCELLED' and m."cancelSettledAt" is null`);
        for (const run of pending.rows) {
            const attempts = run.attemptCount > 0 ? [run.attemptCount - 1, run.attemptCount] : [0];
            let active = false;
            for (const attempt of attempts) {
                const job = await queue.getJob(run.id + "-matrix-" + attempt);
                if (!job) continue;
                const state = await job.getState();
                if (state === "active") active = true;
                else if (["waiting", "delayed", "prioritized", "waiting-children", "paused"].includes(state)) await job.remove();
            }
            if (active) continue; // The active worker observes the cancellation and aborts its own session.
            if (run.opencodeSessionId) await abortSession(run.opencodeSessionId, run.workspacePath);
            await db.query('update "MatrixPlanningRun" set "cancelSettledAt"=(now() at time zone \'UTC\') where "phase2RunId"=$1', [run.id]);
        }
    });
}

export function classifyCallback(httpStatus: number, body: unknown, final: boolean) {
    if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) return {retry: true, httpStatus};
    const envelope = body as {success?: unknown; code?: unknown; message?: unknown;
        result?: {ack?: unknown; state?: unknown; reason?: unknown}} | null;
    const {ack, state, reason} = envelope?.result ?? {};
    const frameworkOk = httpStatus === 200 && envelope?.success === true && envelope?.code === 200;
    return {retry: false, httpStatus, ack, state, reason: reason ?? envelope?.message,
        accepted: frameworkOk && ack === true && (!final || state === "COMPLETED")};
}

async function postCallback(base: string, kind: string, payload: object) {
    try {
        const response = await fetch(`${base}/matrix/internal/tools/${kind}`, {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload), signal: AbortSignal.timeout(5000), redirect: "error"
        });
        return classifyCallback(response.status, await response.json().catch(() => null), kind === "result");
    } catch (error) {
        return {retry: true, error: String(error)};
    }
}

export function deliverMatrixCallbacks(db: Pool) {
    poll("Matrix planning callbacks", async () => {
        const setting = await db.query('select value from "SystemSetting" where key=$1', ["matrixCallbackBase"]);
        const base = setting.rows[0]?.value;
        if (!base) return;
        for (const kind of ["result", "progress"] as const) {
            const final = kind === "result";
            const pending = await db.query(`
                select m.*,r.progress,r."currentStage",r."attemptCount",r.status,
                    concat_ws('|',r.status,r."attemptCount",r.progress,r."currentStage") as "currentKey"
                from "MatrixPlanningRun" m ${final ? 'left' : 'inner'} join "Phase2Run" r on r.id=m."phase2RunId"
                where ${final ? 'm."resultSummary" is not null and m."resultReceipt" is null and coalesce(m."resultNextAt" <= (now() at time zone \'UTC\'), true)'
                    : `r.status in ('QUEUED','RUNNING') and (m."progressKey" is distinct from
                        concat_ws('|',r.status,r."attemptCount",r.progress,r."currentStage")
                        or m."progressNextAt" <= (now() at time zone 'UTC'))`}
                order by m."${kind}NextAt" nulls first,m."phase2RunId" limit 8`);
            await Promise.all(pending.rows.map(async row => {
                const lease = await db.connect();
                try {
                    const lock = await lease.query("select pg_try_advisory_lock(hashtext($1), 1836081) as locked", [row.phase2RunId]);
                    if (!lock.rows[0].locked) return;
                    try {
                        const latest = await lease.query(`
                            select m.*,r.status,
                                coalesce(m."resultNextAt" <= (now() at time zone 'UTC'), true) as "resultDue",
                                coalesce(m."progressNextAt" <= (now() at time zone 'UTC'), false) as "progressDue",
                                concat_ws('|',r.status,r."attemptCount",r.progress,r."currentStage") as "currentKey"
                            from "MatrixPlanningRun" m left join "Phase2Run" r on r.id=m."phase2RunId"
                            where m."phase2RunId"=$1`, [row.phase2RunId]);
                        const current = latest.rows[0];
                        if (!current) return;
                        if (final ? current.resultReceipt || !current.resultDue :
                            !["QUEUED", "RUNNING"].includes(current.status) || current.currentKey !== row.currentKey ||
                            (current.progressKey === row.currentKey && !current.progressDue)) return;
                        const ids = {toolId: row.toolId, runId: row.runId};
                        const payload = final
                            ? {...ids, projectId: row.externalProjectId, sessionId: row.sessionId,
                                status: "completed", resultJson: {summary: current.resultSummary}}
                            : {...ids, percent: Math.max(0, Math.min(100, row.progress)),
                                text: Array.from(row.status === "QUEUED"
                                    ? (row.currentStage === "resume_queued" ? "等待继续执行" : row.attemptCount ? "等待自动重试" : "等待生成") : row.currentStage || "正在生成").slice(0, 500).join("")};
                        const receipt = await postCallback(base, kind, payload);
                        const attempts = (final ? current.resultAttempts :
                            current.progressKey === row.currentKey ? current.progressAttempts : 0) + 1;
                        const retry = receipt.retry && attempts < 8;
                        const next = retry ? new Date(Date.now() + Math.min(300000, 2000 * 2 ** (attempts - 1))).toISOString() : null;
                        const stored = JSON.stringify({...receipt, attempts, at: new Date().toISOString()});
                        if (final) {
                            await lease.query(`update "MatrixPlanningRun" set "resultAttempts"=$2,
                                "resultNextAt"=($3::timestamptz at time zone 'UTC'),"resultReceipt"=$4 where "phase2RunId"=$1`,
                            [row.phase2RunId, attempts, next, retry ? null : stored]);
                        } else {
                            await lease.query(`update "MatrixPlanningRun" set "progressAttempts"=$2,
                                "progressNextAt"=($3::timestamptz at time zone 'UTC'),"progressReceipt"=$4,"progressKey"=$5 where "phase2RunId"=$1`,
                            [row.phase2RunId, attempts, next, stored, row.currentKey]);
                        }
                    } finally {
                        await lease.query("select pg_advisory_unlock(hashtext($1), 1836081)", [row.phase2RunId]);
                    }
                } finally {
                    lease.release();
                }
            }));
        }
    });
}
