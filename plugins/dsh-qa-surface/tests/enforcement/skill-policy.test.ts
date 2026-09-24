import { Context } from "@deepseek-ai/cordis";
import { agentEvents } from "@deepseek-ai/dsh-agent";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { createScope } from "@deepseek-ai/dsh-scope";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import type { SkillSummary } from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { describe, expect, it } from "vitest";
import { parseQaSkillMetadata } from "../../src/access/skill-metadata.js";
import { installQaSkillPolicy } from "../../src/enforcement/skill-policy.js";
import { QaAgentToolGrants } from "../../src/enforcement/tool-grants.js";
import type {
  QaEffectiveCapabilityPolicy,
  QaSkillActivationRecord,
  QaSkillDescriptor,
} from "../../src/types.js";

const ROLES = new Set(["analyst"]);

function logger(): PluginLogger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    close() {},
  } as unknown as PluginLogger;
}

function globalTool(name: string) {
  return defineTool({
    name,
    description: `${name} tool`,
    parameters: {},
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }],
    },
    execute: async () => `${name} ran`,
  });
}

const descriptor = (
  name: string,
  raw: Readonly<Record<string, unknown>>,
): QaSkillDescriptor =>
  parseQaSkillMetadata(name, { "qa-surface": raw }, ROLES);

const policy: QaEffectiveCapabilityPolicy = {
  subroleId: "analyst",
  tools: ["read", "skill"],
  grantableTools: ["browser_open"],
  skills: ["allowed-skill"],
  userSkills: ["allowed-skill", "user-only-skill"],
  sources: {
    systemTools: [],
    commonTools: [],
    roleTools: ["skill"],
    commonGrantableTools: ["browser_open"],
    roleGrantableTools: [],
    systemSkills: [],
    commonSkills: [],
    roleSkills: ["allowed-skill"],
    declaredSkills: [],
  },
  missingTools: [],
  missingSkills: [],
  policyRevision: "rev-1",
};

async function setup(options: {
  /** Harness-shaped injection of a `/name` gesture, as `dsh-tool-skill` does. */
  readonly harnessGesture?: readonly string[];
}) {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(SkillRegistry);
  ctx.tools.register(globalTool("read"));
  ctx.tools.register(
    defineTool({
      name: "skill",
      description: "unfiltered loader",
      parameters: { name: { type: "string", required: true } },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: String(value) }],
      },
      execute: async () => "global loader",
    }),
  );
  ctx.tools.register(globalTool("browser_open"));
  ctx.skills.register({
    name: "allowed-skill",
    description: "Allowed instructions",
    source: "runtime",
    content: "Follow allowed instructions.",
  });
  ctx.skills.register({
    name: "hidden-skill",
    description: "Hidden instructions",
    source: "runtime",
    content: "Never expose this.",
  });
  ctx.skills.register({
    name: "strict-skill",
    description: "Strict instructions",
    source: "runtime",
    content: "Requires everything.",
  });
  const gestures = options.harnessGesture ?? [];
  if (gestures.length > 0) {
    // Stands in for the standard skill consumer, which appends the rendered
    // body of every `/name` gesture it recognizes.
    ctx.on("agent/pre-step", async (_payload, next) => {
      const decision = await next();
      if (decision.kind === "reject") return decision;
      const injections = gestures.map((name) =>
        createUserMessage({
          content: [{ type: "text", text: `<skill_content name="${name}">` }],
          source: { kind: "skill-invocation", name, form: "instructions" },
        }),
      );
      return { ...decision, messages: [...decision.messages, ...injections] };
    });
  }
  const agent = {
    id: "agent-a",
    session: { id: "session-a", header: { cwd: process.cwd() } },
  } as unknown as Agent;
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        const scope = createScope(inner, agent);
        (agent as unknown as { ctx: Context }).ctx = scope.ctx;
      },
      { inject: ["tools", "skills", "systemPrompt"] },
    ),
  );
  const discovered = new Map<string, SkillSummary>(
    (await ctx.skills.list({ scope: agent })).map((skill) => [
      skill.name,
      skill,
    ]),
  );
  const records: QaSkillActivationRecord[] = [];
  const grants = new QaAgentToolGrants({
    agent,
    baseTools: policy.tools,
    grantableTools: policy.grantableTools,
    agentLocalTools: new Set(),
    descriptors: new Map<string, QaSkillDescriptor>([
      [
        "allowed-skill",
        descriptor("allowed-skill", {
          version: 1,
          audience: { type: "common" },
          tools: { requires: ["browser_open", "shell"] },
        }),
      ],
      [
        "strict-skill",
        descriptor("strict-skill", {
          version: 1,
          audience: { type: "common" },
          tools: {
            requires: ["browser_open", "shell"],
            grant: { lifecycle: "session", requireAll: true },
          },
        }),
      ],
    ]),
    logger: logger(),
    record: (entry) => records.push(entry),
  });
  return { ctx, agent, grants, discovered, records };
}

