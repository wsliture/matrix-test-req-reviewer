import {BadRequestException, ConflictException, Controller, ForbiddenException, Get, Injectable, Param, Post, Req, Body} from "@nestjs/common";
import {Queue} from "bullmq";
import {Redis} from "ioredis";
import {Prisma} from "@prisma/client";
import {PrismaService} from "./prisma.js";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {maxRetriesPerRequest: null});
const queue = new Queue("phase2-edit", {connection: redis});
const runnerUrl = process.env.MATRIX_PHASE2_RUNNER_URL || "http://localhost:4097";
const runnerAuth = Buffer.from(`${process.env.OPENCODE_USERNAME || "opencode"}:${process.env.OPENCODE_PASSWORD || ""}`).toString("base64");

async function runner<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${runnerUrl}${path}`, {method: "POST", headers: {
        "Content-Type": "application/json", Authorization: `Basic ${runnerAuth}`
    }, body: JSON.stringify(body)});
    const result = await response.json().catch(() => ({})) as any;
    if (!response.ok || result.ok === false) throw new BadRequestException(result.error || `确定性执行服务返回 ${response.status}`);
    return result
}

@Injectable()
export class Phase2EditsService {
    constructor(private db: PrismaService) {}

    private async node(projectId: string, nodeId: string) {
        const node = await this.db.testRequirementNode.findFirst({where: {id: nodeId, projectId}});
        if (!node) throw new BadRequestException("测试需求节点不存在");
        return node
    }

    private runnerIdentity(node: any) {
        const content = node.content && typeof node.content === "object" ? node.content as Record<string, unknown> : {};
        return {interface_id: content.interface_id, candidate_id: content.candidate_id,
            title_no: content.title_no || node.number, requirement_id: node.businessId}
    }

    async describe(projectId: string, nodeId: string) {
        const project = await this.db.project.findUniqueOrThrow({where: {id: projectId}}), node = await this.node(projectId, nodeId);
        const result = await runner<any>("/v1/phase2/editor/describe", {directory: project.workspacePath, artifact: node.artifact,
            business_id: node.nodeType === "requirement" ? node.businessId : undefined,
            container_id: node.nodeType === "section" ? node.businessId : undefined,
            identity: this.runnerIdentity(node)});
        return {...result, node_id: node.id, business_id: node.businessId, chapter: node.number || ""}
    }

    async create(projectId: string, user: {id: string; role: string}, body: any) {
        if (!(["ADMIN", "REVIEWER"] as string[]).includes(user.role)) throw new ForbiddenException("当前角色没有编辑权限");
        if (!(["update", "add", "delete"] as string[]).includes(body.operation)) throw new BadRequestException("operation无效");
        if (typeof body.expected_revision !== "string" || !body.expected_revision) throw new BadRequestException("expected_revision不能为空");
        const project = await this.db.project.findUniqueOrThrow({where: {id: projectId}});
        const node = await this.node(projectId, body.node_id || body.container_id);
        const [generation, edit] = await Promise.all([
            this.db.phase2Run.findFirst({where: {projectId, status: {in: ["QUEUED", "RUNNING"]}}}),
            this.db.phase2EditRun.findFirst({where: {projectId, status: {in: ["QUEUED", "RUNNING"]}}})
        ]);
        if (generation || edit) throw new ConflictException("该项目已有生成或编辑重建任务");
        const request = {directory: project.workspacePath, artifact: node.artifact,
            business_id: node.nodeType === "requirement" ? node.businessId : undefined,
            container_id: body.container_id || (node.nodeType === "section" ? node.businessId : undefined),
            operation: body.operation, expected_revision: body.expected_revision, value: body.value,
            identity: this.runnerIdentity(node)};
        const run = await this.db.$transaction(async tx => {
            const created = await tx.phase2EditRun.create({data: {projectId, userId: user.id,
                targetBusinessId: node.businessId, operation: body.operation, expectedRevision: body.expected_revision,
                request: request as any}});
            await tx.project.update({where: {id: projectId}, data: {status: "REBUILDING"}});
            await tx.auditLog.create({data: {userId: user.id, action: `PHASE2_EDIT_${String(body.operation).toUpperCase()}`,
                resourceType: "TestRequirementNode", resourceId: node.id, detail: {runId: created.id, businessId: node.businessId} as any}});
            return created
        });
        try {
            await queue.add("phase2-edit", {editRunId: run.id}, {jobId: run.id, removeOnComplete: 100, removeOnFail: 100})
        } catch (error) {
            await this.db.$transaction([
                this.db.phase2EditRun.update({where: {id: run.id}, data: {status: "FAILED", errorMessage: "编辑任务入队失败", finishedAt: new Date()}}),
                this.db.project.update({where: {id: projectId}, data: {status: "READY_FOR_REVIEW"}})
            ]);
            throw error
        }
        return {...run, publicationStatus: "QUEUED" as const}
    }

    async inlineDescribe(projectId: string) {
        const project = await this.db.project.findUniqueOrThrow({where: {id: projectId}});
        return runner<any>("/v1/phase2/editor/inline-describe", {directory: project.workspacePath})
    }

    async createBatch(projectId: string, user: {id: string; role: string}, body: any) {
        if (!( ["ADMIN", "REVIEWER"] as string[]).includes(user.role)) throw new ForbiddenException("当前角色没有编辑权限");
        if (typeof body.expected_revision !== "string" || !body.expected_revision) throw new BadRequestException("expected_revision不能为空");
        const changes = Array.isArray(body.changes) ? body.changes : [], tableOperations = Array.isArray(body.table_operations) ? body.table_operations : [],
            requirementOperations = Array.isArray(body.requirement_operations) ? body.requirement_operations : [];
        if (!changes.length && !tableOperations.length && !requirementOperations.length) throw new BadRequestException("changes、table_operations和requirement_operations不能同时为空");
        if (changes.some((item: any) => typeof item?.edit_key !== "string" || !("value" in item))) throw new BadRequestException("changes格式无效");
        const operations = new Set(["add_row", "delete_row", "add_column", "delete_column"]);
        if (tableOperations.some((item: any) => typeof item?.container_key !== "string" || !operations.has(item?.operation))) throw new BadRequestException("table_operations格式无效");
        const requirementOperationNames = new Set(["add_requirement", "delete_requirement"]);
        if (requirementOperations.some((item: any) => typeof item?.container_key !== "string" || !requirementOperationNames.has(item?.operation)
            || item.operation === "delete_requirement" && typeof item.requirement_key !== "string")) throw new BadRequestException("requirement_operations格式无效");
        const project = await this.db.project.findUniqueOrThrow({where: {id: projectId}});
        const [generation, edit] = await Promise.all([
            this.db.phase2Run.findFirst({where: {projectId, status: {in: ["QUEUED", "RUNNING"]}}}),
            this.db.phase2EditRun.findFirst({where: {projectId, status: {in: ["QUEUED", "RUNNING"]}}})
        ]);
        if (generation || edit) throw new ConflictException("该项目已有生成或编辑重建任务");
        const request = {directory: project.workspacePath, expected_revision: body.expected_revision, changes, table_operations: tableOperations,
            requirement_operations: requirementOperations};
        const run = await this.db.$transaction(async tx => {
            const created = await tx.phase2EditRun.create({data: {projectId, userId: user.id, targetBusinessId: "phase2-document",
                operation: "batch", expectedRevision: body.expected_revision, request: request as any}});
            await tx.project.update({where: {id: projectId}, data: {status: "REBUILDING"}});
            await tx.auditLog.create({data: {userId: user.id, action: "PHASE2_EDIT_BATCH", resourceType: "Project", resourceId: projectId,
                detail: {runId: created.id, changeCount: changes.length, tableOperationCount: tableOperations.length,
                    requirementOperationCount: requirementOperations.length} as any}});
            return created
        });
        await queue.add("phase2-edit", {editRunId: run.id}, {jobId: run.id, removeOnComplete: 100, removeOnFail: 100});
        return {...run, publicationStatus: "QUEUED" as const}
    }

    async get(id: string) {
        const run = await this.db.phase2EditRun.findUniqueOrThrow({where: {id}});
        const publicationStatus = run.status === "FAILED" ? "FAILED" : run.publishedAt ? "PUBLISHED" : run.savedAt ? "BUILDING" : "QUEUED";
        return {...run, publicationStatus}
    }

    async retry(id: string, user: {id: string; role: string}) {
        if (!( ["ADMIN", "REVIEWER"] as string[]).includes(user.role)) throw new ForbiddenException("当前角色没有编辑权限");
        const run = await this.db.phase2EditRun.findUniqueOrThrow({where: {id}});
        if (run.status !== "FAILED" || !run.savedAt || !run.applyResult) throw new ConflictException("只有已保存编辑稿且发布失败的任务可以重试");
        const active = await this.db.phase2EditRun.findFirst({where: {projectId: run.projectId, status: {in: ["QUEUED", "RUNNING"]}}});
        if (active) throw new ConflictException("该项目已有编辑重建任务");
        await this.db.$transaction([
            this.db.phase2EditRun.update({where: {id}, data: {status: "QUEUED", currentStage: "retry_apply", progress: 0,
                errorMessage: null, finishedAt: null, savedAt: null, savedRevision: null, applyResult: Prisma.JsonNull, publishedAt: null}}),
            this.db.project.update({where: {id: run.projectId}, data: {status: "REBUILDING"}})
        ]);
        await queue.add("phase2-edit-retry", {editRunId: id, rebuildOnly: false}, {jobId: `${id}-retry-${Date.now()}`, removeOnComplete: 100, removeOnFail: 100});
        return {...await this.db.phase2EditRun.findUniqueOrThrow({where: {id}}), publicationStatus: "QUEUED" as const}
    }
}

@Controller()
export class Phase2EditsController {
    constructor(private edits: Phase2EditsService) {}
    @Get("projects/:projectId/phase2-editor/:nodeId") describe(@Param("projectId") projectId: string, @Param("nodeId") nodeId: string) {
        return this.edits.describe(projectId, nodeId)
    }
    @Post("projects/:projectId/phase2-edits") create(@Param("projectId") projectId: string, @Req() req: any, @Body() body: any) {
        return this.edits.create(projectId, req.user, body)
    }
    @Get("projects/:projectId/phase2-editor-inline") inlineDescribe(@Param("projectId") projectId: string) { return this.edits.inlineDescribe(projectId) }
    @Post("projects/:projectId/phase2-edits/batch") createBatch(@Param("projectId") projectId: string, @Req() req: any, @Body() body: any) {
        return this.edits.createBatch(projectId, req.user, body)
    }
    @Get("phase2-edit-runs/:runId") get(@Param("runId") runId: string) { return this.edits.get(runId) }
    @Post("phase2-edit-runs/:runId/retry") retry(@Param("runId") runId: string, @Req() req: any) { return this.edits.retry(runId, req.user) }
}
