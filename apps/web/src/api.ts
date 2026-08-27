export class ApiError extends Error {
    constructor(message: string, public readonly status: number, public readonly details?: Record<string, unknown>) {
        super(message);
        this.name = "ApiError"
    }
}

export type SessionStatus = "ready" | "recovering" | "expired";
const AUTHENTICATED_KEY = "matrix-requirements-authenticated";
const EXPIRED_NOTICE_KEY = "matrix-requirements-session-expired";
let refreshPromise: Promise<CurrentUser> | undefined, sessionStatus: SessionStatus = "ready";
const sessionListeners = new Set<(status: SessionStatus) => void>();

function setSessionStatus(status: SessionStatus) {
    sessionStatus = status;
    sessionListeners.forEach(listener => listener(status))
}

export function subscribeSessionStatus(listener: (status: SessionStatus) => void) {
    sessionListeners.add(listener);
    listener(sessionStatus);
    return () => {
        sessionListeners.delete(listener)
    }
}

export function markAuthenticated() {
    sessionStorage.setItem(AUTHENTICATED_KEY, "1");
    sessionStorage.removeItem(EXPIRED_NOTICE_KEY);
    setSessionStatus("ready")
}

export function clearAuthenticated() {
    const wasAuthenticated = sessionStorage.getItem(AUTHENTICATED_KEY) === "1";
    if (wasAuthenticated) sessionStorage.setItem(EXPIRED_NOTICE_KEY, "1");
    sessionStorage.removeItem(AUTHENTICATED_KEY);
    // 首次打开登录页时 /auth/me 和 /auth/refresh 返回401属于正常匿名状态，
    // 不能标记为会话过期，否则第一次登录成功后残留的expired状态会清空me缓存并闪回登录页。
    setSessionStatus(wasAuthenticated ? "expired" : "ready")
}

export function hasActiveAuthenticationMarker() {
    return sessionStorage.getItem(AUTHENTICATED_KEY) === "1"
}

export function resetAuthenticationState() {
    sessionStorage.removeItem(AUTHENTICATED_KEY);
    sessionStorage.removeItem(EXPIRED_NOTICE_KEY);
    setSessionStatus("ready")
}

export function hadAuthenticatedSession() {
    return sessionStorage.getItem(EXPIRED_NOTICE_KEY) === "1"
}

async function parseError(response: Response) {
    const details = await response.json().catch(() => null);
    return new ApiError(details?.message || response.statusText, response.status, details || undefined)
}

async function performRefresh() {
    const response = await fetch("/api/auth/refresh", {method: "POST", credentials: "include"});
    if (response.status === 401 || response.status === 403) {
        clearAuthenticated();
        throw await parseError(response)
    }
    if (!response.ok) throw await parseError(response);
    const user = await response.json() as CurrentUser;
    markAuthenticated();
    return user
}

async function refreshUnderBrowserLock() {
    const locks = (navigator as Navigator & {
        locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> }
    }).locks;
    if (!locks) return performRefresh();
    return locks.request("matrix-requirements-session-refresh", async () => {
        const current = await fetch("/api/auth/me", {credentials: "include"}).catch(() => undefined);
        if (current?.ok) {
            const user = await current.json() as CurrentUser;
            markAuthenticated();
            return user
        }
        return performRefresh()
    })
}

export function recoverSession(): Promise<CurrentUser> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
        let attempt = 0;
        while (true) {
            try {
                const user = await refreshUnderBrowserLock();
                setSessionStatus("ready");
                return user
            } catch (error) {
                if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
                setSessionStatus("recovering");
                if (!navigator.onLine) {
                    await new Promise<void>(resolve => window.addEventListener("online", () => resolve(), {once: true}))
                } else {
                    const waits = [1000, 2000, 5000, 10000, 15000];
                    await new Promise(resolve => setTimeout(resolve, waits[Math.min(attempt++, waits.length - 1)]))
                }
            }
        }
    })().finally(() => {
        refreshPromise = undefined
    });
    return refreshPromise
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}, retry = true) {
    const response = await fetch(input, {...init, credentials: "include"});
    if (response.status !== 401 || !retry) return response;
    await recoverSession();
    return fetch(input, {...init, credentials: "include"})
}

export async function api<T>(url: string, init: RequestInit = {}, authRetry = true): Promise<T> {
    const hasJsonBody = init.body !== undefined && !(init.body instanceof FormData);
    const response = await authenticatedFetch(`/api${url}`, {
        ...init,
        headers: {...(hasJsonBody ? {"Content-Type": "application/json"} : {}), ...init.headers}
    }, authRetry);
    if (!response.ok) throw await parseError(response);
    return response.json()
}

export async function downloadApi(url: string) {
    const response = await authenticatedFetch(`/api${url}`);
    if (!response.ok) throw await parseError(response);
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
