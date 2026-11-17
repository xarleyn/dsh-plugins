import type { TestProject } from "vitest/node";
import { createTestTempRoot, TEST_TEMP_CONTEXT } from "./temp-root.js";

export default function setup(project: TestProject): void {
  const owned = createTestTempRoot();
  project.provide(TEST_TEMP_CONTEXT, owned.directory);
  // Global teardown precedes pool.close() in Vitest. Wait for the parent CLI's
  // exit so worker-held SQLite files are closed on Windows, including red runs.
  // A force-killed process can leave its marked directory for later inspection.
  process.once("exit", () => {
    try {
      owned.remove();
    } catch (error) {
      process.stderr.write(
        `Test temporary directory cleanup failed: ${owned.directory}: ${String(error)}\n`,
      );
      process.exitCode = 1;
    }
  });
}
