import { resolve, sep } from "node:path";

import { vi } from "vitest";

import type { ScopeSession } from "../src/host-api.js";

export const workspace = resolve(sep, "workspace");
export const projectA = `${workspace}${sep}project-a`;
export const projectB = `${workspace}${sep}project-b`;

export function session(
  mode: "full" | "focused" | "isolated" = "focused",
): ScopeSession {
  return {
    header: { cwd: workspace },
    snapshotEvents: () => [
      {
        type: "session-scope/set",
        data: {
          version: 1,
          mode,
          roots: mode === "full" ? [] : [projectA],
          workspaceRoot: workspace,
        },
      },
    ],
    append: vi.fn(),
  };
}
