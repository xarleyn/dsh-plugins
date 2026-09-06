import { describe, expect, it, vi } from "vitest";
import { createCorrectionsCommand } from "../src/dsh/commands.js";
import type { CorrectionMinerEngine } from "../src/mining/engine.js";

describe("corrections command", () => {
  it("uses the count path for status without listing all records", async () => {
    const count = vi.fn(() => 7);
    const list = vi.fn(() => {
      throw new Error("status must not list records");
    });
    const engine = { count, list } as unknown as CorrectionMinerEngine;

    await expect(
      createCorrectionsCommand(engine).handler({
        rawInput: "status",
        agent: { session: { header: { cwd: "C:\\work\\project" } } },
      }),
    ).resolves.toEqual({
      kind: "success",
      text: "7 correction evidence record(s) are stored for this workspace.",
    });
    expect(count).toHaveBeenCalledWith("C:\\work\\project");
    expect(list).not.toHaveBeenCalled();
  });
});
