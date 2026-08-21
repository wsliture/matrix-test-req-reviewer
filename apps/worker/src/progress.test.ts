import {describe, expect, it} from "vitest";
import {missingCompletionStages, parseToolOutput, progressOf, REQUIRED_COMPLETION_STAGES, STAGE_WEIGHTS} from "./progress.js";

describe("Phase 2 progress", () => {
    it("never reaches 100 before final verification", () => {
        expect(progressOf(new Set(Object.keys(STAGE_WEIGHTS)))).toBe(99)
    });
    it("advances after completed stages", () => {
        expect(progressOf(new Set(["discover_documents", "prepare_document_artifacts"]))).toBeGreaterThan(0)
    });
    it("rejects invalid tool output", () => {
        expect(parseToolOutput("not-json").ok).toBe(false)
    });
    it("keeps business failures", () => {
        expect(parseToolOutput('{"ok":false,"error":"missing_inputs"}').error).toBe("missing_inputs")
    })
    it("does not accept an early idle session as complete", () => {
        expect(missingCompletionStages(new Set(["discover_documents"]))).toEqual(REQUIRED_COMPLETION_STAGES)
    });
    it("accepts only all required final stages", () => {
        expect(missingCompletionStages(new Set(REQUIRED_COMPLETION_STAGES))).toEqual([])
    })
});
