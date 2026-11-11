import {expect, it} from "vitest";
import {setProjectPageTitle} from "./projectPageTitle";

it("shows the project and restores the application title on leaving", () => {
    const target = {title: "SunwiseMatriX TR"};
    const cleanup = setProjectPageTitle(target, "电池控制器", "需求评审");
    expect(target.title).toBe("电池控制器 · 需求评审");
    cleanup();
    expect(target.title).toBe("SunwiseMatriX TR");
});

it("uses a generic title without a loaded project", () => {
    const target = {title: "SunwiseMatriX TR"};
    setProjectPageTitle(target, undefined, "版本对比");
    expect(target.title).toBe("版本对比 · SunwiseMatriX TR");
});
