import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import { createModuleLoaderStub } from "@yadsh/dsh-test-kit";
import { describe, expect, it } from "vitest";

describe("classic browser bundle", () => {
  it("registers under the full package name and probes safely without a DOM", async () => {
    const source = await readFile(
      join(import.meta.dirname, "..", "lib", "client.js"),
      "utf8",
    );
    const loader = createModuleLoaderStub();
    const sandbox = { window: loader.window, console };
    vm.createContext(sandbox);
    new vm.Script(source, { filename: "client.js" }).runInContext(sandbox);

    expect(loader.registrations).toHaveLength(1);
    expect(loader.registrations[0]?.id).toBe("@yadsh/dsh-ui-repair");
    const fakeReact = {
      useMemo: (factory: () => unknown) => factory(),
      useState: (value: unknown) => [value, () => undefined],
      useSyncExternalStore: () => undefined,
    };
    const exports = loader.registrations[0]?.factory((name: string) =>
      name === "react/jsx-runtime"
        ? { jsx: () => undefined, jsxs: () => undefined, Fragment: Symbol("Fragment") }
        : fakeReact,
    ) as {
      apply(ctx: unknown): () => void;
    };
    expect(() => exports.apply({})()).not.toThrow();
  });
});
