import {describe, expect, it} from "vitest";
import {cacheHitRate, elapsedMilliseconds, formatElapsed, formatTokenCount, nonCachedTokens} from "./runMetrics";

describe("run metrics formatting", () => {
    it("formats token counts", () => {
        expect(formatTokenCount(999)).toBe("999");
        expect(formatTokenCount(128600)).toBe("128.6K");
        expect(formatTokenCount(1_250_000)).toBe("1.3M")
    });
    it("formats running and frozen elapsed time", () => {
        expect(elapsedMilliseconds("2026-01-01T00:00:00Z", undefined,
            new Date("2026-01-01T01:02:03Z").getTime())).toBe(3_723_000);
        expect(formatElapsed(3_723_000)).toBe("01:02:03");
        expect(elapsedMilliseconds("2026-01-01T00:00:00Z", "2026-01-01T00:00:05Z")).toBe(5000)
    });
    it("calculates the real Phase 2 sample without treating cache hits as new tokens", () => {
        const usage = {input: 209745, output: 8993, reasoning: 7272, cacheRead: 2988672};
        expect(nonCachedTokens(usage)).toBe(226010);
        expect(formatTokenCount(nonCachedTokens(usage))).toBe("226.0K");
        expect(cacheHitRate(usage)).toBeCloseTo(93.44, 2)
    });
    it("handles no-cache and empty usage", () => {
        expect(cacheHitRate({input: 100, cacheRead: 0})).toBe(0);
        expect(cacheHitRate({input: 0, cacheRead: 0})).toBe(0)
    })
});
