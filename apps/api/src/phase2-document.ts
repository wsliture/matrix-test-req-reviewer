import {readFile} from "node:fs/promises";
import path from "node:path";

type Json = Record<string, any>;
export type Phase2Block = {
    type: "heading" | "paragraph" | "list" | "table" | "error";
    text?: string;
    level?: number;
    anchorId?: string;
    evaluable?: boolean;
    businessId?: string;
    sourceRefs?: string[];
    items?: string[];
    caption?: string;
    columns?: string[];
    rows?: string[][];
    cells?: { text: string; colSpan?: number; rowSpan?: number }[][];
    rowAnchorIds?: (string | undefined)[];
};
export type Phase2Chapter = {
    artifact: string;
    number: string;
    title: string;
    rootNodeId?: string;
    blocks: Phase2Block[]
};

const TEST_TYPES = [
    ["TR-GN-YYY-XXX", "功能测试"], ["TR-XN-XXX", "性能测试"], ["TR-JK-XXX", "接口测试"],
    ["TR-AQ-XXX", "可靠性安全性测试"], ["TR-YL-XXX", "余量测试"], ["TR-BJ-XXX", "边界测试"],
    ["TR-SC-XXX", "数据处理测试"], ["TR-HF-XXX", "恢复性测试"], ["TR-QD-XXX", "强度测试"],
    ["TR-DS-ALL", "代码审查"], ["TR-JF-ALL", "静态分析"], ["TR-LJ-ALL", "逻辑测试"]
];
const FILES = [
    ["chapter1-scope.json", "1", "范围"], ["chapter2-system-overview.json", "2", "系统概述"],
    ["hardware-interface-model.json", "3.1", "硬件接口"], ["functional-test-content.json", "4.1", "功能测试"],
    ["performance-test-content.json", "4.2", "性能测试"], ["interface-test-content.json", "4.3", "接口测试"],
    ["reliability-safety-test-content.json", "4.4", "可靠性安全性测试"], ["margin-test-content.json", "4.5", "余量测试"],
    ["boundary-test-content.json", "4.6", "边界测试"], ["data-processing-test-content.json", "4.7", "数据处理测试"],
    ["recovery-test-content.json", "4.8", "恢复性测试"], ["strength-test-content.json", "4.9", "强度测试"],
    ["phase2-test-traceability.json", "6", "测试需求覆盖性说明"]
] as const;

const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const list = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const flowList = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : text(value) ? [text(value)] : [];

export function formatFunctionalFlowItems(value: unknown): string[] {
    const items = flowList(value).map(item => item.replace(/[。；]+$/u, "").trimEnd()).filter(Boolean);
    if (!items.length || items.every(item => item === "无")) return ["无。"];
    if (items.length === 1) return [`${items[0]}。`];
    return items.map((item, index) => `${alpha(index)}. ${item}${index === items.length - 1 ? "。" : "；"}`)
}

const refs = (value: Json) => [...new Set([value?.source_ref, ...(Array.isArray(value?.source_refs) ? value.source_refs : [])].filter(item => typeof item === "string"))] as string[];
const heading = (value: string, level: number, anchorId?: string, sourceRefs?: string[], businessId?: string, evaluable = false): Phase2Block => ({
    type: "heading", text: value, level, anchorId, sourceRefs, businessId, ...(evaluable ? {evaluable: true} : {})
});
const paragraph = (value: unknown): Phase2Block => ({type: "paragraph", text: text(value)});
const table = (caption: string, columns: string[], rows: unknown[][]): Phase2Block => ({
    type: "table",
    caption,
    columns,
    rows: rows.map(row => row.map(item => text(item)))
});
const alpha = (index: number) => String.fromCharCode(97 + index);

