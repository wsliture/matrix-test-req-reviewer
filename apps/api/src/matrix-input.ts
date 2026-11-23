import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {readdir} from "node:fs/promises";
import path from "node:path";

export async function docxFingerprint(root: string) {
    const documents: string[] = [];
    async function walk(directory: string, relative: string) {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const name = relative + entry.name;
            if (entry.isDirectory()) await walk(path.join(directory, entry.name), name + "/");
            else if (entry.isFile() && /\.docx$/i.test(entry.name)) documents.push(name);
        }
    }
    await walk(root, "");
    const inputs = [];
    for (const name of documents.sort()) {
        const digest = createHash("sha256");
        for await (const chunk of createReadStream(path.join(root, name))) digest.update(chunk);
        inputs.push([name, digest.digest("hex")]);
    }
    return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}
