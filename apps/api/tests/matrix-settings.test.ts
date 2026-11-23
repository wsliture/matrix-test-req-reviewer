import {describe, expect, it, vi} from "vitest";
import {AuthGuard} from "../src/auth.js";
import {SettingsController} from "../src/settings.js";
import {MATRIX_ENDPOINT, matrixSourceIp, normalizeMatrixAddress} from "../src/matrix-settings.js";

describe("Matrix IP-based access", () => {
    it("accepts literal IPv4 and IPv6 with callback prefixes", () => {
        expect(normalizeMatrixAddress(" http://192.0.2.4:8086/jeecg-boot/ ")).toBe("http://192.0.2.4:8086/jeecg-boot");
        expect(normalizeMatrixAddress("https://[2001:0db8::1]/")).toBe("https://[2001:db8::1]");
        expect(normalizeMatrixAddress(" ")).toBe("");
    });

    it.each(["http://localhost", "http://0x7f000001", "http://user@127.0.0.1",
        "http://127.0.0.1/?secret=x", "http://127.0.0.1/#section", "file://127.0.0.1"])("rejects %s", address => {
        expect(() => normalizeMatrixAddress(address)).toThrow();
    });

    it("uses the socket address unless the exact proxy peer is trusted", () => {
        expect(matrixSourceIp("::ffff:192.0.2.3", "192.0.2.5", "192.0.2.4")).toBe("192.0.2.3");
        expect(matrixSourceIp("::ffff:c000:204", "192.0.2.5", "192.0.2.4")).toBe("192.0.2.5");
        expect(matrixSourceIp("192.0.2.4", "192.0.2.5, 192.0.2.6", "192.0.2.4")).toBe("");
    });
});

it("authorizes Matrix starts and stops using only the saved callback IP", async () => {
    const settings = new Map([["matrixStartStopIp", "192.0.2.9"]]);
    const findUnique = vi.fn(async ({where}: {where: {key: string}}) => {
        const value = settings.get(where.key);
        return value === undefined ? null : {value};
    });
    const db = {
        systemSetting: {findUnique, upsert: async ({create}: {create: {key: string; value: string}}) =>
            settings.set(create.key, create.value)},
        auditLog: {create: async () => undefined},
        $transaction: (writes: Promise<unknown>[]) => Promise.all(writes)
    };
    const controller = new SettingsController(db as any);
    const admin = {user: {id: "admin", role: "ADMIN"}};
    expect(await controller.updateMatrix(admin, {callbackBase: "http://192.0.2.5:8086/prefix/"}))
        .toEqual({callbackBase: "http://192.0.2.5:8086/prefix"});
    expect(await controller.getMatrix(admin)).toEqual({callbackBase: "http://192.0.2.5:8086/prefix"});

    const guard = new AuthGuard(db as any);
    class Integration {}
    Reflect.defineMetadata(MATRIX_ENDPOINT, true, Integration);
    const request = (route: string, ip: string, forwarded?: string) => guard.canActivate({
        getClass: () => Integration,
        switchToHttp: () => ({getRequest: () => ({
            method: "POST", url: "/api/" + route, ip, headers: {"x-real-ip": forwarded}
        })})
    } as any);
    vi.stubEnv("MATRIX_TRUSTED_PROXY_IPS", "192.0.2.2");
    try {
        await expect(request("start", "192.0.2.5")).resolves.toBe(true);
        await expect(request("stop", "192.0.2.2", "192.0.2.5")).resolves.toBe(true);
        await expect(request("start", "192.0.2.9", "192.0.2.5")).rejects.toThrow("Unauthorized");
        await expect(request("start", "192.0.2.2", "192.0.2.9")).rejects.toThrow("Unauthorized");
        await controller.updateMatrix(admin, {callbackBase: ""});
        await expect(request("stop", "192.0.2.5")).rejects.toThrow("Unauthorized");
        expect(findUnique.mock.calls.every(([{where}]) => where.key === "matrixCallbackBase")).toBe(true);
        expect(settings.get("matrixStartStopIp")).toBe("192.0.2.9");
    } finally {
        vi.unstubAllEnvs();
    }
});
