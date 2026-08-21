import {mkdtemp, mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {buildPhase2Document, cleanTableTitle, formatFunctionalFlowItems, normalizedTable} from "./phase2-document.js";

describe("formatFunctionalFlowItems", () => {
    it("formats multiple flows with alphabetic labels and Chinese punctuation", () => {
        expect(formatFunctionalFlowItems(["速变遥测轮询控制序列", "缓变遥测轮询控制序列"])).toEqual([
            "a. 速变遥测轮询控制序列；",
            "b. 缓变遥测轮询控制序列。"
        ]);
    });

    it("normalizes terminal punctuation for a single flow", () => {
        expect(formatFunctionalFlowItems(["负载控制指令；"])).toEqual(["负载控制指令。"]);
    });

    it("renders empty and no-flow values consistently", () => {
        expect(formatFunctionalFlowItems([])).toEqual(["无。"]);
        expect(formatFunctionalFlowItems(["无。", "无；"])).toEqual(["无。"]);
    });
});

describe("system overview table rendering", () => {
    it("keeps array-based rows populated", () => {
        const result = normalizedTable({
            title: "表 3.3-1 80C32 系统 P1 端口位定义",
            columns: ["序号", "地址", "定义", "使用说明"],
            rows: [["1", "P1.0", "A 主加热器控制信号", "0 加热，1 关闭"]]
        }, "存储器及I/O说明表");

        expect(result?.rows).toEqual([["1", "P1.0", "A 主加热器控制信号", "0 加热，1 关闭"]]);
    });

    it("removes the source table number before assigning the Phase 2 number", () => {
        expect(cleanTableTitle("表 3.3-1 80C32 系统 P1 端口位定义")).toBe("80C32 系统 P1 端口位定义");
        expect(cleanTableTitle("表 3.2.3-1 遥测参数通道地址表")).toBe("遥测参数通道地址表");
    });
});

describe("hardware interface anchors", () => {
    it("binds fourth-level topic headings to their indexed node", async () => {
        const workspace = await mkdtemp(path.join(tmpdir(), "phase2-document-"));
        const dataDir = path.join(workspace, ".matrix", "data");
        await mkdir(dataDir, {recursive: true});
        await writeFile(path.join(dataDir, "hardware-interface-model.json"), JSON.stringify({
            chapter_title: "数据及接口需求",
            section_title: "硬件接口",
            interfaces: [{title: "CAN总线接口及相关数据流", topics: [{title: "速变遥测轮询及相关数据流"}]}]
        }));
        const requirements = [
            {id: "hardware-root", businessId: "hardware-root", artifact: "hardware-interface-model.json", number: "3.1", parentId: null},
            {id: "hardware-interface", businessId: "hardware-interface", artifact: "hardware-interface-model.json", number: "3.1.1", parentId: "hardware-root"},
            {id: "hardware-topic", businessId: "hardware-topic", artifact: "hardware-interface-model.json", number: "3.1.1.1", parentId: "hardware-interface"}
        ];

        const document = await buildPhase2Document(workspace, requirements);
        const hardware = document.chapters.find(chapter => chapter.number === "3.1");

        expect(hardware?.blocks).toContainEqual(expect.objectContaining({
            type: "heading",
            text: "3.1.1.1 速变遥测轮询及相关数据流",
            anchorId: "hardware-topic",
            businessId: "hardware-topic"
        }));
    });
});
