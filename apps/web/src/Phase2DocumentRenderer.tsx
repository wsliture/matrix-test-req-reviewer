import {createElement, useCallback, useEffect, useRef, useState} from "react";
import {Alert, Button, Input, Modal, Select, Tag} from "antd";
import {AuditOutlined, DeleteOutlined, EditOutlined, PlusOutlined} from "@ant-design/icons";
import type {Phase2Block, Phase2Chapter, Phase2EditBinding, Phase2RequirementOperation, Phase2TableOperation, Phase2TextPart, SourceRefOption, SourceTableOption, TraceLink} from "./api";

type Props = {
    chapters: Phase2Chapter[];
    links: TraceLink[];
    activeId?: string;
    reviewScores?: Record<string, number>;
    onSource: (link: TraceLink) => void;
    onEvaluate: (targetId: string) => void;
    editing?: boolean;
    drafts?: Record<string, unknown>;
    onDraft?: (binding: Phase2EditBinding, value: unknown) => void;
    onEditSources?: (binding: Phase2EditBinding) => void;
    onEditTables?: (binding: Phase2EditBinding) => void;
    tableOperations?: Phase2TableOperation[];
    onTableOperation?: (operation: Phase2TableOperation) => void;
    requirementOperations?: Phase2RequirementOperation[];
    onRequirementOperation?: (operation: Phase2RequirementOperation) => void;
    readOnly?: boolean;
    availableTables?: SourceTableOption[];
    availableSourceRefs?: SourceRefOption[];
};

function TraceSourceLinks({targetId, links, onSource, inline = false, editing, binding, onEditSources, drafts, availableSourceRefs}: {
    targetId?: string;
    links: TraceLink[];
    onSource: (link: TraceLink) => void;
    inline?: boolean; editing?: boolean; binding?: Phase2EditBinding; onEditSources?: (binding: Phase2EditBinding) => void;
    drafts?: Record<string, unknown>; availableSourceRefs?: SourceRefOption[]
}) {
    if (!targetId) return null;
    const values = [...new Map(links.filter(link => link.targetNodeId === targetId)
        .map(link => [link.sourceNodeId, link])).values()];
    const hasDraft = Boolean(editing && binding && Object.prototype.hasOwnProperty.call(drafts || {}, binding.edit_key));
    const draftRefs = hasDraft ? (drafts?.[binding!.edit_key] as string[] || []) : undefined;
    if (!values.length && !hasDraft) return null;
    const Wrapper = inline ? "span" : "div";
    const openEditor = () => editing && binding && onEditSources?.(binding);
    return <Wrapper className={inline ? "trace-source-links trace-source-links-inline" : "trace-source-links trace-source-links-block"}>
        <span className={`trace-source-label${editing && binding ? " phase2-editable-source" : ""}`} onClick={openEditor}>追溯来源：</span>
        {hasDraft ? draftRefs!.map(sourceRef => {
            const option = availableSourceRefs?.find(item => item.value === sourceRef);
            return <Tag color="blue" key={sourceRef} className="phase2-editable-source" onClick={openEditor}>
                {option ? `${option.document_name} ${option.number || option.title}` : sourceRef}
            </Tag>
        }) : values.map(link => <Tag color="blue" key={link.id} className={editing && binding ? "phase2-editable-source" : ""} onClick={() => editing && binding && onEditSources ? onEditSources(binding) : onSource(link)}>
            {link.sourceNode.document?.name.replace(/\.docx$/i, "")} {link.sourceNode.number || link.sourceNode.title}
        </Tag>)}
    </Wrapper>
}

const resizeQueue = new Set<() => void>();
let resizeFrame: number | undefined;
const queueResize = (callback: () => void) => {
    resizeQueue.add(callback);
    if (resizeFrame !== undefined) return;
    resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = undefined;
        const callbacks = [...resizeQueue];
        resizeQueue.clear();
        callbacks.forEach(item => item());
    });
};

let measurementCanvas: HTMLCanvasElement | undefined;
const measureTextWidth = (value: string, font: string, letterSpacing: string) => {
    measurementCanvas ??= document.createElement("canvas");
    const context = measurementCanvas.getContext("2d");
    if (!context) return 80;
    context.font = font;
    const spacing = Number.parseFloat(letterSpacing) || 0;
    return Math.max(...(value || "　").split("\n").map(line => context.measureText(line || "　").width + Math.max(line.length - 1, 0) * spacing));
};

