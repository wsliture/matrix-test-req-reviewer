import JSZip from "jszip";
import {XMLParser} from "fast-xml-parser";
import {createHash} from "node:crypto";
import {readFile, readdir, rm} from "node:fs/promises";
import path from "node:path";
import type {Pool} from "pg";

type Json = Record<string, any>;
type TocEntry = {segment_id: string; level: number; title: string; section_path_ids?: string[]; section_path_titles?: string[]};
type Paragraph = {text: string; paraId?: string; index: number};
type RequirementDraft = {id: string; businessId: string; nodeType: string; number?: string; title: string; level: number; parentId?: string; order: number; artifact: string; content: Json; sourceRefs: string[]};

const ARTIFACTS = [
    ["chapter1-scope.json", "1", "范围"], ["chapter2-system-overview.json", "2", "系统概述"],
    ["hardware-interface-model.json", "3.1", "硬件接口"], ["functional-test-content.json", "4.1", "功能测试"],
    ["performance-test-content.json", "4.2", "性能测试"], ["interface-test-content.json", "4.3", "接口测试"],
    ["reliability-safety-test-content.json", "4.4", "可靠性安全性测试"], ["margin-test-content.json", "4.5", "余量测试"],
    ["boundary-test-content.json", "4.6", "边界测试"], ["data-processing-test-content.json", "4.7", "数据处理测试"],
    ["recovery-test-content.json", "4.8", "恢复性测试"], ["strength-test-content.json", "4.9", "强度测试"],
    ["phase2-test-traceability.json", "6", "测试需求覆盖性说明"]
] as const;

const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: "@_", isArray: name => ["w:p", "w:r", "w:t"].includes(name)});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const stableId = (prefix: string, value: string) => `${prefix}-${hash(value).slice(0, 24)}`;
const asArray = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const canonicalSegmentId = (value: string) => value.replace(/__\d+$/, "");

function chapterToc(items: TocEntry[]): TocEntry[] {
    const result: TocEntry[] = [], seen = new Set<string>();
    for (const item of items) {
        const segmentId = canonicalSegmentId(item.segment_id);
        if (seen.has(segmentId)) continue;
        seen.add(segmentId);
        result.push({...item, segment_id: segmentId, section_path_ids: item.section_path_ids?.map(canonicalSegmentId)})
    }
    return result
}

function textOf(value: any): string {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    if (typeof value === "object") return Object.entries(value).filter(([key]) => key !== "w:tab" && !key.startsWith("@_")).map(([, item]) => textOf(item)).join("");
    return ""
}

async function paragraphsOf(file: string): Promise<Paragraph[]> {
    const zip = await JSZip.loadAsync(await readFile(file)), xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("DOCX缺少word/document.xml");
    const doc = parser.parse(xml), body = doc?.["w:document"]?.["w:body"], paragraphs = asArray(body?.["w:p"]);
    return paragraphs.map((paragraph: any, index) => ({
        text: textOf(paragraph?.["w:r"]).replace(/\s+/g, " ").trim(),
        paraId: paragraph?.["@_w14:paraId"], index
    }))
}

async function docxFiles(root: string): Promise<string[]> {
    const result: string[] = [];
    for (const entry of await readdir(root, {withFileTypes: true})) {
        if (entry.name === "node_modules" || entry.name === ".matrix") continue;
        const value = path.join(root, entry.name);
        if (entry.isDirectory()) result.push(...await docxFiles(value));
        else if (entry.name.toLowerCase().endsWith(".docx")) result.push(value)
    }
    return result
}

async function readJson(file: string): Promise<Json | undefined> {
    try { return JSON.parse(await readFile(file, "utf8")) } catch { return undefined }
}

function sourceDescriptors(workspace: string, artifacts?: Json) {
    const values: {file: string; prefix: string; toc?: string}[] = [];
    if (artifacts?.primary_document) values.push({file: artifacts.primary_document.path, prefix: "primary", toc: artifacts.primary_document.toc_path});
    for (const item of artifacts?.supporting_documents || []) {
        const folder = path.basename(path.dirname(item.toc_path || ""));
        values.push({file: item.path, prefix: `supporting-${folder}`, toc: item.toc_path})
    }
    return values.map(item => ({...item, file: path.join(workspace, path.basename(item.file)), toc: item.toc ? path.join(workspace, ".matrix", "data", ...item.toc.replace(/\\/g, "/").split("/.matrix/data/").pop()!.split("/")) : undefined}))
}

