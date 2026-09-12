import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaPolicyAdmission } from "../src/secure-session.js";
import { prepareQaUserWorkspace } from "../src/user-workspace.js";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("per-user workspace admission", () => {
  it("attests the child cwd and propagates its path guard to local subagents", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-admission-"));
    const userRoot = prepareQaUserWorkspace(workspace, USER_ID);
    const session = {
      id: "session-parent",
      header: { id: "session-parent", cwd: userRoot, createdAt: Date.now() },
      surface: { nodes: [] },
      eventAt: () => undefined,
    };
    const agent = {
      session,
      options: {},
      ctx: {
        tools: {
          guard: () => () => undefined,
          restrict: () => () => undefined,
        },
        systemPrompt: { section: () => () => undefined },
      },
    };
    let globalGuard: ((execution: unknown) => string | undefined) | undefined;
    let childCreated: ((session: never) => void) | undefined;
    const context = {
      on: (name: string, listener: (event: never) => void) => {
        if (name === "session/created") childCreated = listener;
        return () => undefined;
      },
      agents: { get: () => agent },
      agentPresets: { composedPreset: () => undefined },
      workspaceRegistry: { get: () => ({ path: workspace }) },
      permissionPresets: {
        resolve: () => ({ sandbox: "workspace-write", approval: "never" }),
        current: () => "qa-workspace-write",
        set: () => undefined,
      },
      tools: {
        guard: (guard: (execution: unknown) => string | undefined) => {
          globalGuard = guard;
          return () => undefined;
        },
        get: () => ({}),
      },
    };
    const admission = new QaPolicyAdmission(
      context as never,
      () =>
        resolveConfig({
          session: { workspaceId: "workspace-1" },
          accounts: { enabled: true, perUserWorkspace: true },
          lockdown: {
            sandboxMode: "workspace-write",
            permissionPreset: "qa-workspace-write",
            toolPolicy: { allow: ["read", "write"] },
          },
          sources: { enabled: false },
        }),
      { debug() {}, info() {}, warn() {}, error() {}, close() {} } as never,
      {
        enforceSessionAccess: () => ({ id: USER_ID }),
        userWorkspace: () => userRoot,
      },
    );

    expect(admission.secureSession("token", "session-parent")).toMatchObject({
      workspaceMatches: true,
      sandboxModeMatches: true,
    });
    expect(
      globalGuard?.({
        name: "read",
        arguments: { file_path: "../other/secret" },
        agent,
      }),
    ).toMatch(/outside/u);

    const child = {
      id: "session-child",
      header: {
        id: "session-child",
        cwd: userRoot,
        parentSession: "session-parent",
      },
    };
    childCreated?.(child as never);
    expect(
      globalGuard?.({
        name: "write",
        arguments: { file_path: "../other/result" },
        agent: { session: child },
      }),
    ).toMatch(/outside/u);
    admission.dispose();
  });
});