function AutoSizeInlineEditor({value, tableCell, onChange}: {
    value: string;
    tableCell?: boolean;
    onChange: (value: string) => void;
}) {
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const resize = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const parent = editor.parentElement;
        const availableWidth = Math.max(parent?.clientWidth ?? editor.clientWidth, 1);
        const computed = window.getComputedStyle(editor);
        const horizontalChrome = parseFloat(computed.paddingLeft) + parseFloat(computed.paddingRight)
            + parseFloat(computed.borderLeftWidth) + parseFloat(computed.borderRightWidth);
        const verticalChrome = parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom)
            + parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth);
        const minimumWidth = Math.min(80, availableWidth);
        const measuredWidth = Math.ceil(measureTextWidth(value || editor.placeholder, computed.font, computed.letterSpacing) + horizontalChrome + 3);
        const assignedWidth = tableCell ? availableWidth : Math.min(Math.max(measuredWidth, minimumWidth), availableWidth);
        if (!tableCell) editor.style.width = `${assignedWidth}px`;
        const lineHeight = parseFloat(computed.lineHeight) || 24;
        const singleLineHeight = Math.ceil(lineHeight + verticalChrome);
        const wraps = value.includes("\n") || measuredWidth > assignedWidth + 1;
        editor.style.height = `${singleLineHeight}px`;
        if (wraps) editor.style.height = `${Math.max(singleLineHeight, editor.scrollHeight + parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth))}px`;
    }, [tableCell, value]);

    useEffect(() => {
        const scheduleResize = () => queueResize(resize);
        scheduleResize();
        const parent = editorRef.current?.parentElement;
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleResize);
        if (parent) observer?.observe(parent);
        window.addEventListener("resize", scheduleResize);
        document.fonts?.ready.then(scheduleResize).catch(() => undefined);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", scheduleResize);
            resizeQueue.delete(resize);
        };
    }, [resize]);

    return <textarea ref={editorRef}
                     className={`phase2-inline-editor${tableCell ? " phase2-inline-editor-table-cell" : ""}`}
                     rows={1} wrap="soft" value={value} aria-label="可编辑文档内容"
                     onChange={event => onChange(event.target.value)}/>;
}

function EditablePart({part, editing, drafts, onDraft, tableCell}: {part: Phase2TextPart; editing?: boolean; drafts?: Record<string, unknown>; onDraft?: Props["onDraft"]; tableCell?: boolean}) {
    if (!part.editable || !editing || !onDraft) return <>{part.text}</>;
    const binding = part.binding, draft = drafts?.[binding.edit_key] ?? binding.value;
    const value = Array.isArray(draft) ? draft.join("、") : String(draft ?? "");
    return <AutoSizeInlineEditor tableCell={tableCell} value={value} onChange={nextValue => onDraft(binding,
        Array.isArray(binding.value) ? nextValue.split(/[、,，]/u).map(item => item.trim()).filter(Boolean) : nextValue)}/>;
}

const renderParts = (parts: Phase2TextPart[] | undefined, fallback: string | undefined, props: Pick<Props, "editing" | "drafts" | "onDraft">) =>
    parts?.length ? parts.map((part, index) => <EditablePart key={index} part={part} {...props}/>) : fallback;

const draftKey = (kind: string) => `${kind}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`;
const numericSuffix = (value: string | undefined) => {
    const normalized = String(value || "").trim();
    if (/^\d*$/u.test(normalized)) return normalized;
    return normalized.match(/(\d+)$/u)?.[1] || ""
};
const requirementPrefix = (value: string) => `${value.replace(/-+$/u, "")}-`;

