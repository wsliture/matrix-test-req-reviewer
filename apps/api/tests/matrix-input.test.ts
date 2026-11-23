import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {expect, it} from "vitest";
import {docxFingerprint} from "../src/matrix-input.js";

it("fingerprints DOCX paths and contents independently of file order and other files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "matrix-fingerprint-"));
    const left = path.join(root, "left", "input"), right = path.join(root, "right", "input");
    try {
        await mkdir(left, {recursive: true});
        await mkdir(right, {recursive: true});
        await writeFile(path.join(left, "a.DOCX"), "spec");
        await writeFile(path.join(left, "b.docx"), "manual");
        await writeFile(path.join(right, "b.docx"), "manual");
        await writeFile(path.join(right, "a.DOCX"), "spec");
        await writeFile(path.join(right, "notes.txt"), "ignored");
        const baseline = await docxFingerprint(path.dirname(left));
        expect(await docxFingerprint(path.dirname(right))).toBe(baseline);
        expect(await docxFingerprint(right)).not.toBe(baseline);
        await writeFile(path.join(right, "a.DOCX"), "updated");
        expect(await docxFingerprint(path.dirname(right))).not.toBe(baseline);
    } finally {
        await rm(root, {recursive: true, force: true});
    }
});
