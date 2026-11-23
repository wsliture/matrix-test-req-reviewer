import {afterEach, describe, expect, it} from "vitest";
import iconv from "iconv-lite";
import {decodeZipEntryPath, safeExtract} from "../src/archive.js";
import PizZip from "pizzip";
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

const temporaryDirectories: string[] = [];

async function archive(files: Record<string, string>) {
    const root = await mkdtemp(path.join(tmpdir(), "matrix-archive-"));
    temporaryDirectories.push(root);
    const zip = new PizZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content);
    const file = path.join(root, "source.zip");
    await writeFile(file, zip.generate({type: "nodebuffer"}));
    return {root, file, extract: path.join(root, "extract")}
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {recursive: true, force: true})))
});

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

describe("DOCX-only project archives", () => {
    it("accepts archives containing only DOCX files", async () => {
        const value = await archive({"源文档/需求规格说明书.docx": "docx", "源文档/使用手册.DOCX": "docx"});
        await expect(safeExtract(value.file, value.extract, {docxOnly: true})).resolves.toMatchObject({documentCount: 2})
    });

    it("rejects PDF and other non-DOCX files", async () => {
        const value = await archive({"需求规格说明书.docx": "docx", "说明.pdf": "pdf"});
        await expect(safeExtract(value.file, value.extract, {docxOnly: true})).rejects.toThrow("非DOCX文件")
    });

    it("extracts all DOCX files from mixed Matrix archives", async () => {
        const value = await archive({"inputs/spec.docx": "spec", "inputs/manual.DOCX": "manual", "inputs/notes.txt": "skip"});
        await expect(safeExtract(value.file, value.extract, {docxOnly: true, skipOtherFiles: true}))
            .resolves.toMatchObject({documentCount: 2});
        expect((await readdir(path.join(value.extract, "inputs"))).sort()).toEqual(["manual.DOCX", "spec.docx"]);
        expect(await readFile(path.join(value.extract, "inputs", "spec.docx"), "utf8")).toBe("spec");
    });

    it("rejects mixed archives with no DOCX or a traversal among skipped files", async () => {
        const noDocx = await archive({"notes.txt": "skip"});
        const traversal = await archive({"spec.docx": "spec", "../notes.txt": "escape"});
        await expect(safeExtract(noDocx.file, noDocx.extract, {docxOnly: true, skipOtherFiles: true})).rejects.toThrow("至少");
        await expect(safeExtract(traversal.file, traversal.extract, {docxOnly: true, skipOtherFiles: true})).rejects.toThrow("非法路径");
    });

    it("rejects duplicate paths including case variants", async () => {
        const value = await archive({"inputs/Spec.docx": "one", "inputs/spec.docx": "two"});
        await expect(safeExtract(value.file, value.extract, {docxOnly: true, skipOtherFiles: true})).rejects.toThrow("重复路径");
    });

    it("rejects uploaded Matrix artifacts", async () => {
        const value = await archive({"需求规格说明书.docx": "docx", ".matrix/data/chapter1-scope.json": "{}"});
        await expect(safeExtract(value.file, value.extract, {docxOnly: true})).rejects.toThrow(".matrix目录")
    });
});