async function load(agent: Agent, name: string): Promise<unknown> {
  const ctx = (agent as unknown as { ctx: Context }).ctx;
  const definition = ctx.tools.get("skill", agent);
  return await definition!.execute({ name }, {
    agent,
    signal: new AbortController().signal,
  } as never);
}

async function propose(
  ctx: Context,
  agent: Agent,
  messages: readonly UserMessage[],
): Promise<PreStepDecision> {
  return await agentEvents(ctx, agent).waterfall(
    "agent/pre-step",
    {
      messages: [...messages],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    },
    () => Promise.resolve({ kind: "enter" as const, messages: [...messages] }),
  );
}

describe("QA skill policy consumer", () => {
  it("publishes only allowed skills and shadows the unfiltered loader", async () => {
    const { ctx, agent, discovered, grants } = await setup({});
    const dispose = installQaSkillPolicy({
      agent,
      policy,
      discovered,
      grants,
      logger: logger(),
    });
    const assembly = await ctx.systemPrompt.assemble({ scope: agent });
    const text = assembly.sections.map(({ text }) => text).join("\n");
    expect(text).toContain("allowed-skill");
    expect(text).not.toContain("hidden-skill");

    await expect(load(agent, "hidden-skill")).rejects.toThrow(
      /SKILL_NOT_AVAILABLE/u,
    );
    const loaded = (await load(agent, "allowed-skill")) as {
      readonly name: string;
      readonly content: string;
    };
    expect(loaded.name).toBe("allowed-skill");
    expect(loaded.content).toContain("Follow allowed instructions.");
    // Loading the skill is also what widens the toolset, and what it could not
    // get is reported to the model instead of failing silently.
    expect(loaded.content).toContain("- shell");
    expect(grants.effectiveTools()).toEqual(
      new Set(["read", "skill", "browser_open"]),
    );

    dispose();
    expect(ctx.tools.get("skill", agent)?.description).toBe(
      "unfiltered loader",
    );
  });

  it("refuses a strict skill and hands over no instructions", async () => {
    const { agent, discovered, grants, records } = await setup({});
    const dispose = installQaSkillPolicy({
      agent,
      policy: { ...policy, skills: ["strict-skill"], userSkills: [] },
      discovered,
      grants,
      logger: logger(),
    });
    await expect(load(agent, "strict-skill")).rejects.toThrow(
      /required tool "shell" is unavailable/u,
    );
    expect(grants.effectiveTools()).toEqual(new Set(["read", "skill"]));
    expect(records.at(-1)).toMatchObject({
      outcome: "rejected",
      skillName: "strict-skill",
      origin: "model",
    });
    dispose();
  });

  it("activates the grant of a skill invoked with /name", async () => {
    const { ctx, agent, discovered, grants } = await setup({
      harnessGesture: ["allowed-skill"],
    });
    const dispose = installQaSkillPolicy({
      agent,
      policy,
      discovered,
      grants,
      logger: logger(),
    });
    const decision = await propose(ctx, agent, [
      createUserMessage({
        content: [{ type: "text", text: "/allowed-skill please" }],
        source: { kind: "user" },
      }),
    ]);
    if (decision.kind !== "enter") throw new Error("expected enter");
    expect(
      decision.messages.some(
        ({ source }) => source.kind === "skill-invocation",
      ),
    ).toBe(true);
    expect(grants.effectiveTools()).toEqual(
      new Set(["read", "skill", "browser_open"]),
    );
    dispose();
  });

  it("withdraws a /name gesture for a skill outside the subrole", async () => {
    const { ctx, agent, discovered, grants, records } = await setup({
      harnessGesture: ["hidden-skill"],
    });
    const dispose = installQaSkillPolicy({
      agent,
      policy,
      discovered,
      grants,
      logger: logger(),
    });
    const decision = await propose(ctx, agent, [
      createUserMessage({
        content: [{ type: "text", text: "/hidden-skill go" }],
        source: { kind: "user" },
      }),
    ]);
    if (decision.kind !== "enter") throw new Error("expected enter");
    expect(
      decision.messages.some(
        ({ source }) => source.kind === "skill-invocation",
      ),
    ).toBe(false);
    expect(records.at(-1)).toMatchObject({
      outcome: "denied",
      skillName: "hidden-skill",
      origin: "user",
    });
    expect(grants.effectiveTools()).toEqual(new Set(["read", "skill"]));
    dispose();
  });
});
