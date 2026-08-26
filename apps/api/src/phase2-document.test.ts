import {mkdtemp, mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {
    buildPhase2Document,
    chapter1DisplayReferences,
    cleanTableTitle,
    formatChapter2Processor,
    formatFunctionalFlowItems,
    normalizedTable
} from "./phase2-document.js";

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

describe("chapter 1 and chapter 2 presentation contracts", () => {
    it("prepends fixed references and programming conventions and deduplicates by document id", () => {
        const references = chapter1DisplayReferences({
            programming_languages: ["mcs51_assembly", "c", "x86_assembly", "c"],
            references: [
                {document_id: "Q/W-Q80-18-01-2014", document_title: "重复C约定"},
                {document_id: "RX03", document_title: "需求规格说明"}
            ]
        });
        expect(references.slice(0, 3).map(item => item.document_id)).toEqual([
            "GJB/Z 141-2004", "QJ 3027A-2016", "Q/QJA 300-2014"
        ]);
        expect(references.map(item => item.document_id).slice(7)).toEqual([
            "Q/W 1139-2007", "Q/W-Q80-18-01-2014", "Q/W 1141-2007", "RX03"
        ]);
        expect(references.filter(item => item.document_id === "Q/W-Q80-18-01-2014")).toHaveLength(1)
    });

    it("formats processor type and frequency with explicit labels", () => {
        expect(formatChapter2Processor("BM3803", "48MHz")).toBe("CPU：BM3803，主频：48MHz");
        expect(formatChapter2Processor("BM3803", "")).toBe("CPU：BM3803");
        expect(formatChapter2Processor("", "48MHz")).toBe("主频：48MHz");
        expect(formatChapter2Processor("", "")).toBe("")
    });

    it("renders the canonical five-column interrupt contract and ignores legacy fields", async () => {
        const workspace = await mkdtemp(path.join(tmpdir(), "phase2-document-"));
        const dataDir = path.join(workspace, ".matrix", "data");
        await mkdir(dataDir, {recursive: true});
        await writeFile(path.join(dataDir, "chapter2-system-overview.json"), JSON.stringify({
            processor_type: "BM3803",
            processor_frequency: "48MHz",
            interrupts: [{
                interrupt_name: "遥控PCM采集中断",
                priority: "最高",
                frequency_or_random: "随机（频繁）",
                trigger_mode: "IO中断",
                execution_function: "采集PCM码流数据",
                number: "不应显示",
                purpose: "不应显示"
            }]
        }));
        const document = await buildPhase2Document(workspace, []);
        const chapter = document.chapters.find(item => item.number === "2");
        const processor = chapter?.blocks.find(block => block.type === "paragraph" && block.text?.startsWith("b. "));
        const interrupt = chapter?.blocks.find(block => block.type === "table" && block.caption?.includes("中断使用说明"));
        expect(processor?.text).toBe("b. CPU：BM3803，主频：48MHz");
        expect(interrupt?.columns).toEqual(["中断名称", "优先级", "周期（触发频率）/随机（频繁/偶发）", "触发方式", "执行功能"]);
        expect(interrupt?.rows).toEqual([["遥控PCM采集中断", "最高", "随机（频繁）", "IO中断", "采集PCM码流数据"]]);
        expect(JSON.stringify(interrupt)).not.toContain("不应显示")
    })
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
