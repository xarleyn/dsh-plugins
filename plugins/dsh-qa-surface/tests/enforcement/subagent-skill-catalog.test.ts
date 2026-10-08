import type { SkillSummary } from "@deepseek-ai/dsh-skill";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaPolicyAdmission } from "../../src/secure-session.js";

/**
 * Where the model-facing skill catalog lives, and where it does not.
 *
 * The QA skill policy is an agent-local consumer: it shadows the standard
 * loader, publishes `<available_skills>` for the role's allow-list, and
 * enforces the same list on a typed `/name` — every half of that on the
 * attested agent's own scope. A delegated child composes from the parent's
 * PRESET (`applyChildComposition` joins the preset revision and installs the
 * spawn's persona and `toolFilter`), so no agent-local row of the chat enters
 * the child's chain, and the harness publishes a catalog only where the
 * `skill` tool is visible in that agent's scope. The role's catalog therefore
 * never reaches a delegated assistant; the only list a child can get is the
 * standard, unfiltered one, and only if its own `toolFilter` names `skill`.
 *
 * That narrowing is the decision this file pins, and it is deliberate: the
 * shadow consumer is what makes the role's allow-list real, and it is never
 * installed on a child, because a delegated session is refused attestation
 * outright — it has no owner to resolve a role from. Handing a delegated
 * assistant the parent's skill names without that enforcement would point it
 * at the standard, unfiltered loader: a wider reach than the role grants its
 * own chat. Carrying the catalog into children means carrying the
 * enforcement first.
 */

interface Recorded {
  /** System-prompt sections this agent was handed, in registration order. */
  readonly sections: { readonly name: string; readonly text: string }[];
  /** Tool names registered on this agent's own scope. */
  readonly registered: string[];
  /** `agent/pre-step` listeners: the palette-gesture enforcement. */
  preStepListeners: number;
}

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

function newRecord(): Recorded {
  return { sections: [], registered: [], preStepListeners: 0 };
}

function fakeAgent(sessionId: string, record: Recorded, parent?: string) {
  return {
    id: `agent-${sessionId}`,
    session: {
      id: sessionId,
      header: {
        id: sessionId,
        cwd: undefined,
        createdAt: Date.now(),
        ...(parent === undefined ? {} : { parentSession: parent }),
      },
      surface: { nodes: [] },
      eventAt: () => undefined,
    },
    options: {},
    ctx: {
      tools: {
        // The chat's own guard is registered on the Context, not here; the
        // agent-scoped one joins the execution decision as a second layer.
        guard: () => () => undefined,
        restrict: () => () => undefined,
        register: (definition: { readonly name: string }) => {
          record.registered.push(definition.name);
          return () => undefined;
        },
      },
      systemPrompt: {
        section: (input: { readonly name: string; readonly text: string }) => {
          record.sections.push(input);
          return () => undefined;
        },
      },
      on: (name: string) => {
        if (name === "agent/pre-step") record.preStepListeners += 1;
        return () => undefined;
      },
    },
  };
}

const roleSkill: SkillSummary = {
  name: "role-skill",
  description: "Instructions the role grants its chat",
  invocation: { modelInvocable: true, userInvocable: true },
  source: "runtime",
  provider: "runtime",
};

const ROLE_POLICY = {
  subroleId: "analyst",
  tools: ["read", "skill"],
  grantableTools: ["browser_open"],
  skills: ["role-skill"],
  userSkills: ["role-skill"],
  sources: {
    systemTools: [],
    commonTools: ["read"],
    roleTools: ["skill"],
    commonGrantableTools: [],
    roleGrantableTools: ["browser_open"],
    systemSkills: [],
    commonSkills: [],
    roleSkills: ["role-skill"],
    declaredSkills: [],
  },
  missingTools: [],
  missingSkills: [],
  policyRevision: "rev-1",
};

