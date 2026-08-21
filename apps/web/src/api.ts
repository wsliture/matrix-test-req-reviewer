export class ApiError extends Error {
    constructor(message: string, public readonly status: number, public readonly details?: Record<string, unknown>) {
        super(message);
        this.name = "ApiError"
    }
}

export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
    const hasJsonBody = init.body !== undefined && !(init.body instanceof FormData);
    const response = await fetch(`/api${url}`, {
        ...init,
        credentials: "include",
        headers: {...(hasJsonBody ? {"Content-Type": "application/json"} : {}), ...init.headers}
    });
    if (!response.ok) {
        const details = await response.json().catch(() => null);
        throw new ApiError(details?.message || response.statusText, response.status, details || undefined)
    }
    return response.json()
}

export async function downloadApi(url: string) {
    const response = await fetch(`/api${url}`, {credentials: "include"});
    if (!response.ok) {
        const details = await response.json().catch(() => null);
        throw new ApiError(details?.message || response.statusText, response.status, details || undefined)
    }
    const disposition = response.headers.get("Content-Disposition") || "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = disposition.match(/filename="([^"]+)"/i)?.[1];
    return {blob: await response.blob(), filename: encoded ? decodeURIComponent(encoded) : plain || "download.docx"}
}

export function saveDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0)
}

export type Project = {
    id: string;
    name: string;
    createdAt: string;
    status: string;
    missingArtifacts?: string[];
    runs: Phase2Run[];
    documents: { id: string; name: string; parseStatus?: string; parseError?: string }[]
};
export type CurrentUser = { id: string; username: string; role: "ADMIN" | "REVIEWER" | "VIEWER" };

export type DocumentNode = {
    id: string;
    documentId: string;
    sourceRef: string;
    number?: string;
    title: string;
    text?: string;
    level: number;
    parentId?: string | null;
    orderIndex: number;
    paragraphIndex?: number;
    paraId?: string;
    headingPath?: string[]
};
export type RequirementNode = {
    id: string;
    businessId: string;
    nodeType: string;
    number?: string;
    title: string;
    level: number;
    parentId?: string | null;
    orderIndex: number;
    artifact: string;
    content?: Record<string, unknown>;
    sourceRefs?: string[]
};
export type TraceLink = {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    direct?: boolean;
    sourceNode: DocumentNode & { document?: { id: string; name: string } };
    targetNode: RequirementNode
};
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
    rowAnchorIds?: (string | undefined)[]
};
export type Phase2Chapter = {
    artifact: string;
    number: string;
    title: string;
    rootNodeId?: string;
    blocks: Phase2Block[]
};
export type ReviewData = {
    documents: ({ id: string; name: string; parseStatus: string; parseError?: string; nodes: DocumentNode[] })[];
    requirements: RequirementNode[];
    links: TraceLink[];
    phase2Document: { chapters: Phase2Chapter[] }
};
export type ReviewScores = { correctness: number; coverage: number; testability: number };
export type ReviewRecord = {
    id: string;
    nodeId: string;
    version: number;
    scores: ReviewScores & { completeness?: number };
    weightedScore: number;
    grade: string;
    comment?: string;
    createdAt: string
};
export type MissingReview = { id: string; number: string; title: string };

export type RunEvent = { id: string; type: string; payload: Record<string, unknown>; createdAt: string };
export type Phase2Run = {
    id: string;
    status: string;
    progress: number;
    currentStage?: string;
    completedStages?: string[];
    errorMessage?: string;
    startedAt?: string;
    finishedAt?: string;
    events?: RunEvent[]
};
