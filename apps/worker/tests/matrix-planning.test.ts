import {describe, expect, it} from "vitest";
import {classifyCallback, planningSummary} from "../src/matrix-planning.js";

describe("planning summary", () => {
    it("counts distinct source references and requires an indexed target", () => {
        expect(planningSummary({
            summary: {requirement_count: 4},
            rows: [
                {source_ref: "A", test_requirement_ids: ["unindexed"]},
                {source_ref: "A", test_requirement_ids: ["R1", "R2"]},
                {source_ref: "B", test_requirement_ids: ["unindexed"]},
                {source_ref: "C", test_requirement_ids: []}
            ]
        }, new Set(["R1", "R2"]))).toEqual({requirementCount: 4, requirementCoverage: 33.33});
    });

    it("returns zero for an empty source list", () => {
        expect(planningSummary({summary: {requirement_count: 0}, rows: []}, new Set()))
            .toEqual({requirementCount: 0, requirementCoverage: 0});
    });
});

describe("callback receipts", () => {
    it("distinguishes validated success from acknowledged failure", () => {
        expect(classifyCallback(200, {success: true, code: 200, result: {ack: true, state: "COMPLETED"}}, true))
            .toMatchObject({accepted: true, retry: false});
        expect(classifyCallback(200, {success: true, code: 200, result: {ack: true, state: "FAILED", reason: "invalid"}}, true))
            .toMatchObject({accepted: false, retry: false, reason: "invalid"});
    });

    it("stops on UNKNOWN or application errors and retries temporary HTTP errors", () => {
        expect(classifyCallback(200, {success: true, code: 200, result: {ack: false, state: "UNKNOWN"}}, true))
            .toMatchObject({accepted: false, retry: false});
        expect(classifyCallback(200, {success: false, code: 500}, true)).toMatchObject({accepted: false, retry: false});
        expect(classifyCallback(503, null, true)).toMatchObject({retry: true});
    });
});
