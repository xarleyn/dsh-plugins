import {
  existsSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTestTempRoot } from "../vitest/temp-root.js";

describe("owned test temporary directories", () => {
  it("removes its tree and preserves a sibling reached through a directory link", () => {
    const owned = createTestTempRoot();
    const sibling = createTestTempRoot();
    const retained = path.join(sibling.directory, "retained.txt");
    writeFileSync(retained, "keep");
    writeFileSync(path.join(owned.directory, "fixture.txt"), "temporary");
    symlinkSync(
      sibling.directory,
      path.join(owned.directory, "outside"),
      process.platform === "win32" ? "junction" : "dir",
    );
    owned.remove();
    expect(existsSync(owned.directory)).toBe(false);
    expect(readFileSync(retained, "utf8")).toBe("keep");
    sibling.remove();
    // Repeated cleanup has no broader target to fall back to.
    owned.remove();
  });

  it.each([false, true])(
    "cleans a real Vitest command after failure=%s",
    (fail) => {
      const fixture = mkdtempSync(path.join(tmpdir(), "temp-lifecycle-"));
      const receipt = path.join(fixture, "observed.json");
      const config = path.join(fixture, "vitest.config.mjs");
      const globalSetup = fileURLToPath(
        new URL("../vitest/temp-global.ts", import.meta.url),
      );
      const setup = fileURLToPath(
        new URL("../vitest/temp-worker.ts", import.meta.url),
      );
      writeFileSync(
        config,
        `export default ${JSON.stringify({ test: { globals: true, globalSetup: [globalSetup], setupFiles: [setup], include: ["case.test.ts"], maxWorkers: 1 } })};`,
      );
      writeFileSync(
        path.join(fixture, "case.test.ts"),
        `
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
it("temporary fixture", () => {
  const root = tmpdir();
  const nested = mkdtempSync(path.join(root, "fixture-"));
  writeFileSync(path.join(nested, "payload.txt"), "temporary");
  writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ root, nested }));
  expect(${String(fail)}).toBe(false);
});
`,
      );
      const vitest = path.join(
        path.dirname(fileURLToPath(import.meta.resolve("vitest/package.json"))),
        "vitest.mjs",
      );
      const result = spawnSync(
        process.execPath,
        [vitest, "run", "--config", config],
        {
          cwd: fixture,
          encoding: "utf8",
          timeout: 20_000,
          windowsHide: true,
          env: { ...process.env, NO_COLOR: "1" },
        },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(fail ? 1 : 0);
      const observed = JSON.parse(readFileSync(receipt, "utf8")) as {
        root: string;
        nested: string;
      };
      expect(observed.root).not.toBe(tmpdir());
      expect(path.dirname(observed.root)).toBe(tmpdir());
      expect(existsSync(observed.root)).toBe(false);
      expect(existsSync(fixture)).toBe(true);
    },
    30_000,
  );
});
