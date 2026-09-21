import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  QaAttestationError,
  qaAttestationFailureMessage,
} from "../src/attestation.js";
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
    // Both context-global guards are captured: the admission registers the
    // workspace fence and the conversation ceiling, and a denial is whichever
    // of them answers first.
    const globalGuards: ((execution: unknown) => string | undefined)[] = [];
    const globalGuard = (execution: unknown): string | undefined => {
      for (const guard of globalGuards) {
        const reason = guard(execution);
        if (reason !== undefined) return reason;
      }
      return undefined;
    };
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
          globalGuards.push(guard);
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
        ownerIdOf: () => USER_ID,
      },
    );

    await expect(
      admission.secureSession("token", "session-parent"),
    ).resolves.toMatchObject({
      workspaceMatches: true,
      sandboxModeMatches: true,
    });
    expect(
      globalGuard({
        name: "read",
        arguments: { file_path: "../other/secret" },
        agent,
      }),
    ).toMatch(/outside/u);
    expect(
      globalGuard({
        name: "read",
        arguments: { file_path: path.join(docs, "guide.md") },
        agent,
      }),
    ).toBeUndefined();
    expect(
      globalGuard({
        name: "write",
        arguments: { file_path: path.join(docs, "guide.md"), content: "x" },
        agent,
      }),
    ).toMatch(/outside/u);
    expect(
      globalGuard({
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
      globalGuard({
        name: "write",
        arguments: { file_path: "../other/result" },
        agent: { session: child },
      }),
    ).toMatch(/outside/u);
    expect(
      globalGuard({
        name: "read",
        arguments: { file_path: path.join(docs, "guide.md") },
        agent: { session: child },
      }),
    ).toBeUndefined();

    sharedReadOnlyRoots = [nextDocs];
    await admission.secureSession("token", "session-parent");
    expect(
      globalGuard({
        name: "read",
        arguments: { file_path: path.join(docs, "guide.md") },
        agent: { session: child },
      }),
    ).toMatch(/outside/u);
    expect(
      globalGuard({
        name: "read",
        arguments: { file_path: path.join(nextDocs, "guide.md") },
        agent: { session: child },
      }),
    ).toBeUndefined();
    admission.dispose();
  });

  it("rejects a mismatched writable permission preset before resolving an agent", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-preflight-"));
    let agentLookups = 0;
    const rejectedAgent = {
      session: {
        id: "session-new",
        header: {
          id: "session-new",
          cwd: workspace,
          createdAt: Date.now(),
        },
        surface: { nodes: [] },
        eventAt: () => undefined,
      },
      options: {},
      ctx: {},
    };
    const context = {
      on: () => () => undefined,
      agents: {
        get: () => {
          agentLookups += 1;
          return rejectedAgent;
        },
      },
      workspaceRegistry: { get: () => ({ path: workspace }) },
      permissionPresets: {
        resolve: () => ({ sandbox: "workspace-write", approval: "ask" }),
      },
      tools: { guard: () => () => undefined },
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
          },
        }),
      { debug() {}, info() {}, warn() {}, error() {}, close() {} } as never,
    );

    expect(() => admission.preflightDeployment()).toThrowError(
      expect.objectContaining({
        reason: "permission-preset",
        message:
          "permission preset qa-workspace-write does not resolve to workspace-write/never",
      }),
    );
    expect(agentLookups).toBe(0);
    await expect(
      admission.secureSession("token", "session-new"),
    ).rejects.toMatchObject({ reason: "permission-preset" });
    expect(agentLookups).toBe(1);
    expect(admission.knowsSession("session-new")).toBe(false);
    admission.dispose();
  });

  it("keeps only the coarse preflight reason in the creation failure", () => {
    expect(
      qaAttestationFailureMessage(
        "Unable to create a QA session.",
        new QaAttestationError(
          "permission-preset",
          "the private deployment detail",
        ),
      ),
    ).toBe("Unable to create a QA session. (reason: permission-preset)");
    expect(
      qaAttestationFailureMessage(
        "Unable to create a QA session.",
        new Error("transport failed"),
      ),
    ).toBe("Unable to create a QA session.");
  });
});
