import { describe, expect, it } from "vitest";
import {
  CORRECTION_MINER_DOMAIN,
  correctionRecordSchema,
  scanCursorSchema,
} from "../src/dsh/storage.js";

describe("correction miner storage domain", () => {
  it("declares the complete planned table vocabulary", () => {
    expect(CORRECTION_MINER_DOMAIN.name).toBe("dsh_user_correction_miner");
    expect(Object.keys(CORRECTION_MINER_DOMAIN.tables)).toEqual([
      "corrections",
      "clusters",
      "candidates",
      "replays",
      "decisions",
      "rule_bindings",
      "scan_cursors",
    ]);
  });

  it("rejects malformed durable records", () => {
    expect(() => correctionRecordSchema.parse({ id: "only-an-id" })).toThrow();
    expect(() => scanCursorSchema.parse({ workspaceKey: "x", sessionWatermarks: {} })).toThrow();
  });
});
