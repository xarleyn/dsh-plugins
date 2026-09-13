import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaPolicyAdmission } from "../src/secure-session.js";
import { prepareQaUserWorkspace } from "../src/user-workspace.js";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("per-user workspace admission", () => {
  it("attests the child cwd and propagates its path guard to local subagents", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-admission-"));
    const shared = mkdtempSync(path.join(tmpdir(), "qa-admission-shared-"));
    const docs = path.join(shared, "docs");
    const code = path.join(shared, "code");
    const nextDocs = path.join(shared, "next-docs");
    mkdirSync(docs);
    mkdirSync(code);
    mkdirSync(nextDocs);
    let sharedReadOnlyRoots: readonly string[] = [docs, code];
    const userRoot = prepareQaUserWorkspace(workspace, USER_ID);
    const session = {
      id: "session-parent",
      header: { id: "session-parent", cwd: userRoot, createdAt: Date.now() },
      surface: { nodes: [] },
      eventAt: () => undefined,
    };
    let approvalBlocker:
      | ((
          execution: { readonly name: string },
          next: () => Promise<{ readonly kind: "ask" | "allow" }>,
        ) => Promise<{ readonly kind: string; readonly reason?: string }>)
      | undefined;
    const agent = {
      session,
      options: {},
      ctx: {
        on: (name: string, listener: typeof approvalBlocker) => {
          if (name === "tools/pre-execute") approvalBlocker = listener;
          return () => undefined;
        },
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
      // The mounted attachment store; the exemption semantics themselves are
      // covered in user-workspace.test.ts.
      get: (name: string) =>
        name === "attachments"
          ? { root: path.join(workspace, "attachments") }
          : undefined,
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
            toolPolicy: { allow: ["read", "write", "dsh_git_context"] },
            sharedReadOnlyRoots,
          },
          sources: { enabled: false },
        }),
      { debug() {}, info() {}, warn() {}, error() {}, close() {} } as never,
      {
        enforceSessionAccess: () => ({ id: USER_ID }),
        userWorkspace: () => userRoot,
      },
    );

    await expect(
      admission.secureSession("token", "session-parent"),
    ).resolves.toMatchObject({
      workspaceMatches: true,
      sandboxModeMatches: true,
    });
    await expect(
      approvalBlocker?.({ name: "glob" }, async () => ({
        kind: "ask" as const,
      })),
    ).resolves.toEqual({
      kind: "deny",
      reason:
        'tool "glob" requires approval, but approval interactions are unavailable in QA',
    });
    expect(
      globalGuard?.({
        name: "read",
        arguments: { file_path: "../other/secret" },
        agent,
      }),
    ).toMatch(/outside/u);
    expect(
      globalGuard?.({
        name: "read",
        arguments: { file_path: path.join(docs, "guide.md") },
        agent,
      }),
    ).toBeUndefined();
    expect(
      globalGuard?.({
        name: "write",
        arguments: { file_path: path.join(docs, "guide.md"), content: "x" },
        agent,
      }),
    ).toMatch(/outside/u);
    expect(
      globalGuard?.({
        name: "dsh_git_context",
        arguments: {},
        agent,
      }),
    ).toBeUndefined();

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
    expect(
      globalGuard?.({
        name: "read",
        arguments: { file_path: path.join(docs, "guide.md") },
        agent: { session: child },
      }),
    ).toBeUndefined();

    sharedReadOnlyRoots = [nextDocs];
    await admission.secureSession("token", "session-parent");
    expect(
      globalGuard?.({
        name: "read",
        arguments: { file_path: path.join(docs, "guide.md") },
        agent: { session: child },
      }),
    ).toMatch(/outside/u);
    expect(
      globalGuard?.({
        name: "read",
        arguments: { file_path: path.join(nextDocs, "guide.md") },
        agent: { session: child },
      }),
    ).toBeUndefined();
    admission.dispose();
  });
});
