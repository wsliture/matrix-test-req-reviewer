import type {MouseEvent, ReactNode} from "react";
import {Button, type ButtonProps} from "antd";
import {Link, useNavigate} from "react-router-dom";

export function isPlainNavigation(event: {button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean}) {
    return !event.defaultPrevented && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

export function navigationClick(event: MouseEvent<HTMLAnchorElement>, beforeLeave?: () => boolean, onFollow?: () => void) {
    event.stopPropagation();
    if (!isPlainNavigation(event)) return;
    if (beforeLeave && !beforeLeave()) { event.preventDefault(); return }
    onFollow?.();
}

export function pageHref(path: string, values: Record<string, string | undefined>, search = "") {
    const params = new URLSearchParams(search);
    for (const [key, value] of Object.entries(values)) {
        if (value) params.set(key, value); else params.delete(key);
    }
    const query = params.toString();
    return path + (query ? `?${query}` : "");
}

export function reviewHref(projectId: string, values: Record<string, string | undefined>, search = "") {
    return pageHref(`/projects/${encodeURIComponent(projectId)}/review`, values, search);
}

export function resolveReviewLocation(params: URLSearchParams, requirements: {id: string; nodeType: string; number?: string | null}[], documents: {id: string; nodes: {id: string}[]}[]) {
    const requirementId = params.get("requirementId"), chapter = params.get("chapter"),
        documentId = params.get("documentId"), sourceNodeId = params.get("sourceNodeId");
    const requirement = requirementId ? requirements.find(node => node.id === requirementId)
        : chapter ? requirements.find(node => node.nodeType === "section" && node.number === chapter) : undefined;
    const document = documentId ? documents.find(item => item.id === documentId)
        : sourceNodeId ? documents.find(item => item.nodes.some(node => node.id === sourceNodeId)) : documents[0];
    const source = document?.nodes.find(node => node.id === sourceNodeId);
    return {requirementId: requirement?.id, documentId: document?.id, sourceNodeId: source?.id,
        invalidRequirement: Boolean((requirementId || chapter) && !requirement),
        invalidSource: Boolean((documentId && !document) || (sourceNodeId && !source))};
}

export function BrowseLink({to, children, className, onFollow, beforeLeave, disabled, title}: {
    to: string; children: ReactNode; className?: string; onFollow?: () => void;
    beforeLeave?: () => boolean; disabled?: boolean; title?: string;
}) {
    if (disabled) return <span className={className} aria-disabled="true" title={title}>{children}</span>;
    return <Link to={to} className={`browse-link ${className || ""}`} title={title}
        onClick={event => navigationClick(event, beforeLeave, onFollow)}>{children}</Link>;
}

/** Ant Design owns button appearance; only ordinary left clicks use SPA navigation. */
export function BrowseButton({to, beforeLeave, onFollow, ...props}: Omit<ButtonProps, "href" | "onClick" | "target"> & {
    to: string; beforeLeave?: () => boolean; onFollow?: () => void;
}) {
    const navigate = useNavigate();
    return <Button {...props} href={props.disabled ? undefined : to} onClick={event => {
        const click = event as MouseEvent<HTMLAnchorElement>;
        navigationClick(click, beforeLeave, onFollow);
        if (!isPlainNavigation(click) || props.disabled) return;
        click.preventDefault();
        navigate(to);
    }}/>;
}
