import {Body, ConflictException, Controller, HttpCode, Post, SetMetadata} from "@nestjs/common";
import {Prisma} from "@prisma/client";
import {randomUUID} from "node:crypto";
import {mkdir, rm, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {safeExtract} from "./archive.js";
import {findProjectRoot, REQUIRED} from "./projects.js";
import {PrismaService} from "./prisma.js";
import {RunsService} from "./runs.js";
import {docxFingerprint} from "./matrix-input.js";
import {MATRIX_ENDPOINT} from "./matrix-settings.js";

const fields = ["toolId", "runId", "projectId", "projectName", "projectVersion", "langType",
    "sessionId", "codePackageBase64", "docPackageBase64"] as const;
type StartRequest = Record<typeof fields[number], string>;

function envelope(result: {accepted: boolean; jumpUrl?: string; reason?: string; field?: string}) {
    return {success: true, message: "", code: 200, result};
}

function accepted(projectId: string) {
    return envelope({accepted: true, jumpUrl: `/projects/${projectId}`});
}

function reject(field: string, reason: string) {
    return envelope({accepted: false, field, reason});
}

async function fingerprintPastUpload(archive: string, target: string) {
    try {
        await safeExtract(archive, target, {docxOnly: true, skipOtherFiles: true});
        return await docxFingerprint(target);
    } catch {
        return null;
    }
}

@Controller()
@SetMetadata(MATRIX_ENDPOINT, true)
export class MatrixPlanningController {
    constructor(private db: PrismaService, private runs: RunsService) {}

    @Post("start")
    @HttpCode(200)
    async start(@Body() input: Partial<StartRequest> | null) {
        for (const field of fields) {
            if (typeof input?.[field] !== "string") return reject(field, `${field} 必须为字符串`);
        }
        const req = input as StartRequest;
        if (req.toolId !== "planning") return reject("toolId", "工具标识必须为 planning");
        for (const field of ["runId", "projectId", "sessionId", "projectName"] as const) {
            if (!req[field].trim() || req[field].includes("\0")) return reject(field, `${field} 必须为非空字符串`);
        }
        if (req.projectName.length > 100) return reject("projectName", "项目名称不能超过100个字符");
        if (req.projectVersion.length > 100 || req.projectVersion.includes("\0")) {
            return reject("projectVersion", "项目版本必须为不超过100个字符的有效文本");
        }
        if (!["", "C", "C++", "JAVA", "PYTHON", "VHDL", "Verilog"].includes(req.langType)) {
            return reject("langType", "不支持的代码语言");
        }
        const key = {toolId: req.toolId, runId: req.runId};
        const lookup = () => this.db.matrixPlanningRun.findUnique({where: {toolId_runId: key}});
        const existing = await lookup();
        if (existing) return accepted(existing.projectId);
        const encoded = req.docPackageBase64;
        const limit = +(process.env.MAX_ARCHIVE_BYTES || 1073741824);
        if (!encoded || encoded.length > Math.ceil(limit / 3) * 4 || encoded.length % 4 !== 0) {
            return reject("docPackageBase64", "文档包为空、超出大小限制或 Base64 格式无效");
        }
        const zip = Buffer.from(encoded, "base64");
        if (zip.length > limit || zip.toString("base64") !== encoded) {
            return reject("docPackageBase64", "文档包超出大小限制或 Base64 格式无效");
        }
        const id = randomUUID(), work = path.resolve(process.env.PROJECTS_ROOT || "/data/projects", id);
        const archive = path.join(work, "upload.zip"), source = path.join(work, "source");
        let committed = false;
        try {
            await mkdir(work, {recursive: true});
            await writeFile(archive, zip);
            try {
                await safeExtract(archive, source, {docxOnly: true, skipOtherFiles: true});
            } catch (error) {
                const message = error instanceof Error ? error.message : "未知错误";
                return reject("docPackageBase64", `文档包无法解压：${message}`);
            }
            const inputFingerprint = await docxFingerprint(source);
            const workspacePath = await findProjectRoot(source);
            const name = req.projectName.trim();
            const scope = {toolId: req.toolId, externalProjectId: req.projectId};
            const start = (projectName: string) => this.db.$transaction(async tx => {
                const lockKey = JSON.stringify([scope.toolId, scope.externalProjectId]);
                await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
                const duplicate = await tx.matrixPlanningRun.findUnique({where: {toolId_runId: key}});
                if (duplicate) return accepted(duplicate.projectId);

                const runs = await tx.phase2Run.findMany({where: {id: {in: (await tx.matrixPlanningRun.findMany({
                    where: scope, select: {phase2RunId: true}
                })).map(mapping => mapping.phase2RunId)}},
                orderBy: [{createdAt: "desc"}, {id: "desc"}]});
                if (runs.some(run => run.status === "QUEUED" || run.status === "RUNNING")) {
                    return envelope({accepted: false, reason: "同一 Matrix 项目已有生成任务正在排队或运行"});
                }
                const previous = runs[0];
                let resume = false;
                if (previous?.status === "CANCELLED") {
                    await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${previous.projectId} FOR UPDATE`;
                    const project = await tx.project.findUnique({where: {id: previous.projectId}});
                    const mapping = await tx.matrixPlanningRun.findUniqueOrThrow({where: {phase2RunId: previous.id}});
                    if (project) {
                        let stored = mapping.inputFingerprint;
                        if (!stored) {
                            const oldArchive = path.resolve(work, "..", project.id, "upload.zip");
                            const oldSource = path.join(work, "previous-source");
                            stored = await fingerprintPastUpload(oldArchive, oldSource);
                            await rm(oldSource, {recursive: true, force: true});
                            if (stored) await tx.matrixPlanningRun.update({
                                where: {phase2RunId: previous.id}, data: {inputFingerprint: stored}
                            });
                        }
                        const workspaceExists = await stat(project.workspacePath).then(info => info.isDirectory()).catch(() => false);
                        resume = stored === inputFingerprint && workspaceExists;
                        if (resume && (await tx.phase2Run.count({where: {
                            projectId: project.id, status: {in: ["QUEUED", "RUNNING"]}
                        }}) || await tx.phase2EditRun.count({where: {
                            projectId: project.id, status: {in: ["QUEUED", "RUNNING"]}
                        }}))) {
                            return envelope({accepted: false, reason: "原项目已有生成或编辑重建任务"});
                        }
                    }
                }

                const projectId = resume ? previous.projectId : id;
                if (resume) await tx.project.update({where: {id: projectId}, data: {status: "GENERATING"}});
                else await tx.project.create({data: {id, name: projectName, workspacePath, source: "MATRIX",
                    status: "GENERATING", missingArtifacts: REQUIRED}});
                const [clock] = await tx.$queryRaw<{now: Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
                const createdAt = new Date(Math.max(clock.now.getTime(), (previous?.createdAt.getTime() ?? 0) + 1));
                const run = await tx.phase2Run.create({data: {projectId, autoRetry: true, createdAt,
                    ...(resume ? {currentStage: "resume_queued", progress: previous.progress,
                        ...(Array.isArray(previous.completedStages) ? {completedStages: previous.completedStages} : {})} : {})}});
                await tx.matrixPlanningRun.create({data: {...key, ...scope, projectId, phase2RunId: run.id, inputFingerprint,
                    externalProjectName: req.projectName, projectVersion: req.projectVersion,
                    langType: req.langType, sessionId: req.sessionId}});
                await tx.runEvent.create({data: {runId: run.id, type: resume ? "run.resumed" : "run.queued",
                    payload: resume ? {projectId, previousRunId: previous.id} : {projectId}}});
                return accepted(projectId);
            }, {maxWait: 30_000, timeout: 300_000});
            let response;
            try {
                response = await start(name);
            } catch (error) {
                if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
                const duplicate = await lookup();
                if (duplicate) return accepted(duplicate.projectId);
                response = await start(`${name.slice(0, 61)} (${id})`);
            }
            committed = response.result.jumpUrl === `/projects/${id}`;
            return response;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                const duplicate = await lookup();
                if (duplicate) return accepted(duplicate.projectId);
            }
            throw error;
        } finally {
            if (!committed) await rm(work, {recursive: true, force: true}).catch(error => console.error("Matrix import cleanup failed", error));
        }
    }

    @Post("stop")
    @HttpCode(200)
    async stop(@Body() req: {toolId?: string; runId?: string; projectId?: string; sessionId?: string} | null) {
        if (req?.toolId !== "planning" || typeof req.runId !== "string" || !req.runId.trim() || req.runId.includes("\0")) {
            return reject("runId", "需要有效的 planning 工具标识和运行标识");
        }
        if ([req.projectId, req.sessionId].some(value => value !== undefined && typeof value !== "string")) {
            return envelope({accepted: false, reason: "projectId 和 sessionId 必须为字符串"});
        }
        const mapping = await this.db.matrixPlanningRun.findUnique({
            where: {toolId_runId: {toolId: req.toolId, runId: req.runId}}
        });
        const run = mapping && await this.db.phase2Run.findUnique({where: {id: mapping.phase2RunId}});
        if (!run) return envelope({accepted: false, reason: "未找到任务"});
        try {
            await this.runs.cancel(run.id, true);
            return envelope({accepted: true});
        } catch (error) {
            if (error instanceof ConflictException) return envelope({accepted: false, reason: error.message});
            throw error;
        }
    }
}
