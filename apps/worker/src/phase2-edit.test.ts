import {describe, expect, it} from "vitest";
import {requestedArtifacts} from "./phase2-edit.js";

const key = (artifact: string, field = "content") => Buffer.from(JSON.stringify({artifact, field}), "utf8").toString("base64url");

describe("Phase 2 edit publication planning", () => {
    it("extracts and deduplicates only artifacts touched by a batch", () => {
        expect(requestedArtifacts({
            changes: [{edit_key: key("functional-test-content.json")}, {edit_key: key("functional-test-content.json", "source_refs")}],
            table_operations: [{container_key: key("hardware-interface-model.json")}],
            requirement_operations: [],
        })).toEqual(["functional-test-content.json", "hardware-interface-model.json"])
    });

    it("ignores malformed keys and lets the deterministic runner reject them", () => {
        expect(requestedArtifacts({changes: [{edit_key: "not-a-key"}]})).toEqual([])
    })
});
