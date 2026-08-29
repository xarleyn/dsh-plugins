/**
 * DSH Test Kit — common testing utilities for DSH plugins.
 */

// Re-export from plugin-kit package
export { createLogger } from "@yadsh/dsh-plugin-kit";

export interface MockContext {
  pluginName: string;
  config: Record<string, unknown>;
  loaded: boolean;
}

/**
 * Create a mock DSH plugin context for testing.
 */
export function createMockContext(
  overrides: Partial<MockContext> = {},
): MockContext {
  return {
    pluginName: "test-plugin",
    config: {},
    loaded: false,
    ...overrides,
  };
}

/**
 * Create a temporary directory fixture for testing package installation.
 */
export async function createTempFixture(
  baseDir: string,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");

  const fixtureRoot = path.resolve(baseDir || os.tmpdir());
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(fixtureRoot, "dsh-test-"));

  return {
    dir: tmpDir,
    cleanup: async () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}