async function indexDocuments(db: Pool, projectId: string, workspace: string) {
    const dataDir = path.join(workspace, ".matrix", "data"), artifacts = await readJson(path.join(dataDir, "source-artifacts.json"));
    const descriptors = sourceDescriptors(workspace, artifacts), files = await docxFiles(workspace), activeDocumentIds: string[] = [];
    for (const file of files) {
        const descriptor = descriptors.find(item => path.basename(item.file).toLowerCase() === path.basename(file).toLowerCase());
        const prefix = descriptor?.prefix || `document-${hash(path.basename(file)).slice(0, 8)}`, documentId = stableId("doc", `${projectId}:${path.basename(file)}`);
        activeDocumentIds.push(documentId);
        try {
            const buffer = await readFile(file), paragraphs = await paragraphsOf(file), tocJson = descriptor?.toc ? await readJson(descriptor.toc) : undefined;
            let toc = chapterToc((tocJson?.toc || []) as TocEntry[]);
            if (!toc.length) toc = paragraphs.filter(item => /^(\d+(?:\.\d+)*)\s+\S/.test(item.text)).map(item => {
                const match = item.text.match(/^(\d+(?:\.\d+)*)\s+(.+)$/)!;
                return {segment_id: `SRS-${match[1]}`, level: match[1].split(".").length, title: match[2]}
            });
            await db.query('insert into "Document" (id,"projectId",name,"objectKey","fileHash","parseStatus","parseError","outline") values ($1,$2,$3,$4,$5,$6,null,$7) on conflict (id) do update set "objectKey"=excluded."objectKey","fileHash"=excluded."fileHash","parseStatus"=excluded."parseStatus","parseError"=null,"outline"=excluded."outline"', [documentId, projectId, path.basename(file), file, hash(buffer.toString("binary")), "READY", JSON.stringify(toc)]);
            await db.query('delete from "DocumentNode" where "documentId"=$1', [documentId]);
            const nodeIds = new Map<string, string>();
            let searchFrom = 0;
            for (let order = 0; order < toc.length; order++) {
                const item = toc[order], sourceRef = `${prefix}::${item.segment_id}`, id = stableId("dn", `${documentId}:${sourceRef}`);
                const normalized = item.title.replace(/\s+/g, "").toLowerCase();
                let paragraph = paragraphs.find(value => value.index >= searchFrom && value.text.replace(/\s+/g, "").toLowerCase().includes(normalized));
                if (!paragraph) paragraph = paragraphs.find(value => value.text.replace(/\s+/g, "").toLowerCase().includes(normalized));
                if (paragraph) searchFrom = paragraph.index + 1;
                const pathIds = item.section_path_ids || [], parentRef = pathIds.length > 1 ? `${prefix}::${pathIds[pathIds.length - 2]}` : undefined,
                    number = item.segment_id.replace(/^SRS-/, "").replace(/^00+(?=\d)/, ""), headingPath = item.section_path_titles || [item.title];
                await db.query('insert into "DocumentNode" (id,"documentId","sourceRef","number",title,text,level,"parentId","orderIndex","paragraphIndex","paraId","textHash","headingPath") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [id, documentId, sourceRef, number === "PREAMBLE" ? null : number, item.title, paragraph?.text, item.level, parentRef ? nodeIds.get(parentRef) || null : null, order, paragraph?.index, paragraph?.paraId, hash(paragraph?.text || item.title), JSON.stringify(headingPath)]);
                nodeIds.set(sourceRef, id)
            }
        } catch (error) {
            await db.query('insert into "Document" (id,"projectId",name,"objectKey","parseStatus","parseError") values ($1,$2,$3,$4,$5,$6) on conflict (id) do update set "parseStatus"=excluded."parseStatus","parseError"=excluded."parseError"', [documentId, projectId, path.basename(file), file, "FAILED", error instanceof Error ? error.message : String(error)])
        }
    }
    if (activeDocumentIds.length) await db.query('delete from "Document" where "projectId"=$1 and not (id=any($2::text[]))', [projectId, activeDocumentIds]);
}

function sourceRefsOf(value: Json) {
    return [...new Set([value.source_ref, ...asArray(value.source_refs)].filter(item => typeof item === "string"))] as string[]
}

function findNumber(value: Json) { return value.title_no || value.section_title_no || value.chapter_title_no || value.requirement_no }
function findTitle(value: Json) { return value.title || value.section_title || value.chapter_title || value.name }

function collectRequirements(value: any, artifact: string, drafts: RequirementDraft[], parentId?: string, parentLevel = 0) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(item => collectRequirements(item, artifact, drafts, parentId, parentLevel));
    const requirementId = typeof value.requirement_id === "string" ? value.requirement_id : undefined,
        number = findNumber(value), rawTitle = findTitle(value), title = requirementId ? String(value.content || rawTitle || requirementId).slice(0, 100) : rawTitle,
        isNode = Boolean(requirementId || (number && title));
    let currentParent = parentId, level = parentLevel;
    if (isNode) {
        const businessId = requirementId || `${artifact}:${number}:${title}`, existing = drafts.find(item => item.businessId === businessId);
        if (!existing) {
            level = requirementId ? parentLevel + 1 : typeof number === "string" ? number.split(".").length : parentLevel + 1;
            const id = stableId("trn", businessId);
            drafts.push({id, businessId, nodeType: requirementId ? "requirement" : "section", number: requirementId || number, title: String(title), level, parentId, order: drafts.length, artifact, content: value, sourceRefs: sourceRefsOf(value)});
            currentParent = id
        } else {
            currentParent = existing.id;
            level = existing.level
        }
    }
    for (const [key, child] of Object.entries(value)) {
        if (["source_ref", "source_refs", "content", "summary", "input_flow", "output_flow", "rows", "columns"].includes(key)) continue;
        collectRequirements(child, artifact, drafts, currentParent, level)
    }
}