function compressRequirementIds(ids: string[]) {
    const result: string[] = [];
    for (let index = 0; index < ids.length;) {
        const first = ids[index], match = first.match(/^(.*?)(\d+)$/);
        if (!match) {
            result.push(first);
            index++;
            continue
        }
        const prefix = match[1], width = match[2].length;
        let last = Number(match[2]), end = index;
        while (end + 1 < ids.length) {
            const next = ids[end + 1].match(/^(.*?)(\d+)$/);
            if (!next || next[1] !== prefix || next[2].length !== width || Number(next[2]) !== last + 1) break;
            last++;
            end++
        }
        result.push(end > index ? `${first}~${String(last).padStart(width, "0")}` : first);
        index = end + 1
    }
    return result
}

function maps(requirements: any[]) {
    const byBusiness = new Map(requirements.map(item => [item.businessId, item]));
    const byArtifactNumber = new Map(requirements.filter(item => item.number).map(item => [`${item.artifact}:${item.number}`, item]));
    const root = (artifact: string) => requirements.find(item => item.artifact === artifact && item.parentId == null);
    const anchor = (artifact: string, number?: string, businessId?: string) => (businessId ? byBusiness.get(businessId) : undefined) || (number ? byArtifactNumber.get(`${artifact}:${number}`) : undefined);
    return {root, anchor}
}

function chapter1(data: Json, artifact: string, lookup: ReturnType<typeof maps>): Phase2Block[] {
    const root = lookup.root(artifact), csci = list(data.csci_names).join("、"), documentId = text(data.document_id),
        renderedId = !documentId || documentId.endsWith(".RX1") ? documentId : `${documentId}.RX1`;
    const references = Array.isArray(data.references) ? data.references : [];
    return [
        heading("1 范围", 1, root?.id, refs(data), root?.businessId, true), heading("1.1 标识", 2),
        paragraph(`a. 文档标识：${renderedId}，版本号：${text(data.document_version)}；`),
        paragraph(`b. 本文标题：${text(data.software_name_and_id)}第三方测试需求；`), paragraph(`c. 委托单位：${text(data.model_name)}项目办；`),
        paragraph(`d. 委托单位地址：${text(data.client_address)}；`), paragraph("e. 缩略语："), paragraph("CSCI：计算机软件配置项；"), paragraph("TR：测试需求；"), paragraph("IF：接口。"),
        paragraph("f. 本文档适用的系统和计算机软件配置项（CSCI）："), paragraph(`本文档适用的系统是${text(data.system_name)}，对应的软件配置项为${csci}。`),
        heading("1.2 文档概述", 2), paragraph(`本文是${text(data.software_name_and_id)}的第三方测试需求，文中描述了该软件的测试范围，定义软件测试项及测试要求，为后续用例设计提供测试依据。本文档适用的代码版本为V${text(data.code_version)}。`),
        heading("1.3 依据文件和引用文档", 2), ...references.map((item: Json) => paragraph(`${text(item.document_id)}    ${text(item.document_title)}`)),
        heading("1.4 测试需求概述", 2), paragraph("依据委托方的要求，针对被测试软件，确定的测试级别为配置项测试，测试类型及其要求如下："),
        table("表1-1  测试类型总结表", ["序号", "测试类型标识", "测试类型"], TEST_TYPES.map((item, index) => [index + 1, ...item])),
        paragraph("注：ALL为固定符号，不需要改变；YYY为表明所描述需求项意义的符号，需要根据具体需求项进行更改；XXX为当前需求项序号；"),
        paragraph("软件测试项对应的测试要求包括测试充分性要求和测试终止要求两部分。"), paragraph("a. 测试充分性要求，分为如下5个方面："),
        ...["C1：针对上述测试类型，按照《军用软件测评实验室测评过程和技术能力要求》中的规定，设计的测试用例尽可能多地覆盖该测试类型中的要求；", "C2：测试过程中的所有需求项均被覆盖；", "C3：测试需求项测试需要设计有效等价类用例；", "C4：测试需求项测试设计的用例需要包括有效等价类、无效等价类；", "C5：测试需求项测试设计的用例需要包括边界数据值；", "b. 测试终止要求，分为如下3个方面：", "Z1：测试需求项的测试用例按照所设计的操作步骤完成，测试正常终止；", "Z2：测试需求项存在测试用例不能按照所设计的操作步骤完成，测试异常终止；", "Z3：不具备测试条件，不列入本次测试内容。"].map(paragraph)
    ]
}

