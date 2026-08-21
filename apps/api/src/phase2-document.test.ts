import {describe, expect, it} from "vitest";
import {cleanTableTitle, formatFunctionalFlowItems, normalizedTable} from "./phase2-document.js";

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
