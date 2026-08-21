import {BadRequestException, ConflictException, Controller, ForbiddenException, Get, Put, Req, Body} from "@nestjs/common";
import {PrismaService} from "./prisma.js";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";

const configDirectory = process.env.OPENCODE_CONFIG_DIR || "/opencode-config";
const configPath = path.join(configDirectory, "opencode.json");
const restartPath = path.join(configDirectory, ".restart-request");
const appliedPath = path.join(configDirectory, ".restart-applied");
const matrixPlugin = "file:///plugin/dist/index.js";

function requireAdmin(request: any) {
    if (request.user?.role !== "ADMIN") throw new ForbiddenException("仅管理员可以修改系统设置")
}

async function healthy() {
    const auth = Buffer.from(`${process.env.OPENCODE_USERNAME || "opencode"}:${process.env.OPENCODE_PASSWORD || ""}`).toString("base64");
    try {
        const response = await fetch(`${process.env.OPENCODE_URL || "http://opencode:4096"}/global/health`, {
            headers: {Authorization: `Basic ${auth}`}, signal: AbortSignal.timeout(2000)
        });
        return response.ok
    } catch {
        return false
    }
}

@Controller("settings")
export class SettingsController {
    constructor(private db: PrismaService) {
    }

    @Get("opencode") async getOpenCode(@Req() request: any) {
        requireAdmin(request);
        return {content: await readFile(configPath, "utf8")}
    }

    @Put("opencode") async updateOpenCode(@Req() request: any, @Body() body: { content?: string }) {
        requireAdmin(request);
        if (await this.db.phase2Run.count({where: {status: {in: ["QUEUED", "RUNNING"]}}})) {
            throw new ConflictException("存在正在排队或运行的测试需求生成任务，请先终止任务")
        }
        let value: Record<string, unknown>;
        try {
            value = JSON.parse(body.content || "")
        } catch {
            throw new BadRequestException("OpenCode配置不是合法JSON")
        }
        if (!value || Array.isArray(value) || typeof value !== "object") throw new BadRequestException("OpenCode配置必须是JSON对象");
        const plugins = Array.isArray(value.plugin) ? value.plugin.filter(item => typeof item === "string") : [];
        if (!plugins.includes(matrixPlugin)) plugins.push(matrixPlugin);
        value.plugin = plugins;
        const content = JSON.stringify(value, null, 2) + "\n", token = randomUUID();
        await mkdir(configDirectory, {recursive: true});
        const temporary = `${configPath}.${token}.tmp`;
        await writeFile(temporary, content, {encoding: "utf8", mode: 0o600});
        await rename(temporary, configPath);
        await writeFile(restartPath, token, "utf8");
        await this.db.auditLog.create({data: {
            userId: request.user.id, action: "OPENCODE_CONFIG_CHANGED", resourceType: "SystemSetting", resourceId: "opencode"
        }});
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const applied = await readFile(appliedPath, "utf8").catch(() => "");
            if (applied.trim() === token && await healthy()) return {content}
        }
        throw new ConflictException("配置已保存，但OpenCode服务未能在30秒内恢复，请检查服务日志")
    }
}