function chapter2(data: Json, artifact: string, lookup: ReturnType<typeof maps>): Phase2Block[] {
    const root = lookup.root(artifact),
        blocks: Phase2Block[] = [heading("2 系统概述", 1, root?.id, refs(data), root?.businessId, true), heading("2.1 运行环境说明", 2)];
    const processor = [text(data.processor_type), text(data.processor_frequency)].filter(Boolean).join("，");
    blocks.push(paragraph(`a. ${text(data.system_relationship)}`), paragraph(`b. ${processor}`), paragraph(`c. ${text(data.memory_io_summary)}${data.memory_io_tables?.length ? `，具体见表2-1至表2-${data.memory_io_tables.length}。` : ""}`));
    (data.memory_io_tables || []).forEach((item: Json, index: number) => {
        const value = normalizedTable(item, `存储器及I/O说明表${index + 1}`);
        if (!value) return;
        value.caption = `表2-${index + 1}  ${cleanTableTitle(item.title) || `存储器及I/O说明表${index + 1}`}`;
        blocks.push(value)
    });
    const interruptNo = (data.memory_io_tables?.length || 0) + 1;
    blocks.push(paragraph("d. 中断使用情况如下表："), table(`表2-${interruptNo}  中断使用说明`, ["中断名称", "中断号", "优先级", "用途"], (data.interrupts || []).map((item: Json) => [item.name || item.interrupt_name, item.number || item.interrupt_no, item.priority, item.purpose || item.description])));
    blocks.push(heading("2.2 软件概述", 2), paragraph(`${text(data.software_name_and_id)}的软件级别为${text(data.software_level)}，采用${text(data.programming_language)}开发。`), paragraph("软件主要功能如下："), ...list(data.subsystem_and_software_functions).map((item, index) => paragraph(`${alpha(index)}. ${item}${/[；。]$/.test(item) ? "" : "；"}`)), heading("2.3 开发环境概述", 2), paragraph([text(data.development_platform), text(data.compilation_environment)].filter(Boolean).join("，") + "。"));
    return blocks
}

export function normalizedTable(item: Json, fallback: string): Phase2Block | undefined {
    const columns = list(item.columns), rows = Array.isArray(item.rows) ? item.rows : [];
    if (!columns.length) return undefined;
    const value = table(text(item.title) || fallback, columns, rows.map((row: Json | unknown[]) => Array.isArray(row) ? row : columns.map(column => row[column])));
    if (Array.isArray(item.cells)) value.cells = item.cells;
    return value
}

export function cleanTableTitle(value: unknown) {
    const title = text(value).replace(/<\/?w:[A-Za-z][^>]*>/giu, "").replace(/<\/?wt\b[^>]*>/giu, "").replace(/\s+/gu, " ").trim();
    const sourceTableNumber = String.raw`(?:表格|附表|表)\s*(?:\d+|[A-Za-zＡ-Ｚａ-ｚ]+)(?:\s*[.．\-－—]\s*\d+)*`;
    if (new RegExp(`^${sourceTableNumber}\\s*$`, "u").test(title)) return "";
    const cleaned = title.replace(new RegExp(`^${sourceTableNumber}(?:\\s*[：:、]\\s*|\\s+|(?=[A-Za-zＡ-Ｚａ-ｚ\\u4e00-\\u9fff]))`, "u"), "").trim();
    return cleaned || title
}

