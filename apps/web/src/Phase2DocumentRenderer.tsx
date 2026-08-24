import {createElement} from "react";
import {Alert, Button, Tag} from "antd";
import {AuditOutlined} from "@ant-design/icons";
import type {Phase2Block, Phase2Chapter, TraceLink} from "./api";

type Props = {
    chapters: Phase2Chapter[];
    links: TraceLink[];
    activeId?: string;
    reviewScores?: Record<string, number>;
    onSource: (link: TraceLink) => void;
    onEvaluate: (targetId: string) => void;
};

function TraceSourceLinks({targetId, links, onSource, inline = false}: {
    targetId?: string;
    links: TraceLink[];
    onSource: (link: TraceLink) => void;
    inline?: boolean
}) {
    if (!targetId) return null;
    const values = [...new Map(links.filter(link => link.targetNodeId === targetId)
        .map(link => [link.sourceNodeId, link])).values()];
    if (!values.length) return null;
    const Wrapper = inline ? "span" : "div";
    return <Wrapper className={inline ? "trace-source-links trace-source-links-inline" : "trace-source-links trace-source-links-block"}>
        <span className="trace-source-label">追溯来源：</span>
        {values.map(link => <Tag color="blue" key={link.id} onClick={() => onSource(link)}>
        {link.sourceNode.document?.name.replace(/\.docx$/i, "")} {link.sourceNode.number || link.sourceNode.title}
        </Tag>)}
    </Wrapper>
}

function Block({block, links, activeId, reviewScores, onSource, onEvaluate}: {
    block: Phase2Block;
    links: TraceLink[];
    activeId?: string;
    reviewScores?: Record<string, number>;
    onSource: Props["onSource"];
    onEvaluate: Props["onEvaluate"]
}) {
    const anchorProps = block.anchorId ? {
        id: `requirement-${block.anchorId}`,
        "data-requirement-id": block.anchorId
    } : {};
    const active = block.anchorId === activeId ? " phase2-target-highlight" : "";
    if (block.type === "error") return <Alert type="error" showIcon message={block.text}/>;
    if (block.type === "heading") {
        const headingName = `h${Math.min(Math.max(block.level || 1, 1), 5)}`;
        return <section {...anchorProps} className={`phase2-heading-block${active}`}>
            <div className="phase2-heading-line"><div className="phase2-heading-title">
                {createElement(headingName, null, block.text)}
            </div>
                {block.evaluable && block.anchorId &&
                    <Button type="primary" icon={<AuditOutlined/>} className="evaluation-trigger"
                            onClick={() => onEvaluate(block.anchorId!)}>
                        内容质量评估{reviewScores?.[block.anchorId] !== undefined ? ` · 已评 ${reviewScores[block.anchorId].toFixed(2)}` : ""}
                    </Button>}</div>
            <TraceSourceLinks targetId={block.anchorId} links={links} onSource={onSource}/>
        </section>
    }
    if (block.type === "paragraph") return <div {...anchorProps} className={`phase2-paragraph${active}`}>
        <p>{block.text}<TraceSourceLinks targetId={block.anchorId} links={links} onSource={onSource} inline/></p></div>;
    if (block.type === "list") return <div className="phase2-list">{block.items?.map((item, index) => <p
        key={`${item}-${index}`}>{item}</p>)}</div>;
    if (block.cells?.length) return <div className="phase2-table-wrap">
        <div className="phase2-table-caption">{block.caption}</div>
        <table className="phase2-table">
            <tbody>{block.cells.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => {
                const Cell = rowIndex === 0 ? "th" : "td";
                return <Cell key={cellIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>{cell.text}</Cell>
            })}</tr>)}</tbody>
        </table>
    </div>;
    return <div className="phase2-table-wrap">
        <div className="phase2-table-caption">{block.caption}</div>
        <table className="phase2-table">
            <thead>
            <tr>{block.columns?.map(column => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>{block.rows?.map((row, rowIndex) => {
                const rowId = block.rowAnchorIds?.[rowIndex];
                return <tr key={rowIndex} id={rowId ? `requirement-${rowId}` : undefined} data-requirement-id={rowId}
                           className={rowId === activeId ? "phase2-target-highlight" : undefined}>{row.map((cell, index) =>
                    <td key={index}>{cell}{index === 1 && rowId ?
                        <TraceSourceLinks targetId={rowId} links={links} onSource={onSource} inline/> : null}</td>)}</tr>
            })}</tbody>
        </table>
    </div>
}

export function Phase2DocumentRenderer({chapters, links, activeId, reviewScores, onSource, onEvaluate}: Props) {
    return <article className="phase2-document">
        <header><h1>第三方测试需求</h1></header>
        {chapters.map(chapter => <div className="phase2-chapter" key={chapter.artifact}>
            {chapter.blocks.map((block, index) => <Block key={`${chapter.artifact}-${index}`} block={block}
                                                         links={links} activeId={activeId} reviewScores={reviewScores}
                                                         onSource={onSource} onEvaluate={onEvaluate}/>)}</div>)}
    </article>
}
