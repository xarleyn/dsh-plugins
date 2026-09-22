/**
 * Build wiring for the shipped client bundle.
 *
 * `test` needs `lib/client.js` — it runs the classic browser bundle in a VM —
 * and `verify` reads that same file. The bundling used to be an anonymous
 * `tsdown` step of `test` itself, which coupled the published artifact to a
 * test run: a `clean`-ing `build` racing a `test` could delete the bundle while
 * the suite was loading it, and nothing in the package named the step that
 * produces the artifact at all.
 *
 * The bundle now comes from one named goal, `build:client`, which both `build`
 * (the published path) and `test` (the suite that asserts on it) call. These
 * assertions keep it that way.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface Manifest {
  readonly scripts: Record<string, string>;
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(
    await readFile(
      fileURLToPath(new URL("../package.json", import.meta.url)),
      "utf8",
    ),
  ) as Manifest;
}

describe("client bundle build wiring", () => {
  it("bundles through one named goal that `build` owns", async () => {
    const { scripts } = await readManifest();
    const build = scripts["build"] ?? "";

    expect(scripts["build:client"]).toBe("tsdown");
    // `build` owns the published artifact: it cleans first, then reuses the
    // goal instead of invoking the bundler itself.
    expect(build.indexOf("build:client")).toBeGreaterThan(
      build.indexOf("clean"),
    );
    expect(build).not.toMatch(/\btsdown\b/u);
  });

  it("lets the suite consume that goal without a bundler of its own", async () => {
    const { scripts } = await readManifest();
    const test = scripts["test"] ?? "";

    expect(test).toContain("pnpm run build:client");
    expect(test).toContain("vitest run");
    expect(test).not.toMatch(/\btsdown\b/u);
  });

  it("keeps the client-bundle gate reachable from `verify`", async () => {
    const { scripts } = await readManifest();

    // The suite and the gate must keep looking at the same artifact, so the
    // bundle gate stays part of the documented `verify` chain.
    expect(scripts["verify"]).toContain("verify:package");
    expect(scripts["verify:package"]).toContain("verify-client-bundle.mjs");
  });
});