function harness() {
  const captured: Captured = { guards: [] };
  const sessions: ((session: never) => void)[] = [];
  const agents = new Map<string, ReturnType<typeof fakeAgent>>();
  const addAgent = (sessionId: string, parent?: string) => {
    const record = newRecord();
    const agent = fakeAgent(sessionId, record, parent);
    agents.set(sessionId, agent);
    return record;
  };
  const rootRecord = addAgent("session-root");
  const context = {
    on: (name: string, listener: (event: never) => void) => {
      if (name === "session/created") sessions.push(listener);
      return () => undefined;
    },
    agents: { get: (id: string) => agents.get(String(id)) },
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
        lockdown: { toolPolicy: { allow: ["read", "skill"] } },
      }),
    { debug() {}, info() {}, warn() {}, error() {}, close() {} } as never,
    {
      enforceSessionAccess: () => ({ id: "user-1" }),
      userWorkspace: () => "",
      ownerIdOf: () => undefined,
    },
    () => [],
    async () => ({
      policy: ROLE_POLICY,
      skills: new Map<string, SkillSummary>([[roleSkill.name, roleSkill]]),
      skillMetadata: new Map(),
      adminPreview: false,
      createGrants: () =>
        ({
          dispose: () => undefined,
          effectiveTools: () =>
            new Set([...ROLE_POLICY.tools, ...ROLE_POLICY.grantableTools]),
        }) as never,
    }),
    () => [],
  );
  /** Create a delegated child the way the Host does, and materialize its agent. */
  const createChild = (sessionId: string) => {
    const child = {
      id: sessionId,
      header: { id: sessionId, cwd: undefined, parentSession: "session-root" },
    };
    for (const listener of sessions) listener(child as never);
    return addAgent(sessionId, "session-root");
  };
  const childAgent = (sessionId: string) => agents.get(sessionId);
  return {
    admission,
    captured,
    rootRecord,
    createChild,
    childAgent,
  };
}

/** The catalog text one agent was handed, or `undefined` when it has none. */
function catalogOf(record: Recorded): string | undefined {
  return record.sections.find(
    (section) => section.name === "qa-surface:available-skills",
  )?.text;
}

describe("delegated child and the skill catalog", () => {
  it("publishes the role's catalog on the attested chat's own agent", async () => {
    const { admission, rootRecord } = harness();
    await admission.secureSession("token", "session-root");

    expect(catalogOf(rootRecord)).toContain("<available_skills>");
    expect(catalogOf(rootRecord)).toContain('name="role-skill"');
    // The shadow loader and the palette enforcement are installed beside the
    // catalog: the list and the allow-list that makes it true are one
    // installation on one agent, which is why neither can travel alone.
    expect(rootRecord.registered).toContain("skill");
    expect(rootRecord.preStepListeners).toBe(1);
  });

  it("refuses to attest a delegated child, so no catalog is ever installed there", async () => {
    const { admission, rootRecord, createChild } = harness();
    await admission.secureSession("token", "session-root");
    const childRecord = createChild("session-child");

    await expect(
      admission.secureSession("token", "session-child"),
    ).rejects.toMatchObject({ reason: "adoption-refused" });

    // The chat keeps its catalog; the delegation has no part of it.
    expect(catalogOf(rootRecord)).toContain("<available_skills>");
    expect(childRecord.sections).toEqual([]);
    expect(childRecord.registered).toEqual([]);
    expect(childRecord.preStepListeners).toBe(0);
  });

  it("bounds a delegated child's tools while leaving its catalog unwritten", async () => {
    const { admission, captured, createChild, childAgent } = harness();
    await admission.secureSession("token", "session-root");
    const childRecord = createChild("session-child");
    const agent = childAgent("session-child");

    // The one skill-adjacent reach that does cross into the child is the
    // conversation ceiling: what it may never call, not what it may see.
    expect(
      denial(captured, {
        name: "shell",
        arguments: {},
        agent,
      }),
    ).toMatch(/capability profile/u);
    expect(
      denial(captured, { name: "skill", arguments: {}, agent }),
    ).toBeUndefined();
    // So a child whose own preset names `skill` can reach the standard
    // loader, and the role's list is never published for it. Naming the
    // catalog here would be the leak the header comment describes.
    expect(childRecord.sections).toEqual([]);
  });
});