function Block({block, links, activeId, reviewScores, onSource, onEvaluate, editing, drafts, onDraft, onEditSources, onEditTables, tableOperations, onTableOperation, requirementOperations, onRequirementOperation, readOnly, availableTables, availableSourceRefs}: {
    block: Phase2Block;
    links: TraceLink[];
    activeId?: string;
    reviewScores?: Record<string, number>;
    onSource: Props["onSource"];
    onEvaluate: Props["onEvaluate"]
    editing?: boolean; drafts?: Record<string, unknown>; onDraft?: Props["onDraft"]; onEditSources?: Props["onEditSources"];
    onEditTables?: Props["onEditTables"]; tableOperations?: Phase2TableOperation[]; onTableOperation?: Props["onTableOperation"];
    requirementOperations?: Phase2RequirementOperation[]; onRequirementOperation?: Props["onRequirementOperation"];
    readOnly?: boolean;
    availableTables?: SourceTableOption[];
    availableSourceRefs?: SourceRefOption[];
}) {
    const [requirementModalOpen, setRequirementModalOpen] = useState(false);
    const [newRequirement, setNewRequirement] = useState({content: "", related: "", suffix: "", sourceRefs: [] as string[]});
    const [editingRequirementDraftKey, setEditingRequirementDraftKey] = useState<string>();
    const functionalRequirement = block.requirementBinding?.mode === "functional";
    const resetRequirementForm = () => {
        setNewRequirement({content: "", related: "", suffix: "", sourceRefs: []});
        setEditingRequirementDraftKey(undefined)
    };
    const openNewRequirement = () => {
        resetRequirementForm();
        setRequirementModalOpen(true)
    };
    const openRequirementEditor = (operation: Phase2RequirementOperation) => {
        setNewRequirement({
            content: operation.initial_value?.content || operation.initial_value?.description || "",
            related: operation.initial_value?.related_description || "",
            suffix: numericSuffix(operation.requested_suffix),
            sourceRefs: [...(operation.initial_value?.source_refs || [])],
        });
        setEditingRequirementDraftKey(operation.draft_key);
        setRequirementModalOpen(true)
    };
    const closeRequirementEditor = () => {
        setRequirementModalOpen(false);
        resetRequirementForm()
    };
    const submitRequirement = () => {
        if (!block.requirementBinding) return;
        onRequirementOperation?.({container_key: block.requirementBinding.container_key, operation: "add_requirement",
            draft_key: editingRequirementDraftKey || draftKey("requirement"),
            requested_suffix: numericSuffix(newRequirement.suffix) || undefined,
            initial_value: functionalRequirement
                ? {content: newRequirement.content.trim(), source_refs: newRequirement.sourceRefs}
                : {description: newRequirement.content.trim(), related_description: newRequirement.related.trim(), source_refs: newRequirement.sourceRefs}});
        closeRequirementEditor()
    };
    const addRow = () => {
        const columns = block.tableBinding?.new_row_columns || block.columns || [];
        onTableOperation?.({container_key: block.tableBinding!.container_key, operation: "add_row",
            draft_key: draftKey("row"), initial_value: columns.map(() => "")})
    };
    const addColumn = () => {
        onTableOperation?.({container_key: block.tableBinding!.container_key, operation: "add_column",
            draft_key: draftKey("column"), initial_value: {title: "", values: (block.rows || []).map(() => "")}})
    };
    const anchorProps = block.anchorId ? {
        id: `requirement-${block.anchorId}`,
        "data-requirement-id": block.anchorId
    } : {};
    const active = block.anchorId === activeId ? " phase2-target-highlight" : "";
    const pendingRequirementDelete = Boolean(block.requirementKey && (requirementOperations || []).some(item =>
        item.operation === "delete_requirement" && item.requirement_key === block.requirementKey));
    if (block.type === "error") return <Alert type="error" showIcon message={block.text}/>;
    if (block.type === "requirement_actions") {
        if (!editing || !block.requirementBinding?.allow_add) return null;
        const pending = (requirementOperations || []).filter(item => item.container_key === block.requirementBinding?.container_key && item.operation === "add_requirement");
        return <>
            <div className="phase2-requirement-actions"><Button size="small" icon={<PlusOutlined/>} onClick={openNewRequirement}>
                新增 TR{block.requirementBinding.interface_label ? `（${block.requirementBinding.interface_label}）` : ""}
            </Button>{pending.length > 0 && <Tag color="orange">待新增 {pending.length} 项</Tag>}</div>
            {pending.map((operation, index) => <div className="phase2-pending-requirement" key={operation.draft_key || index}>
                <div className="phase2-pending-requirement-title">
                    <Tag color="green">待新增</Tag>
                    <span>{functionalRequirement ? `${requirementPrefix(block.requirementBinding!.prefix)}${numericSuffix(operation.requested_suffix) || "自动编号"}` : "TR编号保存后分配"}</span>
                    <Button type="text" size="small" icon={<EditOutlined/>} onClick={() => openRequirementEditor(operation)}>编辑</Button>
                    <Button type="text" danger size="small" icon={<DeleteOutlined/>}
                        onClick={() => onRequirementOperation?.({...operation, initial_value: undefined})}>撤销新增</Button>
                </div>
                <div>{operation.initial_value?.content || operation.initial_value?.description}</div>
                {operation.initial_value?.related_description && <div className="phase2-pending-requirement-related">相关说明：{operation.initial_value.related_description}</div>}
                <div className="trace-source-links trace-source-links-block phase2-pending-requirement-sources">
                    <span className="trace-source-label">追溯来源：</span>
                    {(operation.initial_value?.source_refs || []).map(sourceRef => {
                        const option = availableSourceRefs?.find(item => item.value === sourceRef);
                        return <Tag color="blue" key={sourceRef}>{option ? `${option.document_name} ${option.number || option.title}` : sourceRef}</Tag>
                    })}
                </div>
            </div>)}
            <Modal title={`${editingRequirementDraftKey ? "编辑待新增" : "新增"}${block.requirementBinding.interface_label ? `${block.requirementBinding.interface_label} ` : ""}TR`}
                open={requirementModalOpen} width={680} okText="加入修改" cancelText="取消"
                okButtonProps={{disabled: !newRequirement.content.trim() || newRequirement.sourceRefs.length === 0}}
                onOk={submitRequirement} onCancel={closeRequirementEditor} destroyOnHidden>
                <div className="phase2-new-requirement-form">
                    {functionalRequirement && <Input addonBefore={requirementPrefix(block.requirementBinding.prefix)} value={newRequirement.suffix}
                        inputMode="numeric" placeholder="数字序号（可留空自动分配）"
                        onChange={event => setNewRequirement(current => ({...current, suffix: numericSuffix(event.target.value)}))}/>}
                    <Input.TextArea value={newRequirement.content} autoSize={{minRows: 3}}
                        placeholder={functionalRequirement ? "处理内容" : "测试需求描述"}
                        onChange={event => setNewRequirement(current => ({...current, content: event.target.value}))}/>
                    {!functionalRequirement && (
                        <Input.TextArea value={newRequirement.related} autoSize={{minRows: 2}} placeholder="相关说明"
                            onChange={event => setNewRequirement(current => ({...current, related: event.target.value}))}/>
                    )}
                    <Select mode="multiple" value={newRequirement.sourceRefs} style={{width: "100%"}}
                        placeholder="选择追溯来源（至少一个主需求来源）"
                        options={(availableSourceRefs || []).map(option => ({value: option.value, label: `${option.document_name} ${option.number || option.title}`}))}
                        onChange={sourceRefs => setNewRequirement(current => ({...current, sourceRefs}))}/>
                </div>
            </Modal>
        </>
    }
    if (block.type === "table_selector") {
        if (!editing || !block.selectionBinding) return null;
        const hasDraft = Object.prototype.hasOwnProperty.call(drafts || {}, block.selectionBinding.edit_key);
        const selectedIds = (drafts?.[block.selectionBinding.edit_key] ?? block.selectionBinding.value) as string[];
        const selectionRole = block.selectionRole || "引用";
        return <div className={`phase2-table-selector phase2-table-selector-${selectionRole === "概述" ? "overview" : selectionRole === "输入流" ? "input" : "output"}`}>
            <div className="phase2-table-selector-summary">
                <span className="phase2-table-selector-role">{selectionRole}表格</span>
                <span className="phase2-table-selector-description">{block.text}</span>
                <span className="phase2-table-selector-count">已选择 {selectedIds.length} 张</span>
                <Button size="small" icon={<PlusOutlined/>} onClick={() => onEditTables?.(block.selectionBinding!)}>选择{selectionRole}表格</Button>
            </div>
            {hasDraft && selectedIds.map(tableId => {
                const option = availableTables?.find(item => item.table_id === tableId);
                return option ? <div className="phase2-source-table-preview phase2-source-table-inline-preview" key={tableId}>
                    <div className="phase2-table-caption">{option.title || option.table_id}</div>
                    <div dangerouslySetInnerHTML={{__html: option.table_html}}/>
                </div> : <Alert key={tableId} type="warning" showIcon message={`未找到引用表格：${tableId}`}/>
            })}
        </div>;
    }
    if (editing && block.selectionEditKey && Object.prototype.hasOwnProperty.call(drafts || {}, block.selectionEditKey)) return null;
    if (block.type === "heading") {
        const headingName = `h${Math.min(Math.max(block.level || 1, 1), 5)}`;
        return <section {...anchorProps} className={`phase2-heading-block${active}`}>
            <div className="phase2-heading-line"><div className="phase2-heading-title">
                {createElement(headingName, null, renderParts(block.parts, block.text, {editing, drafts, onDraft}))}
            </div>
                <div className="phase2-heading-actions">{block.evaluable && block.anchorId &&
                    <Button type="primary" icon={<AuditOutlined/>} className="evaluation-trigger"
                            disabled={readOnly} onClick={() => onEvaluate(block.anchorId!)}>
                        内容质量评估{reviewScores?.[block.anchorId] !== undefined ? ` · 已评 ${reviewScores[block.anchorId].toFixed(2)}` : ""}
                    </Button>}</div></div>
            <TraceSourceLinks targetId={block.anchorId} links={links} onSource={onSource} editing={editing} binding={block.sourceBinding} onEditSources={onEditSources} drafts={drafts} availableSourceRefs={availableSourceRefs}/>
        </section>
    }
    if (block.type === "paragraph") return <div {...anchorProps} className={`phase2-paragraph${active}${pendingRequirementDelete ? " phase2-requirement-pending-delete" : ""}`}>
        <p>{renderParts(block.parts, block.text, {editing: editing && !pendingRequirementDelete, drafts, onDraft})}<TraceSourceLinks targetId={block.anchorId} links={links} onSource={onSource} inline editing={editing && !pendingRequirementDelete} binding={block.sourceBinding} onEditSources={onEditSources} drafts={drafts} availableSourceRefs={availableSourceRefs}/>
            {editing && block.requirementKey && block.requirementBinding && <Button className="phase2-requirement-delete" type="text" danger size="small" icon={<DeleteOutlined/>}
                onClick={() => onRequirementOperation?.({container_key: block.requirementBinding!.container_key, operation: "delete_requirement", requirement_key: block.requirementKey})}>{pendingRequirementDelete ? "撤销删除" : "删除 TR"}</Button>}</p></div>;
    if (block.type === "list") return <div className="phase2-list">{block.items?.map((item, index) => <p
        key={`${item}-${index}`}>{block.itemBindings?.[index] ? <EditablePart part={{text: item, editable: true, binding: block.itemBindings[index]!}} editing={editing} drafts={drafts} onDraft={onDraft}/> : item}</p>)}</div>;
    if (block.cells?.length) return <div className="phase2-table-wrap">
        <div className="phase2-table-caption">{renderParts(block.captionParts, block.caption, {editing, drafts, onDraft})}</div>
        <table className="phase2-table">
            <tbody>{block.cells.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => {
                const Cell = rowIndex === 0 ? "th" : "td";
                return <Cell key={cellIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>{cell.text}</Cell>
            })}</tr>)}</tbody>
        </table>
    </div>;
    const relevantOperations = (tableOperations || []).filter(item => item.container_key === block.tableBinding?.container_key);
    const pendingDeleteColumns = new Set(relevantOperations.filter(item => item.operation === "delete_column").map(item => item.column_key));
    const pendingDeleteRows = new Set(relevantOperations.filter(item => item.operation === "delete_row").map(item => item.row_key));
    const addedColumns = relevantOperations.filter(item => item.operation === "add_column");
    const addedRows = relevantOperations.filter(item => item.operation === "add_row");
    const addedColumnDraft = (operation: Phase2TableOperation) => {
        const value = operation.initial_value;
        if (value && typeof value === "object" && !Array.isArray(value) && "title" in value && "values" in value) {
            return {title: String(value.title || ""), values: Array.isArray(value.values) ? value.values.map(String) : []}
        }
        return {title: typeof value === "string" ? value : "", values: [] as string[]}
    };
    const displayColumns = [...(block.columns || []), ...addedColumns.map(item => addedColumnDraft(item).title)];
    const displayRows = [...(block.rows || []).map((row, rowIndex) => [...row, ...addedColumns.map(operation => addedColumnDraft(operation).values[rowIndex] || "")]),
        ...addedRows.map(item => {
            const values = Array.isArray(item.initial_value) ? item.initial_value.map(value => String(value ?? "")) : [];
            return [...values, ...Array(Math.max(0, displayColumns.length - values.length)).fill("")].slice(0, displayColumns.length)
        })];
    return <div className="phase2-table-wrap">
        <div className="phase2-table-caption">{renderParts(block.captionParts, block.caption, {editing, drafts, onDraft})}</div>
        <table className="phase2-table">
            <thead>
            <tr>{displayColumns.map((column, columnIndex) => {
                const addedColumn = addedColumns[columnIndex - (block.columns?.length || 0)];
                return <th key={addedColumn?.draft_key || `${column}-${columnIndex}`} className={pendingDeleteColumns.has(block.tableBinding?.column_keys[columnIndex]) ? "phase2-table-pending-delete" : undefined}>
                {addedColumn ? <AutoSizeInlineEditor tableCell value={column} onChange={value => {
                    const draft = addedColumnDraft(addedColumn);
                    onTableOperation?.({...addedColumn, initial_value: {...draft, title: value}})
                }}/>
                    : block.headerBindings?.[columnIndex] ? <EditablePart part={{text: column, editable: true, binding: block.headerBindings[columnIndex]!}} editing={editing} drafts={drafts} onDraft={onDraft} tableCell/> : column}
                {addedColumn && (
                    <Button className="phase2-table-structure-action" type="text" danger size="small" title="撤销新增列" icon={<DeleteOutlined/>}
                        onClick={() => onTableOperation?.({...addedColumn, initial_value: undefined})}/>
                )}
                {editing && block.tableBinding?.allow_delete_column && block.tableBinding.column_keys[columnIndex] && <Button className="phase2-table-structure-action" type="text" danger size="small" icon={<DeleteOutlined/>}
                    onClick={() => onTableOperation?.({container_key: block.tableBinding!.container_key, operation: "delete_column", column_key: block.tableBinding!.column_keys[columnIndex]})}/>}</th>
            })}
                {editing && block.tableBinding?.allow_add_column && <th className="phase2-table-add-column"><Button size="small" icon={<PlusOutlined/>}
                    onClick={addColumn}>新增列</Button></th>}</tr>
            </thead>
            <tbody>{displayRows.map((row, rowIndex) => {
                const rowId = block.rowAnchorIds?.[rowIndex];
                const pendingDelete = pendingDeleteRows.has(block.tableBinding?.row_keys[rowIndex]);
                const added = rowIndex >= (block.rows?.length || 0);
                const addedRow = added ? addedRows[rowIndex - (block.rows?.length || 0)] : undefined;
                const requirementKey = block.rowRequirementKeys?.[rowIndex];
                const requirementPendingDelete = Boolean(requirementKey && (requirementOperations || []).some(item =>
                    item.operation === "delete_requirement" && item.requirement_key === requirementKey));
                return <tr key={rowIndex} id={rowId ? `requirement-${rowId}` : undefined} data-requirement-id={rowId}
                           className={`${rowId === activeId ? "phase2-target-highlight " : ""}${pendingDelete ? "phase2-table-pending-delete " : ""}${requirementPendingDelete ? "phase2-requirement-pending-delete " : ""}${added ? "phase2-table-pending-add" : ""}`.trim() || undefined}>{row.map((cell, index) => {
                    const addedColumn = !added && addedColumns[index - (block.columns?.length || 0)];
                    const columnPendingDelete = pendingDeleteColumns.has(block.tableBinding?.column_keys[index]);
                    return <td key={index} className={columnPendingDelete ? "phase2-table-pending-delete" : undefined}>{addedRow && !columnPendingDelete ? <AutoSizeInlineEditor tableCell value={cell} onChange={value => {
                        const values = [...(Array.isArray(addedRow.initial_value) ? addedRow.initial_value.map(String) : [])];
                        while (values.length < displayColumns.length) values.push("");
                        values[index] = value;
                        onTableOperation?.({...addedRow, initial_value: values})
                    }}/> : addedColumn && !columnPendingDelete ? <AutoSizeInlineEditor tableCell value={cell} onChange={value => {
                        const draft = addedColumnDraft(addedColumn);
                        const values = [...draft.values];
                        while (values.length < (block.rows?.length || 0)) values.push("");
                        values[rowIndex] = value;
                        onTableOperation?.({...addedColumn, initial_value: {...draft, values}})
                    }}/> : block.cellBindings?.[rowIndex]?.[index] ? <EditablePart part={{text: cell, editable: true, binding: block.cellBindings[rowIndex][index]!}} editing={editing && !requirementPendingDelete && !columnPendingDelete} drafts={drafts} onDraft={onDraft} tableCell/> : cell}{index === 1 && rowId ?
                        <TraceSourceLinks targetId={rowId} links={links} onSource={onSource} inline editing={editing && !requirementPendingDelete} binding={block.rowSourceBindings?.[rowIndex]} onEditSources={onEditSources} drafts={drafts} availableSourceRefs={availableSourceRefs}/> : null}
                        {editing && !added && index === row.length - 1 && block.rowRequirementKeys?.[rowIndex] && block.requirementBinding && (
                            <Button className="phase2-table-row-delete" type="text" danger size="small" title={requirementPendingDelete ? "撤销删除" : "删除TR"} icon={<DeleteOutlined/>}
                                onClick={() => onRequirementOperation?.({container_key: block.requirementBinding!.container_key, operation: "delete_requirement", requirement_key: block.rowRequirementKeys![rowIndex]})}>{requirementPendingDelete ? "撤销" : ""}</Button>
                        )}
                        {editing && addedRow && index === row.length - 1 && <Button className="phase2-table-row-delete" type="text" danger size="small" title="撤销新增" icon={<DeleteOutlined/>}
                            onClick={() => onTableOperation?.({...addedRow, initial_value: undefined})}>撤销</Button>}
                        {editing && !added && index === row.length - 1 && !block.rowRequirementKeys?.[rowIndex] && block.tableBinding?.allow_delete_row && block.tableBinding.row_keys[rowIndex] && <Button className="phase2-table-row-delete" type="text" danger size="small" title={pendingDelete ? "撤销删除" : "删除行"} icon={<DeleteOutlined/>}
                            onClick={() => onTableOperation?.({container_key: block.tableBinding!.container_key, operation: "delete_row", row_key: block.tableBinding!.row_keys[rowIndex]})}/>}</td>
                })}</tr>
            })}</tbody>
        </table>
        {editing && block.tableBinding && <div className="phase2-table-row-actions">
            {block.tableBinding.allow_add_row && <Button size="small" icon={<PlusOutlined/>} onClick={addRow}>新增行</Button>}
            {relevantOperations.length > 0 && <Tag color="orange">结构修改待保存</Tag>}
        </div>}
    </div>
}

export function Phase2DocumentRenderer({chapters, links, activeId, reviewScores, onSource, onEvaluate, editing, drafts, onDraft, onEditSources, onEditTables, tableOperations, onTableOperation, requirementOperations, onRequirementOperation, readOnly, availableTables, availableSourceRefs}: Props) {
    return <article className="phase2-document">
        <header><h1>第三方测试需求</h1></header>
        {chapters.map(chapter => <div className="phase2-chapter" key={chapter.artifact}>
            {chapter.blocks.map((block, index) => <Block key={`${chapter.artifact}-${index}`} block={block}
                                                         links={links} activeId={activeId} reviewScores={reviewScores}
                                                         onSource={onSource} onEvaluate={onEvaluate} editing={editing} drafts={drafts} onDraft={onDraft} onEditSources={onEditSources} onEditTables={onEditTables} tableOperations={tableOperations} onTableOperation={onTableOperation}
                                                         requirementOperations={requirementOperations} onRequirementOperation={onRequirementOperation}
                                                         readOnly={readOnly} availableTables={availableTables} availableSourceRefs={availableSourceRefs}/>)}</div>)}
    </article>
}
