import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaPolicyAdmission } from "../src/secure-session.js";

/**
 * The conversation ceiling, from the outside.
 *
 * A scoped restriction and a scoped guard cover the scope that owns them and
 * that scope's descendants. A delegated child is composed from the parent's
 * PRESET — `applyChildComposition` copies the preset rows and applies the
 * spawn's `toolFilter` — so the parent agent's layer never enters the child's
 * chain and no restriction of the chat reaches an expert. These tests hold the
 * guard that does: every agent of an attested conversation, the chat's own and
 * the ones delegated from it, is bounded by the subrole's reach.
 */

interface Captured {
  readonly guards: ((execution: unknown) => string | undefined)[];
}

/** Every denial any registered guard would return for one execution. */
function denial(captured: Captured, execution: unknown): string | undefined {
  for (const guard of captured.guards) {
    const reason = guard(execution);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

const ROLE_POLICY = {
  subroleId: "analyst",
  tools: ["read", "glob"],
  grantableTools: ["dsh_git_context"],
  skills: [],
  userSkills: [],
  sources: {
    systemTools: [],
    commonTools: ["read"],
    roleTools: ["glob"],
    commonGrantableTools: [],
    roleGrantableTools: ["dsh_git_context"],
    systemSkills: [],
    commonSkills: [],
    roleSkills: [],
    declaredSkills: [],
  },
  missingTools: [],
  missingSkills: [],
  policyRevision: "rev-1",
};

function harness(
  options: {
    readonly ceiling?: boolean;
    /** Names the QA tool catalog attaches to the agent itself. */
    readonly catalogTools?: readonly string[];
    /** The catalogue names that agent actually carries right now. */
    readonly attachedTools?: readonly string[];
  } = {},
) {
  const captured: Captured = { guards: [] };
  const sessions: ((session: never) => void)[] = [];
  const session = {
    id: "session-root",
    header: { id: "session-root", cwd: undefined, createdAt: Date.now() },
    surface: { nodes: [] },
    eventAt: () => undefined,
  };
  const agent = {
    session,
    options: {},
    ctx: {
      tools: {
        // The chat's own guard joins the same list: whichever layer refuses
        // first is the one the caller reads.
        guard: (guard: (execution: unknown) => string | undefined) => {
          captured.guards.push(guard);
          return () => undefined;
        },
        restrict: () => () => undefined,
      },
      systemPrompt: { section: () => () => undefined },
    },
  };
  const context = {
    on: (name: string, listener: (event: never) => void) => {
      if (name === "session/created") sessions.push(listener);
      return () => undefined;
    },
    agents: { get: () => agent },
    agentPresets: { composedPreset: () => undefined },
    workspaceRegistry: { get: () => undefined },
    get: () => undefined,
    permissionPresets: {
      resolve: () => ({ sandbox: "read-only", approval: "never" }),
      current: () => "qa-read-only",
      set: () => undefined,
    },
    tools: {
      guard: (guard: (execution: unknown) => string | undefined) => {
        captured.guards.push(guard);
        return () => undefined;
      },
      get: () => ({}),
    },
  };
  const admission = new QaPolicyAdmission(
    context as never,
    () =>
      resolveConfig({
        accounts: { enabled: true },
        lockdown: { toolPolicy: { allow: ["read", "glob"] } },
      }),
    { debug() {}, info() {}, warn() {}, error() {}, close() {} } as never,
    {
      enforceSessionAccess: () => ({ id: "user-1" }),
      userWorkspace: () => "",
      ownerIdOf: () => undefined,
    },
    () => options.attachedTools ?? [],
    options.ceiling === false
      ? undefined
      : async () => ({
          policy: ROLE_POLICY,
          skills: new Map(),
          skillMetadata: new Map(),
          adminPreview: false,
          // The grants object is exercised in tool-grants.test.ts; here it only
          // has to satisfy the admission's contract, which includes admitting
          // what the role can grant — the profile guard reads this set.
          createGrants: () =>
            ({
              dispose: () => undefined,
              effectiveTools: () =>
                new Set([...ROLE_POLICY.tools, ...ROLE_POLICY.grantableTools]),
            }) as never,
        }),
    () => options.catalogTools ?? [],
  );
  return { admission, captured, sessions, session, agent };
}

describe("conversation ceiling", () => {
  it("admits the role's tools and its grantable reach, denies the rest", async () => {
    const { admission, captured, agent } = harness();
    await admission.secureSession("token", "session-root");

    expect(
      denial(captured, { name: "read", arguments: {}, agent }),
    ).toBeUndefined();
    // Reachable only by activating a skill — but reachable, so a delegated
    // assistant may still hold it.
    expect(
      denial(captured, { name: "dsh_git_context", arguments: {}, agent }),
    ).toBeUndefined();
    expect(
      denial(captured, { name: "dsh_git_history", arguments: {}, agent }),
    ).toMatch(/capability profile/u);
  });

  it("bounds a delegated child the same way", async () => {
    const { admission, captured, sessions, agent } = harness();
    await admission.secureSession("token", "session-root");
    const child = {
      id: "session-child",
      header: {
        id: "session-child",
        cwd: undefined,
        parentSession: "session-root",
      },
    };
    for (const listener of sessions) listener(child as never);
    const childAgent = {
      session: child,
      options: {},
    };

    // The child's own scope carries no QA layer: its preset `toolFilter` names
    // `dsh_git_history`, and before this guard it simply got the tool.
    expect(
      denial(captured, {
        name: "dsh_git_history",
        arguments: {},
        agent: childAgent,
      }),
    ).toMatch(/capability profile/u);
    expect(
      denial(captured, {
        name: "dsh_git_context",
        arguments: {},
        agent: childAgent,
      }),
    ).toBeUndefined();
    expect(
      denial(captured, { name: "read", arguments: {}, agent: childAgent }),
    ).toBeUndefined();
    // The chat's own agent keeps its stricter scoped set.
    expect(
      denial(captured, { name: "dsh_git_history", arguments: {}, agent }),
    ).toMatch(/capability profile/u);
  });

  it("admits exactly the catalogue tools the agent carries", async () => {
    const { admission, captured, agent } = harness({
      catalogTools: ["docs_search", "docs_read", "file_delete"],
      attachedTools: ["docs_search", "docs_read"],
    });
    await admission.secureSession("token", "session-root");

    // A catalogue tool rides on the agent itself: no role list carries it and
    // no restriction can name it, so both layers — the profile guard and the
    // conversation ceiling — have to read it from the agent's own catalogue,
    // or a call to a tool the chat both owns and can see is refused as outside
    // a profile the caller cannot see the gap in.
    expect(
      denial(captured, { name: "docs_search", arguments: {}, agent }),
    ).toBeUndefined();
    expect(
      denial(captured, { name: "docs_read", arguments: {}, agent }),
    ).toBeUndefined();
    // A catalogue name this agent does not carry stays the role's to allow.
    expect(
      denial(captured, { name: "file_delete", arguments: {}, agent }),
    ).toMatch(/execution profile/u);
    // The rest of the ceiling is untouched by that admission.
    expect(
      denial(captured, { name: "dsh_git_history", arguments: {}, agent }),
    ).toMatch(/capability profile/u);
  });

  it("leaves a session without an attested policy alone", async () => {
    const { captured, agent } = harness({ ceiling: false });
    // No attestation at all: nothing is bounded, which is the pre-existing
    // behaviour for a deployment that never attests the session.
    expect(
      denial(captured, { name: "dsh_git_history", arguments: {}, agent }),
    ).toBeUndefined();
  });
});
