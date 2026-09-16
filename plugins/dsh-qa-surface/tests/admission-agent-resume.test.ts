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
function world(
  options: {
    live?: boolean;
    fail?: string;
    capability?: readonly string[];
    /** Tools the deployment does not mount, though its config names them. */
    unmounted?: readonly string[];
    /** Turn the sources feature on, including the reporter fallback. */
    sources?: boolean;
  } = {},
) {
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
      get: (name: string) =>
        options.unmounted?.includes(name) === true ? undefined : {},
    },
  };
  const admission = new QaPolicyAdmission(
    context as never,
    () =>
      resolveConfig({
        session: { workspaceId: "workspace-1" },
        lockdown: { toolPolicy: { allow: ["read"] } },
        sources:
          options.sources === true
            ? {
                enabled: true,
                subagents: {
                  inheritSources: true,
                  enableReportToolFallback: true,
                  markIncompleteOpaqueRuns: true,
                  validateReportedSources: false,
                },
              }
            : { enabled: false },
      }),
    {
      debug() {},
      info() {},
      warn(...args: unknown[]) {
        logged.push(
          args
            .map((value) =>
              typeof value === "string" ? value : JSON.stringify(value),
            )
            .join(" "),
        );
      },
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
    undefined,
    undefined,
    options.capability === undefined
      ? undefined
      : async () =>
          ({
            // A role's effective list is a session fact: it narrows the pinned
            // deployment list and carries plugin internals the config never had.
            policy: {
              subroleId: "general",
              tools: options.capability,
              grantableTools: [],
              skills: [],
            },
            skills: [],
            skillMetadata: new Map(),
            adminPreview: false,
            createGrants: () => ({
              dispose: () => undefined,
              effectiveTools: () => options.capability,
            }),
          }) as never,
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

  it("never pins a tool this deployment does not mount", async () => {
    // The sources fallback names this plugin's own reporter. A deployment that
    // turned the fallback on but does not mount the tool must lose the fallback,
    // not every chat: the policy may only name what the session can resolve.
    const { admission, restricted, logged } = world({
      live: true,
      sources: true,
      unmounted: ["qa_report_sources"],
    });
    const proof = await admission.secureSession("token", "session-cold");
    expect(proof.toolAllowList).toEqual(["read"]);
    expect(restricted).toEqual([["read"]]);
    expect(logged.join("\n")).toContain("sources.report-tool-unmounted");
    admission.dispose();
  });

  it("pins the reporter when the deployment does mount it", async () => {
    const { admission, restricted } = world({ live: true, sources: true });
    const proof = await admission.secureSession("token", "session-cold");
    expect(proof.toolAllowList).toEqual(["read"]);
    expect(restricted).toEqual([["read", "qa_report_sources"]]);
    admission.dispose();
  });

  it("pins host-trusted principal-scoped tools without exposing them as config", async () => {
    const { admission, restricted } = world({ live: true });
    const unregister = admission.registerPrincipalScopedTools([
      "bitrix_search_crm",
    ]);
    const proof = await admission.secureSession("token", "session-cold");
    expect(restricted).toEqual([["read", "bitrix_search_crm"]]);
    expect(proof.toolAllowList).toEqual(["read"]);
    unregister();
    admission.dispose();
  });

  it("reports the pinned deployment list as the proof, whatever a role narrows to", async () => {
    // The browser answers this proof against the lockdown config it holds, so
    // the role's own list — which carries the catalog's agent-local diagnostic
    // and drops what the role may not use — must not become the answer.
    const { admission } = world({
      live: true,
      capability: ["read", "qa_tools_selfcheck"],
    });
    const proof = await admission.secureSession("token", "session-cold");
    expect(proof.toolAllowList).toEqual(["read"]);
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
