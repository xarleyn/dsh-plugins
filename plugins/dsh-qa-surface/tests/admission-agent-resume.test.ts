import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QaAttestationError } from "../src/attestation.js";
import { resolveConfig } from "../src/resolve-config.js";
import { QaPolicyAdmission } from "../src/secure-session.js";

/**
 * The Host materializes an agent on demand, so a chat restored from an earlier
 * Host run has a readable transcript and no agent. Attestation owns the resume:
 * without it the whole chat history in the sidebar is unopenable after every
 * restart.
 */
function world(options: { live?: boolean; fail?: string } = {}) {
  const workspace = mkdtempSync(path.join(tmpdir(), "qa-resume-"));
  const session = {
    id: "session-cold",
    header: { id: "session-cold", cwd: workspace, createdAt: Date.now() },
    surface: { nodes: [] },
    eventAt: () => undefined,
  };
  const restricted: string[][] = [];
  const agent = {
    session,
    options: {},
    ctx: {
      on: () => () => undefined,
      tools: {
        guard: () => () => undefined,
        restrict: (request: { allow: string[] }) => {
          restricted.push([...request.allow]);
          return () => undefined;
        },
      },
      systemPrompt: { section: () => () => undefined },
    },
  };
  const resolved = { count: 0 };
  const logged: string[] = [];
  const context = {
    on: () => () => undefined,
    agents: { get: () => (options.live === true ? agent : undefined) },
    sessionController: {
      resolveAgent: async () => {
        resolved.count += 1;
        return options.fail === undefined
          ? { agent }
          : { error: { message: options.fail } };
      },
    },
    agentPresets: { composedPreset: () => undefined },
    workspaceRegistry: { get: () => ({ path: workspace }) },
    get: () => undefined,
    permissionPresets: {
      resolve: () => ({ sandbox: "read-only", approval: "never" }),
      current: () => "qa-read-only",
      set: () => undefined,
    },
    tools: {
      guard: () => () => undefined,
      get: () => ({}),
    },
  };
  const admission = new QaPolicyAdmission(
    context as never,
    () =>
      resolveConfig({
        session: { workspaceId: "workspace-1" },
        lockdown: { toolPolicy: { allow: ["read"] } },
        sources: { enabled: false },
      }),
    {
      debug() {},
      info() {},
      warn() {},
      error(...args: unknown[]) {
        logged.push(
          args
            .map((value) =>
              typeof value === "string" ? value : JSON.stringify(value),
            )
            .join(" "),
        );
      },
      close() {},
    } as never,
  );
  return { admission, restricted, resolved, logged };
}

describe("agent materialization in policy admission", () => {
  it("resumes the agent of a session the Host has not materialized", async () => {
    const { admission, restricted, resolved } = world();
    const proof = await admission.secureSession("token", "session-cold");
    expect(resolved.count).toBe(1);
    expect(proof).toMatchObject({
      sessionId: "session-cold",
      toolPolicyLoaded: true,
      toolAllowList: ["read"],
    });
    // The policy is pinned on the RESUMED agent, not on a phantom.
    expect(restricted).toEqual([["read"]]);
    admission.dispose();
  });

  it("keeps the live agent when the Host already holds one", async () => {
    const { admission, resolved } = world({ live: true });
    await expect(
      admission.secureSession("token", "session-cold"),
    ).resolves.toMatchObject({ sessionId: "session-cold" });
    expect(resolved.count).toBe(0);
    admission.dispose();
  });

  it("refuses with agent-unavailable when the resume produces no agent", async () => {
    const { admission, logged } = world({
      fail: 'preset "qa-research" failed to mount: invalid config',
    });
    await expect(
      admission.secureSession("token", "session-cold"),
    ).rejects.toBeInstanceOf(QaAttestationError);
    await admission.secureSession("token", "session-cold").catch((error) => {
      expect((error as QaAttestationError).reason).toBe("agent-unavailable");
    });
    // The composition detail stays Host-side; the browser only gets the class.
    expect(logged.join("\n")).toContain("failed to mount");
    admission.dispose();
  });
});
