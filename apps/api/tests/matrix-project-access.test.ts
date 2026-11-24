import {SignJWT} from "jose";
import {describe, expect, it, vi} from "vitest";
import {AuthGuard, AuthService} from "../src/auth.js";
import {MATRIX_ENDPOINT} from "../src/matrix-settings.js";
import {MATRIX_ANONYMOUS_USER, MATRIX_PROJECT_ACCESS, type MatrixResource} from "../src/matrix-project-access.js";

function fixture() {
    const findFirst = vi.fn(async ({where}: {where: {id: string; source?: string; project?: {source: string}}}) =>
        where.id === "matrix" && (where.source || where.project?.source) === "MATRIX" ? {id: where.id} : null);
    const model = {findFirst};
    const db = {project: model, document: model, phase2Run: model, phase2EditRun: model};
    const guard = new AuthGuard(db as any);

    function verify(id: string, resource?: MatrixResource, options: {public?: boolean; token?: string} = {}) {
        const controller = function Controller() {};
        const handler = function Handler() {};
        if (options.public) Reflect.defineMetadata(MATRIX_ENDPOINT, true, controller);
        if (resource) Reflect.defineMetadata(MATRIX_PROJECT_ACCESS, {param: "id", resource}, handler);
        const request = {
            method: "POST", url: "/api/fixture", params: {id}, cookies: {access_token: options.token},
            headers: {"x-real-ip": "192.0.2.5"}, ip: "192.0.2.99", user: undefined
        };
        return guard.canActivate({getClass: () => controller, getHandler: () => handler,
            switchToHttp: () => ({getRequest: () => request})} as any).then(() => request.user);
    }

    return {findFirst, verify};
}

describe("Matrix anonymous project access", () => {
    it.each(["project", "run", "editRun", "document"] as const)("checks the owning project of a %s", async resource => {
        const {verify} = fixture();
        await expect(verify("matrix", resource)).resolves.toEqual(MATRIX_ANONYMOUS_USER);
        await expect(verify("manual", resource)).rejects.toThrow("Unauthorized");
    });

    it("leaves unmarked routes authenticated and the Matrix start/stop controller public", async () => {
        const {findFirst, verify} = fixture();
        await expect(verify("matrix")).rejects.toThrow("Unauthorized");
        await expect(verify("", undefined, {public: true})).resolves.toBeUndefined();
        expect(findFirst).not.toHaveBeenCalled();
    });

    it("prefers a signed user and rejects a signed session for the system account", async () => {
        const key = new TextEncoder().encode(process.env.JWT_SECRET || "development-secret-change-me-now");
        const sign = (id: string) => new SignJWT({role: "REVIEWER"}).setSubject(id).setProtectedHeader({alg: "HS256"}).sign(key);
        const {verify} = fixture();
        await expect(verify("matrix", "project", {token: await sign("human")}))
            .resolves.toEqual({id: "human", role: "REVIEWER"});
        await expect(verify("manual", "project", {token: await sign(MATRIX_ANONYMOUS_USER.id)}))
            .rejects.toThrow("登录已过期");
    });

    it("never verifies a password for the anonymous audit account", async () => {
        const auth = new AuthService({user: {findUnique: async () => MATRIX_ANONYMOUS_USER}} as any);
        await expect(auth.login(MATRIX_ANONYMOUS_USER.username, "anything")).rejects.toThrow("用户名或密码错误");
        await expect(auth.changePassword(MATRIX_ANONYMOUS_USER.id, "anything", "new-password")).rejects.toThrow("Unauthorized");
    });
});