const decodeXml = (value: string) => value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function parseDocxTableXml(xml: string) {
    type ParsedCell = {
        text: string;
        colSpan: number;
        rowSpan: number;
        column: number;
        merge?: "restart" | "continue"
    };
    const parsedRows: ParsedCell[][] = [...xml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map(row => {
        let column = 0;
        return [...row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map(cell => {
            const cellXml = cell[1], colSpan = Number(cellXml.match(/<w:gridSpan\b[^>]*w:val="(\d+)"/)?.[1] || 1),
                mergeTag = cellXml.match(/<w:vMerge\b([^>]*)\/?\s*>/)?.[1],
                merge = mergeTag === undefined ? undefined : /w:val="restart"/.test(mergeTag) ? "restart" : "continue",
                value: ParsedCell = {
                    text: decodeXml([...cellXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join(""))
                        .replace(/\s+/g, " ").trim(), colSpan, rowSpan: 1, column, merge
                };
            column += colSpan;
            return value
        })
    });
    if (!parsedRows.length) return undefined;
    for (let rowIndex = 0; rowIndex < parsedRows.length; rowIndex++) {
        for (const cell of parsedRows[rowIndex]) {
            if (cell.merge !== "continue") continue;
            for (let previous = rowIndex - 1; previous >= 0; previous--) {
                const origin = parsedRows[previous].find(candidate => candidate.column === cell.column && candidate.merge !== "continue");
                if (origin) {
                    origin.rowSpan++;
                    break
                }
            }
        }
    }
    const cells = parsedRows.map(row => row.filter(cell => cell.merge !== "continue").map(cell => ({text: cell.text, ...(cell.colSpan > 1 ? {colSpan: cell.colSpan} : {}), ...(cell.rowSpan > 1 ? {rowSpan: cell.rowSpan} : {})})));
    const expandedRows = parsedRows.map(row => row.map(cell => cell.text)),
        width = Math.max(...expandedRows.map(row => row.length)),
        normalized = expandedRows.map(row => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
    return {columns: normalized[0], rows: normalized.slice(1), cells}
}

async function hydrateHardwareTables(data: Json) {
    const tables: Json[] = [];
    for (const item of data.interfaces || []) {
        tables.push(...(item.overview_tables || []), ...(item.input_tables || []), ...(item.output_tables || []));
        for (const topic of item.topics || []) tables.push(...(topic.input_tables || []), ...(topic.output_tables || []))
    }
    await Promise.all(tables.map(async item => {
        if (Array.isArray(item.columns) && Array.isArray(item.rows)) return;
        const assetPath = text(item.table_asset?.path);
        if (!assetPath) return;
        const parsed = parseDocxTableXml(await readFile(assetPath, "utf8"));
        if (parsed) Object.assign(item, parsed)
    }))
}

function hardware(data: Json, artifact: string, lookup: ReturnType<typeof maps>): Phase2Block[] {
    const root = lookup.root(artifact),
        blocks: Phase2Block[] = [heading(`3 ${text(data.chapter_title) || "数据及接口需求"}`, 1), heading(`3.1 ${text(data.section_title) || "硬件接口"}`, 2, root?.id, refs(data), root?.businessId, true)];
    (data.interfaces || []).forEach((item: Json, index: number) => {
        const number = `3.1.${index + 1}`, node = lookup.anchor(artifact, number),
            title = text(item.title || item.interface_name || item.name) || `硬件接口${index + 1}`;
        blocks.push(heading(`${number} ${title}`, 3, node?.id, refs(item), node?.businessId));
        const interfaceId = text(item.interface_id || item.id), overview = text(item.overview);
        if (interfaceId || overview) blocks.push(paragraph([interfaceId, overview].filter(Boolean).join(overview ? "：" : "")));
        let tableNumber = 1;
        const appendTables = (tables: Json[], fallback: string) => {
            for (const candidate of tables || []) {
                const value = normalizedTable(candidate, fallback);
                if (value) {
                    value.caption = `表3.1.${index + 1}-${tableNumber++}  ${cleanTableTitle(value.caption) || fallback}`;
                    blocks.push(value)
                }
            }
        };
        const flowGroup = (flows: unknown, tables: Json[], label: string) => {
            for (const value of flowList(flows)) blocks.push(paragraph(value));
            appendTables(tables, label)
        };
        appendTables(item.overview_tables, `${title}概述数据表`);
        flowGroup(item.input_flow, item.input_tables, `${title}输入数据表`);
        flowGroup(item.output_flow, item.output_tables, `${title}输出数据表`);
        (item.topics || []).forEach((sub: Json, subIndex: number) => {
            blocks.push(heading(`${number}.${subIndex + 1} ${text(sub.title || sub.name)}`, 4, undefined, refs(sub)));
            flowGroup(sub.input_flow, sub.input_tables, `${text(sub.title)}输入数据表`);
            flowGroup(sub.output_flow, sub.output_tables, `${text(sub.title)}输出数据表`)
        })
    });
    if (!(data.interfaces || []).length) blocks.push(paragraph("未识别到可展示的硬件接口内容。"));
    return blocks
}

function functional(data: Json, artifact: string, lookup: ReturnType<typeof maps>): Phase2Block[] {
    const root = lookup.root(artifact),
        blocks: Phase2Block[] = [heading(`${text(data.chapter_title_no) || "4"} ${text(data.chapter_title) || "测试类型说明"}`, 1), heading(`${text(data.section_title_no) || "4.1"} ${text(data.section_title) || "功能测试"}`, 2, root?.id, refs(data), root?.businessId)];
    const visit = (node: Json) => {
        const number = text(node.title_no), match = lookup.anchor(artifact, number),
            children = Array.isArray(node.children) ? node.children : [],
            content = node.init_content || node.other_content;
        blocks.push(heading(`${number} ${text(node.title)}`, Math.min(number.split(".").length, 5), match?.id, refs(node), match?.businessId, children.length === 0 && Boolean(content)));
        if (children.length) return children.forEach(visit);
        if (!content) return;
        if (text(content.summary)) blocks.push(paragraph(content.summary));
        blocks.push(heading(`${number}.1 输入流说明`, 5), {
            type: "list",
            items: formatFunctionalFlowItems(content.input_flow)
        }, heading(`${number}.2 处理`, 5));
        const tables = new Map<string, Json>((content.tables || []).map((item: Json) => [text(item.table_id), item]));
        for (const processing of content.processing || []) {
            const requirementId = text(processing.requirement_id),
                target = lookup.anchor(artifact, undefined, requirementId);
            blocks.push({
                type: "paragraph",
                text: `${requirementId}：${text(processing.content)}`,
                anchorId: target?.id,
                businessId: requirementId,
                sourceRefs: refs(processing)
            });
            for (const tableRef of processing.table_refs || []) {
                const item = tables.get(text(tableRef));
                if (!item) continue;
                const value = normalizedTable(item, "关联表格");
                if (value) {
                    const tableNo = text(item.table_no);
                    value.caption = [tableNo, cleanTableTitle(item.title)].filter(Boolean).join(" ");
                    blocks.push(value)
                }
            }
        }
        blocks.push(heading(`${number}.3 输出流说明`, 5), {
            type: "list",
            items: formatFunctionalFlowItems(content.output_flow)
        }, heading(`${number}.4 测试要求`, 5), paragraph("测试充分性要求：C1、C2；"), paragraph("测试终止要求：Z1、Z2；"), paragraph("优先级：所有需求项为低优先级。"))
    };
    (data.children || []).forEach(visit);
    return blocks
}

const NON_FUNCTIONAL: Record<string, { description: string; prefix: string; noun: string }> = {
    "4.2": {description: "performance_requirement_description", prefix: "TR-XN", noun: "性能"},
    "4.3": {description: "interface_requirement_description", prefix: "TR-JK", noun: "接口"},
    "4.4": {description: "reliability_safety_requirement_description", prefix: "TR-AQ", noun: "可靠性安全性"},
    "4.5": {description: "margin_requirement_description", prefix: "TR-YL", noun: "余量"},
    "4.6": {description: "boundary_requirement_description", prefix: "TR-BJ", noun: "边界"},
    "4.7": {description: "data_processing_requirement_description", prefix: "TR-SC", noun: "数据处理"},
    "4.8": {description: "recovery_requirement_description", prefix: "TR-HF", noun: "恢复性"},
    "4.9": {description: "strength_requirement_description", prefix: "TR-QD", noun: "强度"}
};

function nonFunctional(data: Json, artifact: string, number: string, title: string, lookup: ReturnType<typeof maps>): Phase2Block[] {
    const config = NON_FUNCTIONAL[number], root = lookup.root(artifact), rows = data.rows || [],
        sectionNo = text(data.section_title_no) || `${number}.1`,
        sectionTitle = text(data.section_title) || `${config.noun}需求项[${config.prefix}]`;
    const sectionNode = lookup.anchor(artifact, sectionNo);
    const renderedRows: string[][] = rows.map((row: Json, index: number) => {
        const requirementId = text(row.requirement_id || row.test_requirement_id) || `${config.prefix}-${String(index + 1).padStart(3, "0")}`;
        return [String(index + 1), text(row[config.description]), requirementId, text(row.related_description)]
    });
    const summary = table(`表${number}-1  ${config.noun}需求项总结表`, ["序号", `${config.noun}需求描述`, "对应测试需求标识", "相关说明"], renderedRows);
    summary.rowAnchorIds = renderedRows.map(row => lookup.anchor(artifact, undefined, row[2])?.id);
    return [heading(`${number} ${title}`, 2, root?.id, refs(data), root?.businessId), heading(`${sectionNo} ${sectionTitle}`, 3, sectionNode?.id, refs(data), sectionNode?.businessId, true), paragraph(`依据引用文档及上述测试需求分析，共总结如下 ${rows.length} 项${config.noun}需求：`), summary, heading(`${number}.2 测试要求`, 3), paragraph(`测试充分性要求：${text(data.test_requirements?.sufficiency)}；`), paragraph(`测试终止要求：${text(data.test_requirements?.termination)}；`), paragraph(`优先级：所有需求项为${text(data.test_requirements?.priority)}。`)]
}

function traceability(data: Json, artifact: string, lookup: ReturnType<typeof maps>): Phase2Block[] {
    const root = lookup.root(artifact), rows = data.rows || [],
        requirementCount = data.summary?.requirement_count ?? [...new Set(rows.flatMap((item: Json) => item.test_requirement_ids || []))].length;
    return [heading("6 测试需求覆盖性说明", 1, root?.id, refs(data), root?.businessId), paragraph(`经过上述的测试需求分析过程，共总结出测试点 ${requirementCount} 项。`), paragraph("本测试需求总结的测试点覆盖了需求规格说明书的内容，具体的对应关系如下表。"), table("表6-1  测试需求覆盖表", ["文档名称", "章节号", "标题名称", "测试需求标识"], rows.map((row: Json) => [row.document_name, row.section_number || row.section_no || row.source_section_no, row.section_title, row.test_requirement_ids?.length ? compressRequirementIds(row.test_requirement_ids).join("\n") : "非测试需求项"]))]
}

export async function buildPhase2Document(workspacePath: string, requirements: any[]) {
    const dataDir = path.join(workspacePath, ".matrix", "data"), lookup = maps(requirements),
        chapters: Phase2Chapter[] = [];
    for (const [artifact, number, title] of FILES) {
        try {
            const data = JSON.parse(await readFile(path.join(dataDir, artifact), "utf8"));
            let blocks: Phase2Block[];
            if (number === "1") blocks = chapter1(data, artifact, lookup);
            else if (number === "2") blocks = chapter2(data, artifact, lookup);
            else if (number === "3.1") {
                await hydrateHardwareTables(data);
                blocks = hardware(data, artifact, lookup)
            } else if (number === "4.1") blocks = functional(data, artifact, lookup);
            else if (number === "6") blocks = traceability(data, artifact, lookup);
            else blocks = nonFunctional(data, artifact, number, title, lookup);
            chapters.push({artifact, number, title, rootNodeId: lookup.root(artifact)?.id, blocks})
        } catch (error) {
            chapters.push({
                artifact,
                number,
                title,
                rootNodeId: lookup.root(artifact)?.id,
                blocks: [{
                    type: "error",
                    text: `${number} ${title}加载失败：${error instanceof Error ? error.message : String(error)}`
                }]
            })
        }
    }
    return {chapters}
}
