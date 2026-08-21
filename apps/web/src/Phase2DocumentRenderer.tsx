import {createElement} from "react";
import {Alert, Button, Tag} from "antd";
import type {Phase2Block, Phase2Chapter, TraceLink} from "./api";

type Props = {
    chapters: Phase2Chapter[];
    links: TraceLink[];
    activeId?: string;
    onSource: (link: TraceLink) => void;
    onEvaluate: (targetId: string) => void;
};

function Sources({targetId, links, onSource}: {targetId?: string; links: TraceLink[]; onSource: (link: TraceLink) => void}) {
    if (!targetId) return null;
    const values = links.filter(link => link.targetNodeId === targetId);
    if (!values.length) return null;
    return <div className="phase2-sources"><span>追溯来源：</span>{values.map(link => <Tag color="blue" key={link.id} onClick={() => onSource(link)}>
        {link.sourceNode.document?.name.replace(/\.docx$/i, "")} {link.sourceNode.number || link.sourceNode.title}
    </Tag>)}</div>
}

function Block({block, links, activeId, onSource, onEvaluate}: {block: Phase2Block; links: TraceLink[]; activeId?: string; onSource: Props["onSource"]; onEvaluate: Props["onEvaluate"]}) {
    const anchorProps = block.anchorId ? {id: `requirement-${block.anchorId}`, "data-requirement-id": block.anchorId} : {};
    const active = block.anchorId === activeId ? " phase2-target-highlight" : "";
    if (block.type === "error") return <Alert type="error" showIcon message={block.text}/>;
    if (block.type === "heading") {
        const headingName = `h${Math.min(Math.max(block.level || 1, 1), 5)}`;
        return <section {...anchorProps} className={`phase2-heading-block${active}`}><div className="phase2-heading-line">{createElement(headingName, null, block.text)}
            {block.anchorId && <Button size="small" onClick={() => onEvaluate(block.anchorId!)}>评估</Button>}</div>
            <Sources targetId={block.anchorId} links={links} onSource={onSource}/></section>
    }
    if (block.type === "paragraph") return <div {...anchorProps} className={`phase2-paragraph${active}`}><p>{block.text}</p><Sources targetId={block.anchorId} links={links} onSource={onSource}/></div>;
    if (block.type === "list") return <div className="phase2-list">{block.items?.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}</div>;
    if (block.cells?.length) return <div className="phase2-table-wrap"><div className="phase2-table-caption">{block.caption}</div><table className="phase2-table"><tbody>{block.cells.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => {
        const Cell = rowIndex === 0 ? "th" : "td";
        return <Cell key={cellIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>{cell.text}</Cell>
    })}</tr>)}</tbody></table></div>;
    return <div className="phase2-table-wrap"><div className="phase2-table-caption">{block.caption}</div><table className="phase2-table"><thead><tr>{block.columns?.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.rows?.map((row, rowIndex) => {
        const rowId = block.rowAnchorIds?.[rowIndex];
        return <tr key={rowIndex} id={rowId ? `requirement-${rowId}` : undefined} data-requirement-id={rowId} className={rowId === activeId ? "phase2-target-highlight" : undefined}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>
    })}</tbody></table></div>
}

export function Phase2DocumentRenderer({chapters, links, activeId, onSource, onEvaluate}: Props) {
    return <article className="phase2-document"><header><h1>第三方测试需求</h1></header>{chapters.map(chapter => <div className="phase2-chapter" key={chapter.artifact}>
        {chapter.blocks.map((block, index) => <Block key={`${chapter.artifact}-${index}`} block={block} links={links} activeId={activeId} onSource={onSource} onEvaluate={onEvaluate}/>)}</div>)}</article>
}
