import {describe, expect, it} from "vitest";
import iconv from "iconv-lite";
import {decodeZipEntryPath} from "./archive.js";

function entry(pathBuffer: Buffer, isUnicode = false) {
    return {path: pathBuffer.toString("utf8"), pathBuffer, isUnicode} as any
}

describe("ZIP entry filename decoding", () => {
    it("decodes Windows GBK Chinese filenames", () => {
        const value = "cnas需求规格说明书.docx";
        expect(decodeZipEntryPath(entry(iconv.encode(value, "gb18030")))).toBe(value)
    });

    it("keeps valid UTF-8 filenames without the Unicode flag", () => {
        const value = "需求规格说明书.docx";
        expect(decodeZipEntryPath(entry(Buffer.from(value)))).toBe(value)
    });

    it("uses UTF-8 when the ZIP Unicode flag is set", () => {
        const value = "80C32使用手册.docx";
        expect(decodeZipEntryPath(entry(Buffer.from(value), true))).toBe(value)
    });

    it("keeps ASCII filenames unchanged", () => {
        const value = "PHILIPS_SJA1000T_2000.docx";
        expect(decodeZipEntryPath(entry(Buffer.from(value)))).toBe(value)
    })
});
