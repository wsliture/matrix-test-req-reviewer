import {describe, expect, it} from "vitest";
import {decidePhase2Retry, Phase2ExecutionError, retryDelayMs} from "./retry-policy.js";

describe("Phase 2 retry policy", () => {
    it("never retries deterministic workflow errors", () => {
        const error = new Phase2ExecutionError("candidate schema invalid", "HARDWARE_INTERFACE_PREPARE_FAILED", false, "HI-006");
        const result = decidePhase2Retry({autoRetry: true, attempt: 1, stage: "prepare_hardware_interface_batches", error});
        expect(result).toMatchObject({shouldRetry: false, retryable: false, stopReason: "non_retryable", failedCandidateId: "HI-006"})
    });

    it("uses exponential backoff and stops after three attempts", () => {
        const error = new Phase2ExecutionError("file busy", "IO_EBUSY", true);
        expect(retryDelayMs(1)).toBe(2000);
        expect(retryDelayMs(2)).toBe(4000);
        expect(decidePhase2Retry({autoRetry: true, attempt: 3, stage: "prepare", error}).stopReason).toBe("max_attempts")
    });

    it("circuit-breaks an identical consecutive failure", () => {
        const error = new Phase2ExecutionError("same input failed", "IO_EBUSY", true);
        const first = decidePhase2Retry({autoRetry: true, attempt: 1, stage: "prepare", error});
        const second = decidePhase2Retry({autoRetry: true, attempt: 2, stage: "prepare", error, previousFingerprint: first.fingerprint});
        expect(first.shouldRetry).toBe(true);
        expect(second).toMatchObject({shouldRetry: false, stopReason: "repeated_failure"})
    });

    it("uses stage, error code, and input fingerprint for repeat detection", () => {
        const first = decidePhase2Retry({
            autoRetry: true, attempt: 1, stage: "prepare_hardware_interface_batches",
            error: new Phase2ExecutionError("first wording", "IO_EBUSY", true), inputFingerprint: "same-input",
        });
        const second = decidePhase2Retry({
            autoRetry: true, attempt: 2, stage: "prepare_hardware_interface_batches",
            error: new Phase2ExecutionError("different wording", "IO_EBUSY", true), inputFingerprint: "same-input",
            previousFingerprint: first.fingerprint,
        });
        expect(second.stopReason).toBe("repeated_failure")
    });
});
