import {ConflictException, Controller, Get, Injectable, MessageEvent, Param, Post, Sse} from "@nestjs/common";
import {Queue} from "bullmq";
import {Redis} from "ioredis";
import {interval, map, Observable, startWith, switchMap} from "rxjs";
import {PrismaService} from "./prisma.js";
import {createOpencodeClient} from "@opencode-ai/sdk/v2";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {maxRetriesPerRequest: null}),
    queue = new Queue("phase2", {connection: redis}),
    auth = Buffer.from(`${process.env.OPENCODE_USERNAME || "opencode"}:${process.env.OPENCODE_PASSWORD || ""}`).toString("base64"),
    opencode = createOpencodeClient({
        baseUrl: process.env.OPENCODE_URL || "http://localhost:4096",
        headers: {Authorization: `Basic ${auth}`}
    });

@Injectable()
export class RunsService {
    constructor(private db: PrismaService) {
    }

    async create(projectId: string) {
        const active = await this.db.phase2Run.findFirst({where: {projectId, status: {in: ["QUEUED", "RUNNING"]}}});
        if (active) throw new ConflictException("该项目已有Phase 2任务");
        const edit = await this.db.phase2EditRun.findFirst({where: {projectId, status: {in: ["QUEUED", "RUNNING"]}}});
        if (edit) throw new ConflictException("该项目正在编辑重建");
        const run = await this.db.phase2Run.create({data: {projectId}});
        await this.db.project.update({where: {id: projectId}, data: {status: "GENERATING"}});
        await this.db.runEvent.create({data: {runId: run.id, type: "run.queued", payload: {projectId}}});
        await queue.add("matrix-phase2", {runId: run.id, projectId}, {
            jobId: run.id,
            removeOnComplete: 100,
            removeOnFail: 100
        });
        return run
    }

    async get(id: string) {
        const run = await this.db.phase2Run.findUniqueOrThrow({
            where: {id},
            include: {events: {orderBy: {id: "desc"}, take: 100}}
        });
        return {...run, events: run.events.map(item => ({...item, id: item.id.toString()}))}
    }

    async cancel(id: string) {
        const run = await this.db.phase2Run.findUniqueOrThrow({where: {id}, include: {project: true}});
        if (!(["QUEUED", "RUNNING"] as string[]).includes(run.status)) throw new ConflictException("任务已经结束，无法终止");
        const updated = await this.db.phase2Run.update({
            where: {id},
            data: {status: "CANCELLED", finishedAt: new Date(), errorMessage: null}
        });
        await this.db.runEvent.create({data: {runId: id, type: "run.cancelled", payload: {}}});
        const job = await queue.getJob(id), state = await job?.getState();
        if (job && state !== "active") await job.remove();
        if (run.opencodeSessionId) {
            await opencode.session.abort({
                sessionID: run.opencodeSessionId,
                directory: run.project.workspacePath
            }).catch(() => undefined)
        }
        const missing = Array.isArray(run.project.missingArtifacts) ? run.project.missingArtifacts.length : 0;
        await this.db.project.update({
            where: {id: run.projectId},
            data: {status: missing === 0 ? "READY_FOR_REVIEW" : missing >= 13 ? "PENDING_GENERATION" : "INCOMPLETE_MATRIX"}
        });
        return updated
    }

    events(id: string): Observable<MessageEvent> {
        let cursor = BigInt(0);
        return interval(1000).pipe(startWith(0), switchMap(() => this.db.runEvent.findMany({
            where: {
                runId: id,
                id: {gt: cursor}
            }, orderBy: {id: "asc"}
        })), map(rows => {
            if (rows.length) cursor = rows.at(-1)!.id;
            return {type: "run-events", data: rows.map(row => ({...row, id: row.id.toString()}))}
        }))
    }
}

@Controller("phase2-runs")
export class RunsController {
    constructor(private runs: RunsService) {
    }

    @Post("project/:projectId") create(@Param("projectId") id: string) {
        return this.runs.create(id)
    }

    @Get(":id") get(@Param("id") id: string) {
        return this.runs.get(id)
    }

    @Post(":id/cancel") cancel(@Param("id") id: string) {
        return this.runs.cancel(id)
    }

    @Sse(":id/events") events(@Param("id") id: string) {
        return this.runs.events(id)
    }
}
