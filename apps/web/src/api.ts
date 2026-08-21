export class ApiError extends Error {
    constructor(message: string, public readonly status: number) {
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
    if (!response.ok) throw new ApiError((await response.json().catch(() => null))?.message || response.statusText, response.status);
    return response.json()
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

export type DocumentNode = {id: string; documentId: string; sourceRef: string; number?: string; title: string; text?: string; level: number; parentId?: string | null; orderIndex: number; paragraphIndex?: number; paraId?: string; headingPath?: string[]};
export type RequirementNode = {id: string; businessId: string; nodeType: string; number?: string; title: string; level: number; parentId?: string | null; orderIndex: number; artifact: string; content?: Record<string, unknown>; sourceRefs?: string[]};
export type TraceLink = {id: string; sourceNodeId: string; targetNodeId: string; direct?: boolean; sourceNode: DocumentNode & {document?: {id: string; name: string}}; targetNode: RequirementNode};
export type Phase2Block = {type: "heading" | "paragraph" | "list" | "table" | "error"; text?: string; level?: number; anchorId?: string; businessId?: string; sourceRefs?: string[]; items?: string[]; caption?: string; columns?: string[]; rows?: string[][]; cells?: {text: string; colSpan?: number; rowSpan?: number}[][]; rowAnchorIds?: (string | undefined)[]};
export type Phase2Chapter = {artifact: string; number: string; title: string; rootNodeId?: string; blocks: Phase2Block[]};
export type ReviewData = {documents: ({id: string; name: string; parseStatus: string; parseError?: string; nodes: DocumentNode[]})[]; requirements: RequirementNode[]; links: TraceLink[]; phase2Document: {chapters: Phase2Chapter[]}};

export type RunEvent = {id: string; type: string; payload: Record<string, unknown>; createdAt: string};
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
