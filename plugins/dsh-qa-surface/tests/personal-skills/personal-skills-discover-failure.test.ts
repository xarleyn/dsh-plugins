import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaPersonalSkills } from "../../src/personal-skills/index.js";
import { QaPersonalSkillError } from "../../src/personal-skills/errors.js";
import type { QaSkillRoots } from "../../src/personal-skills/paths.js";

/**
 * The model-facing discovery path must never throw.
 *
 * The provider's `list` runs inside the harness skill registry: a provider
 * that throws marks the whole catalog snapshot incomplete, and the harness
 * then withholds the available-skills section from every session instead of
 * just losing this account's skills. The listing leaf is the one unguarded
 * filesystem call in that path, so it is mocked here to fail the way a real
 * racy OS error would (an access denied or a share violation mid-read).
 */

vi.mock("../../src/personal-skills/paths.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/personal-skills/paths.js")>();
  return {
    ...actual,
    listSkillDirectories(roots: QaSkillRoots): readonly string[] {
      void roots;
      throw new QaPersonalSkillError(
        "storage-unavailable",
        "readdir failed with a racy OS error",
      );
    },
  };
});

const USER_A = "123e4567-e89b-42d3-a456-426614174000";

const warnings: Array<{ event: string; fields: Record<string, unknown> }> = [];

const silentLogger = {
  debug() {},
  info() {},
  warn(event: string, fields: Record<string, unknown>) {
    warnings.push({ event, fields });
  },
  error() {},
  close() {},
} as never;

function rig(): { readonly service: QaPersonalSkills; readonly rootA: string } {
  const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-discover-"));
  const config = resolveConfig({
    session: { workspaceId: "workspace-1" },
    accounts: {
      enabled: true,
      perUserWorkspace: true,
      skills: { watch: false },
    },
    lockdown: {
      sandboxMode: "workspace-write",
      permissionPreset: "qa-workspace-write",
      toolPolicy: { allow: ["read", "grep"] },
    },
    sources: { enabled: false },
  });
  const service = new QaPersonalSkills(
    { tools: { schemas: () => [] } } as never,
    {
      getConfig: () => config,
      logger: silentLogger,
      workspacePath: () => workspace,
      invalidate: () => undefined,
    },
  );
  return { service, rootA: path.join(workspace, ".qa-users", USER_A) };
}

describe("discover degrades to empty when the listing fails", () => {
  it("returns no skills and logs instead of throwing", () => {
    const { service, rootA } = rig();
    // The account directory is provisioned by the first session start; the
    // discovery path below only runs for an existing account.
    mkdirSync(path.join(rootA, ".dsh", "skills"), { recursive: true });
    expect(service.discover(rootA)).toEqual([]);
    expect(warnings.at(-1)?.event).toBe("skill.discover-failed");
    expect(String(warnings.at(-1)?.fields.message)).toContain("racy OS error");
  });
});
