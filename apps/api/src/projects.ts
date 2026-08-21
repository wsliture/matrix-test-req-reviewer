import {BadRequestException, ConflictException, Controller, Delete, Get, Injectable, NotFoundException, Param, Post, Req} from "@nestjs/common";
import {PrismaService} from "./prisma.js";
import {mkdir, readdir, rm} from "node:fs/promises";
import {createWriteStream} from "node:fs";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {safeExtract} from "./archive.js";
import {Queue} from "bullmq";
import {Redis} from "ioredis";

const documentQueue = new Queue("document-index", {connection: new Redis(process.env.REDIS_URL || "redis://localhost:6379", {maxRetriesPerRequest: null})});

const REQUIRED = ["chapter1-scope.json", "chapter2-system-overview.json", "hardware-interface-model.json", "functional-test-content.json", "performance-test-content.json", "interface-test-content.json", "reliability-safety-test-content.json", "margin-test-content.json", "boundary-test-content.json", "data-processing-test-content.json", "recovery-test-content.json", "strength-test-content.json", "phase2-test-traceability.json"];

async function findProjectRoot(root: string) {
    const entries = await readdir(root, {withFileTypes: true});
    if (entries.some(x => x.name === ".matrix" || x.name.toLowerCase().endsWith(".docx"))) return root;
    const dirs = entries.filter(x => x.isDirectory());
    if (dirs.length === 1) return findProjectRoot(path.join(root, dirs[0].name));
    return root
}

@Injectable()
export class ProjectsService {
    constructor(private db: PrismaService) {
    }

    list() {
        return this.db.project.findMany({
            orderBy: {updatedAt: "desc"},
            include: {runs: {orderBy: {startedAt: "desc"}, take: 1}, documents: true}
        })
    }

    async get(id: string) {
        const project = await this.db.project.findUnique({
            where: {id},
            include: {documents: true, runs: {orderBy: {startedAt: "desc"}}}
        });
        if (!project) throw new NotFoundException("项目不存在或已被删除");
        return project
    }

    async remove(id: string) {
        const project = await this.db.project.findUnique({
            where: {id},
            include: {runs: {select: {id: true, status: true}}}
        });
        if (!project) throw new NotFoundException("项目不存在或已被删除");
        if (project.runs.some(run => run.status === "QUEUED" || run.status === "RUNNING")) {
            throw new ConflictException("项目正在生成测试需求，请先终止任务")
        }
        const documentJob = await documentQueue.getJob(`document-index-${id}`), documentState = await documentJob?.getState();
        if (documentState === "active") throw new ConflictException("项目文档正在建立索引，请稍后再删除");
        await documentJob?.remove();
        const root = path.resolve(process.env.PROJECTS_ROOT || "/data/projects"), projectDir = path.resolve(root, id);
        if (projectDir === root || !projectDir.startsWith(root + path.sep)) {
            throw new BadRequestException("项目目录不合法，拒绝删除")
        }
        await rm(projectDir, {recursive: true, force: true});
        await this.db.project.delete({where: {id}});
        return {id}
    }

    async import(request: any) {
        const file = await request.file();
        if (!file || !file.filename.toLowerCase().endsWith(".zip")) throw new BadRequestException("请上传ZIP压缩包");
        const root = process.env.PROJECTS_ROOT || "/data/projects", project = await this.db.project.create({
                data: {
                    name: file.fields?.name?.value || file.filename.replace(/\.zip$/i, ""),
                    workspacePath: "pending-" + Date.now()
                }
            }), workspace = path.join(root, project.id), archive = path.join(workspace, "upload.zip"),
            extract = path.join(workspace, "source");
        await mkdir(workspace, {recursive: true});
        await pipeline(file.file, createWriteStream(archive));
        await safeExtract(archive, extract);
        const projectRoot = await findProjectRoot(extract), matrixData = path.join(projectRoot, ".matrix", "data");
        let names: string[] = [];
        try {
            names = await readdir(matrixData)
        } catch {
        }
        const missing = REQUIRED.filter(x => !names.includes(x)), hasMatrix = names.length > 0,
            status = !hasMatrix ? "PENDING_GENERATION" : missing.length ? "INCOMPLETE_MATRIX" : "READY_FOR_REVIEW",
            updated = await this.db.project.update({
                where: {id: project.id},
                data: {workspacePath: projectRoot, status, missingArtifacts: missing}
            });
        await documentQueue.add("index-project", {
            projectId: project.id,
            workspacePath: projectRoot
        }, {jobId: `document-index-${project.id}`, removeOnComplete: true});
        return updated
    }
}

@Controller("projects")
export class ProjectsController {
    constructor(private projects: ProjectsService) {
    }

    @Get() list() {
        return this.projects.list()
    }

    @Get(":id") get(@Param("id") id: string) {
        return this.projects.get(id)
    }

    @Delete(":id") remove(@Param("id") id: string) {
        return this.projects.remove(id)
    }

    @Post("import") import(@Req() req: any) {
        return this.projects.import(req)
    }
}