async function indexRequirements(db: Pool, projectId: string, workspace: string) {
    const dataDir = path.join(workspace, ".matrix", "data"), drafts: RequirementDraft[] = [];
    for (const [artifact, number, title] of ARTIFACTS) {
        const data = await readJson(path.join(dataDir, artifact));
        if (!data) continue;
        const rootId = stableId("trn", `${artifact}:${number}:${title}`);
        drafts.push({id: rootId, businessId: `${artifact}:${number}:${title}`, nodeType: "section", number, title, level: number.split(".").length, order: drafts.length, artifact, content: data, sourceRefs: sourceRefsOf(data)});
        collectRequirements(data, artifact, drafts, rootId, number.split(".").length)
    }
    await db.query('delete from "TestRequirementNode" where "projectId"=$1', [projectId]);
    for (const item of drafts) await db.query('insert into "TestRequirementNode" (id,"projectId","businessId","nodeType",number,title,level,"parentId","orderIndex",artifact,content,"sourceRefs") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [item.id, projectId, item.businessId, item.nodeType, item.number, item.title, item.level, item.parentId || null, item.order, item.artifact, JSON.stringify(item.content), JSON.stringify(item.sourceRefs)]);
    await db.query('delete from "TraceLink" where "projectId"=$1', [projectId]);
    const sourceRows = await db.query('select d.id,d."sourceRef" from "DocumentNode" d join "Document" doc on doc.id=d."documentId" where doc."projectId"=$1', [projectId]),
        sourceMap = new Map(sourceRows.rows.map(row => [row.sourceRef, row.id])), targetMap = new Map(drafts.map(item => [item.businessId, item.id]));
    const links = new Set<string>();
    const add = async (sourceRef: string, businessId: string, source: string) => {
        const sourceId = sourceMap.get(sourceRef), targetId = targetMap.get(businessId), key = `${sourceId}:${targetId}`;
        if (!sourceId || !targetId || links.has(key)) return;
        links.add(key);
        await db.query('insert into "TraceLink" (id,"projectId","sourceNodeId","targetNodeId",source) values ($1,$2,$3,$4,$5)', [stableId("tl", key), projectId, sourceId, targetId, source])
    };
    const trace = await readJson(path.join(dataDir, "phase2-test-traceability.json"));
    for (const row of trace?.rows || []) for (const requirementId of row.test_requirement_ids || []) await add(row.source_ref, requirementId, "phase2-test-traceability.json");
    for (const item of drafts) for (const sourceRef of item.sourceRefs) await add(sourceRef, item.businessId, item.artifact)
}

export async function indexProject(db: Pool, projectId: string, workspace: string) {
    await rm(path.join(path.dirname(workspace), "preview"), {recursive: true, force: true});
    await indexDocuments(db, projectId, workspace);
    await indexRequirements(db, projectId, workspace)
}
