import {beforeEach, describe, expect, it, vi} from "vitest";

type Deferred<T> = {promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void};

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject
    });
    return {promise, resolve, reject}
}

function jsonResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}})
}

describe("authentication recovery", () => {
    let storage: Map<string, string>;

    beforeEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        storage = new Map();
        vi.stubGlobal("sessionStorage", {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key)
        });
        vi.stubGlobal("navigator", {onLine: true})
    });

    it("ignores an old refresh 401 after a new login succeeds", async () => {
        const refresh = deferred<Response>();
        vi.stubGlobal("fetch", vi.fn(() => refresh.promise));
        const auth = await import("./api");
        auth.markAuthenticated();
        const statuses: string[] = [], unsubscribe = auth.subscribeSessionStatus(status => statuses.push(status));
        const oldRecovery = auth.recoverSession().catch(error => error);

        const loginGeneration = auth.beginAuthenticationAttempt();
        expect(auth.markAuthenticated(loginGeneration)).toBe(true);
        refresh.resolve(jsonResponse(401, {message: "expired"}));

        await expect(oldRecovery).resolves.toMatchObject({name: "AbortError"});
        expect(auth.hasActiveAuthenticationMarker()).toBe(true);
        expect(statuses.at(-1)).toBe("ready");
        unsubscribe()
    });

    it("ignores an old successful refresh after a new login succeeds", async () => {
        const refresh = deferred<Response>();
        vi.stubGlobal("fetch", vi.fn(() => refresh.promise));
        const auth = await import("./api");
        const oldRecovery = auth.recoverSession().catch(error => error);

        const loginGeneration = auth.beginAuthenticationAttempt();
        auth.markAuthenticated(loginGeneration);
        refresh.resolve(jsonResponse(200, {id: "old-user", username: "old", role: "REVIEWER"}));

        await expect(oldRecovery).resolves.toMatchObject({name: "AbortError"});
        expect(auth.isAuthenticationAttemptCurrent(loginGeneration)).toBe(true);
        expect(auth.hasActiveAuthenticationMarker()).toBe(true)
    });

    it("aborts the active recovery when a login attempt starts", async () => {
        let recoverySignal: AbortSignal | undefined;
        vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            recoverySignal = init?.signal || undefined;
            return new Promise<Response>((_resolve, reject) => recoverySignal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")), {once: true}))
        }));
        const auth = await import("./api");
        const statuses: string[] = [], unsubscribe = auth.subscribeSessionStatus(status => statuses.push(status));
        const recovery = auth.recoverSession().catch(error => error);

        auth.beginAuthenticationAttempt();

        await expect(recovery).resolves.toMatchObject({name: "AbortError"});
        expect(recoverySignal?.aborted).toBe(true);
        expect(statuses).not.toContain("expired");
        unsubscribe()
    });

    it("expires the current authenticated session on a current refresh 401", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(401, {message: "expired"}))));
        const auth = await import("./api");
        auth.markAuthenticated();
        const statuses: string[] = [], unsubscribe = auth.subscribeSessionStatus(status => statuses.push(status));

        await expect(auth.recoverSession()).rejects.toMatchObject({status: 401});
        expect(auth.hasActiveAuthenticationMarker()).toBe(false);
        expect(auth.hadAuthenticatedSession()).toBe(true);
        expect(statuses.at(-1)).toBe("expired");
        unsubscribe()
    });

    it("does not let an old promise clear a newer shared recovery", async () => {
        const oldResponse = deferred<Response>(), newResponse = deferred<Response>();
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => oldResponse.promise)
            .mockImplementationOnce(() => newResponse.promise);
        vi.stubGlobal("fetch", fetchMock);
        const auth = await import("./api");
        const oldRecovery = auth.recoverSession().catch(error => error);
        auth.beginAuthenticationAttempt();
        const newRecovery = auth.recoverSession();

        oldResponse.resolve(jsonResponse(401, {message: "old expired"}));
        await oldRecovery;
        expect(auth.recoverSession()).toBe(newRecovery);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        newResponse.resolve(jsonResponse(200, {id: "new-user", username: "new", role: "ADMIN"}));
        await expect(newRecovery).resolves.toMatchObject({id: "new-user"})
    })
});
