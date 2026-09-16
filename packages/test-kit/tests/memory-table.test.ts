import { describe, expect, it } from "vitest";
import { memoryTable } from "../src/index";

describe("memoryTable", () => {
  it("reads an empty table", () => {
    const table = memoryTable<string>();

    expect(table.get("missing")).toBeUndefined();
    expect(table.size).toBe(0);
    expect([...table.keys()]).toEqual([]);
    expect([...table.entries()]).toEqual([]);
  });

  it("serves a seed and reflects writes in reads and iteration", async () => {
    const table = memoryTable<number>([
      ["a", 1],
      ["b", 2],
    ]);

    expect(table.get("a")).toBe(1);
    expect(table.size).toBe(2);
    expect([...table.keys()]).toEqual(["a", "b"]);
    expect([...table.entries()]).toEqual([
      ["a", 1],
      ["b", 2],
    ]);

    await table.put("c", 3);
    expect(table.get("c")).toBe(3);
    expect(table.size).toBe(3);
  });

  it("deletes keys and reports whether something was removed", async () => {
    const table = memoryTable<string>([["a", "x"]]);

    await expect(table.delete("a")).resolves.toBe(true);
    await expect(table.delete("a")).resolves.toBe(false);
    expect(table.get("a")).toBeUndefined();
    expect(table.size).toBe(0);
  });

  it("applies update to the current value", async () => {
    const table = memoryTable<number>([["count", 1]]);

    await expect(table.update("count", (n) => n + 1)).resolves.toBe(2);
    expect(table.get("count")).toBe(2);
  });

  it("rejects update on a missing key", async () => {
    const table = memoryTable<number>();

    await expect(table.update("missing", (n) => n + 1)).rejects.toThrow(
      "missing-key",
    );
    expect(table.size).toBe(0);
  });
});
