import {afterEach, describe, expect, it, vi} from "vitest";
import {api, authenticatedFetch, downloadApi} from "./api";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json", ...headers}})
}

describe("simple API authentication", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("returns an auth error after one request without attempting refresh", async () => {
        const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
            Promise.resolve(jsonResponse(401, {message: "未登录"})));
        vi.stubGlobal("fetch", fetchMock);

        await expect(api("/auth/me")).rejects.toMatchObject({status: 401, message: "未登录"});
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
        expect(fetchMock.mock.calls.some(call => call[0] === "/api/auth/refresh")).toBe(false)
    });

    it("always includes credentials in direct requests", async () => {
        const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
            Promise.resolve(jsonResponse(200, {ok: true})));
        vi.stubGlobal("fetch", fetchMock);

        await authenticatedFetch("/api/example", {method: "POST"});

        expect(fetchMock).toHaveBeenCalledWith("/api/example", {method: "POST", credentials: "include"})
    });

    it("downloads through one credentialed request", async () => {
        const response = new Response(new Blob(["document"]), {status: 200,
            headers: {"Content-Disposition": "attachment; filename*=UTF-8''manual.docx"}});
        const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(response));
        vi.stubGlobal("fetch", fetchMock);

        const result = await downloadApi("/projects/p1/export");

        expect(result.filename).toBe("manual.docx");
        expect(await result.blob.text()).toBe("document");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/export", {credentials: "include"})
    })
});
