import {describe, expect, it} from "vitest";
import {chapterWarningForBlock} from "./chapterWarning";
import type {Phase2Chapter} from "./api";

const chapter = (warnings?: string[], skippedCount?: number): Phase2Chapter => ({
    artifact: "chapter1-scope.json", number: "1", title: "范围", warnings, skippedCount,
    blocks: [{type: "paragraph", text: "前置内容"}, {type: "heading", text: "1 范围"}, {type: "heading", text: "1.1 标识"}]
});

describe("chapter warning placement", () => {
    it("attaches all warnings only to the first heading", () => {
        const value = chapter(["警告一", "警告二"], 2);
        expect(chapterWarningForBlock(value, 0)).toBeUndefined();
        expect(chapterWarningForBlock(value, 1)).toEqual({warnings: ["警告一", "警告二"], skippedCount: 2});
        expect(chapterWarningForBlock(value, 2)).toBeUndefined()
    });

    it("omits the indicator without warnings and normalizes an invalid count", () => {
        expect(chapterWarningForBlock(chapter([], 3), 1)).toBeUndefined();
        expect(chapterWarningForBlock(chapter(["警告"], -1), 1)?.skippedCount).toBe(0)
    })
});
