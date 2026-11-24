import {describe, expect, it, vi} from "vitest";
import {SettingsController} from "../src/settings.js";
import {normalizeMatrixAddress} from "../src/matrix-settings.js";

describe("Matrix callback address", () => {
    it("accepts literal IPv4 and IPv6 with callback prefixes", () => {
        expect(normalizeMatrixAddress(" http://192.0.2.4:8086/jeecg-boot/ ")).toBe("http://192.0.2.4:8086/jeecg-boot");
        expect(normalizeMatrixAddress("https://[2001:0db8::1]/")).toBe("https://[2001:db8::1]");
        expect(normalizeMatrixAddress(" ")).toBe("");
    });

    it.each(["http://localhost", "http://0x7f000001", "http://user@127.0.0.1",
        "http://127.0.0.1/?secret=x", "http://127.0.0.1/#section", "file://127.0.0.1"])("rejects %s", address => {
        expect(() => normalizeMatrixAddress(address)).toThrow();
    });


});

it("stores the normalized callback address", async () => {
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

    await controller.updateMatrix(admin, {callbackBase: ""});
    expect(await controller.getMatrix(admin)).toEqual({callbackBase: ""});
    expect(findUnique.mock.calls.every(([{where}]) => where.key === "matrixCallbackBase")).toBe(true);
    expect(settings.get("matrixStartStopIp")).toBe("192.0.2.9");
});
