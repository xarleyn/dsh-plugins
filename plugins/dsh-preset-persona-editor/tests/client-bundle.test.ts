/**
 * The built browser bundle: the identity the host page resolves it by, and the
 * hygiene that keeps it a browser bundle.
 *
 * The bundle is evaluated the way the DSH client evaluates it — through
 * `window.__ModuleLoader__.load({ id, factory })` — so this test fails if the
 * banner's id drifts from the package name, if the factory stops exporting
 * `apply`, or if a node built-in ever reaches the browser half.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { createModuleLoaderStub } from "@yadsh/dsh-test-kit";
import { describe, expect, it } from "vitest";

const PACKAGE_NAME = "@yadsh/dsh-preset-persona-editor";
const BUNDLE = join(import.meta.dirname, "..", "lib", "client.js");

/** The two peers the host page provides; everything else is inlined. */
function browserRequire(name: string): unknown {
  if (name === "react" || name === "react/jsx-runtime") {
    return {
      createElement: () => null,
      Fragment: Symbol("Fragment"),
      jsx: () => null,
      jsxs: () => null,
      useEffect: () => undefined,
      useSyncExternalStore: () => undefined,
      useState: () => [undefined, () => undefined],
    };
  }
  throw new Error(`the client bundle required an unexpected module: ${name}`);
}

describe("client bundle", () => {
  it("registers itself under the full package name and exports apply", async () => {
    const source = await readFile(BUNDLE, "utf8");
    const stub = createModuleLoaderStub();
    runInContext(source, createContext({ window: stub.window, console }));

    expect(stub.registrations).toHaveLength(1);
    const registration = stub.registrations[0];
    expect(registration?.id).toBe(PACKAGE_NAME);

    const exports = registration?.factory(browserRequire) as {
      apply?: unknown;
      inject?: unknown;
    };
    expect(typeof exports.apply).toBe("function");
    expect(exports.inject).toEqual(["slots", "remote"]);
  });

  it("stays a browser bundle: no node built-ins, no host-only libraries", async () => {
    const source = await readFile(BUNDLE, "utf8");
    for (const forbidden of [
      "node:fs",
      "node:path",
      "node:crypto",
      "yaml",
      "zod",
    ]) {
      expect(source).not.toContain(`require("${forbidden}")`);
    }
    // The card shell and the disclosure chevron ship with the page (AGENTS.md
    // card contract), the page names the file it edits, and the advanced area
    // names the registrar a preset ships for its prompt sections.
    expect(source).toContain(".dsh-plugin-card{");
    expect(source).toContain("m3.5 5.25 3.5 3.5 3.5-3.5");
    expect(source).toContain("agent.cordis.yml");
    expect(source).toContain("prompt-sections.mjs");
    expect(source).toContain("Advanced: prompt sections");
  });
});
