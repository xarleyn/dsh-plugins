import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createScope } from "@deepseek-ai/dsh-scope";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { describe, expect, it } from "vitest";
import { parseQaSkillMetadata } from "../../src/access/skill-metadata.js";
import { QaAgentToolGrants } from "../../src/enforcement/tool-grants.js";
import type {
  QaSkillActivationRecord,
  QaSkillDescriptor,
} from "../../src/types.js";

const ROLES = new Set(["analyst"]);

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

function logger(): PluginLogger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    close() {},
  } as unknown as PluginLogger;
}

async function setup(options: {
  readonly registered: readonly string[];
  readonly baseTools: readonly string[];
  readonly grantableTools: readonly string[];
  /** Tools the agent registers for itself, the way the QA catalog does. */
  readonly localTools?: readonly string[];
  readonly descriptors: readonly QaSkillDescriptor[];
}) {
  const ctx = new Context();
  // The tool registry publishes its prompt provider at construction, so it
  // only becomes active once the prompt service exists.
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime);
  for (const name of options.registered) ctx.tools.register(globalTool(name));
  const agent = {
    id: "agent-a",
    session: { id: "session-a", header: { cwd: process.cwd() } },
  } as unknown as Agent;
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        const scope = createScope(inner, agent);
        (agent as unknown as { ctx: Context }).ctx = scope.ctx;
        for (const name of options.localTools ?? []) {
          scope.ctx.tools.register(globalTool(name));
        }
      },
      { inject: ["tools"] },
    ),
  );
  const records: QaSkillActivationRecord[] = [];
  const grants = new QaAgentToolGrants({
    agent,
    baseTools: options.baseTools,
    grantableTools: options.grantableTools,
    agentLocalTools: new Set(options.localTools ?? []),
    descriptors: new Map(options.descriptors.map((d) => [d.name, d])),
    logger: logger(),
    record: (entry) => records.push(entry),
  });
  return { ctx, agent, grants, records };
}

function descriptor(
  name: string,
  raw: Readonly<Record<string, unknown>> | undefined,
): QaSkillDescriptor {
  return parseQaSkillMetadata(
    name,
    raw === undefined ? undefined : { "qa-surface": raw },
    ROLES,
  );
}

const browser = descriptor("browser-research", {
  version: 1,
  audience: { type: "common" },
  tools: { requires: ["browser_open", "shell"] },
});
const strictBrowser = descriptor("strict-browser", {
  version: 1,
  audience: { type: "common" },
  tools: {
    requires: ["browser_open", "shell"],
    grant: { lifecycle: "session", requireAll: true },
  },
});
const debugging = descriptor("browser-debugging", {
  version: 1,
  audience: { type: "common" },
  tools: { requires: ["browser_click"] },
});

const visible = (ctx: Context, agent: Agent): readonly string[] =>
  ctx.tools.schemas(agent).map(({ name }) => name);

describe("dynamic skill tool grants", () => {
  it("expands the toolset only when the skill is activated", async () => {
    const { ctx, agent, grants } = await setup({
      registered: ["read", "browser_open", "browser_click", "shell"],
      baseTools: ["read"],
      grantableTools: ["browser_open", "browser_click"],
      descriptors: [browser, debugging],
    });
    expect(visible(ctx, agent)).toEqual(["read"]);
    expect(grants.effectiveTools()).toEqual(new Set(["read"]));

    const outcome = grants.activate("browser-research", "model");
    expect(outcome).toMatchObject({
      status: "activated",
      grant: {
        grantedTools: ["browser_open"],
        deniedTools: ["shell"],
      },
    });
    expect(outcome.status === "activated" && outcome.warning).toContain(
      "- shell",
    );
    expect(visible(ctx, agent)).toEqual(["read", "browser_open"]);
  });

  it("unions the grants of every activated skill", async () => {
    const { ctx, agent, grants } = await setup({
      registered: ["read", "browser_open", "browser_click"],
      baseTools: ["read"],
      grantableTools: ["browser_open", "browser_click"],
      descriptors: [browser, debugging],
    });
    grants.activate("browser-research", "model");
    grants.activate("browser-debugging", "user");
    expect(visible(ctx, agent)).toEqual([
      "read",
      "browser_open",
      "browser_click",
    ]);

    // Re-activating one skill never revokes what another one still holds.
    grants.activate("browser-research", "model");
    expect(visible(ctx, agent)).toEqual([
      "read",
      "browser_open",
      "browser_click",
    ]);
    expect(grants.activeGrants().map(({ skillName }) => skillName)).toEqual([
      "browser-research",
      "browser-debugging",
    ]);
  });

  it("refuses a strict skill and leaves the toolset untouched", async () => {
    const { ctx, agent, grants, records } = await setup({
      registered: ["read", "browser_open"],
      baseTools: ["read"],
      grantableTools: ["browser_open"],
      descriptors: [strictBrowser],
    });
    const outcome = grants.activate("strict-browser", "model");
    expect(outcome).toMatchObject({ status: "rejected" });
    expect(outcome.status === "rejected" && outcome.reason).toBe(
      'Skill "strict-browser" cannot be activated because required tool "shell" is unavailable for the current role.',
    );
    expect(visible(ctx, agent)).toEqual(["read"]);
    expect(grants.effectiveTools()).toEqual(new Set(["read"]));
    expect(records.at(-1)).toMatchObject({
      outcome: "rejected",
      grantedTools: [],
      deniedTools: ["shell"],
    });
  });

  it("never grants a tool outside the role ceiling", async () => {
    const { ctx, agent, grants } = await setup({
      registered: ["read", "shell"],
      baseTools: ["read"],
      grantableTools: [],
      descriptors: [strictBrowser],
    });
    // `shell` exists and is even registered, but the role may not grant it.
    const outcome = grants.activate("strict-browser", "model");
    expect(outcome).toMatchObject({ status: "rejected" });
    expect(visible(ctx, agent)).toEqual(["read"]);
  });

  it("drops a ceiling tool the registry refuses instead of failing", async () => {
    const { grants } = await setup({
      registered: ["read"],
      baseTools: ["read"],
      // Configured as grantable, but no such global tool is registered: the
      // scoped restriction would reject the name.
      grantableTools: ["browser_open"],
      descriptors: [browser],
    });
    const outcome = grants.activate("browser-research", "model");
    expect(outcome).toMatchObject({
      status: "activated",
      grant: { grantedTools: [], deniedTools: ["browser_open", "shell"] },
    });
    expect(grants.effectiveTools()).toEqual(new Set(["read"]));
  });

  it("keeps an agent-local base tool out of the mask instead of failing", async () => {
    // The QA activation diagnostic registers into the agent's own scope, and
    // `restrict()` may only name inherited tools. Before the base set was
    // filtered for the mask, this constructor threw and every chat's
    // attestation failed with "unknown global tool".
    const { ctx, agent, grants } = await setup({
      registered: ["read"],
      localTools: ["qa_tools_selfcheck"],
      baseTools: ["read", "qa_tools_selfcheck"],
      grantableTools: [],
      descriptors: [],
    });
    expect(grants.effectiveTools()).toEqual(
      new Set(["read", "qa_tools_selfcheck"]),
    );
    // An agent-local registration is visible outside the mask, so the tool the
    // restriction cannot name stays callable.
    expect(visible(ctx, agent)).toEqual(["read", "qa_tools_selfcheck"]);
  });

  it("grants a tool the agent owns without naming it in the mask", async () => {
    const { grants } = await setup({
      registered: ["read"],
      localTools: ["qa_tools_selfcheck"],
      baseTools: ["read"],
      grantableTools: ["qa_tools_selfcheck"],
      descriptors: [
        descriptor("qa-diagnostic", {
          version: 1,
          audience: { type: "common" },
          tools: { requires: ["qa_tools_selfcheck"] },
        }),
      ],
    });
    expect(grants.activate("qa-diagnostic", "model")).toMatchObject({
      status: "activated",
      grant: { grantedTools: ["qa_tools_selfcheck"], deniedTools: [] },
    });
  });

  it("records a denied audience without touching the toolset", async () => {
    const { grants, records } = await setup({
      registered: ["read", "browser_open"],
      baseTools: ["read"],
      grantableTools: ["browser_open"],
      descriptors: [browser],
    });
    grants.deny("browser-research", "user", "not available");
    expect(records.at(-1)).toMatchObject({
      outcome: "denied",
      skillName: "browser-research",
      origin: "user",
      reason: "not available",
    });
    expect(grants.effectiveTools()).toEqual(new Set(["read"]));
  });

  it("lifts the restriction when the session is disposed", async () => {
    const { ctx, agent, grants } = await setup({
      registered: ["read", "browser_open", "shell"],
      baseTools: ["read"],
      grantableTools: ["browser_open"],
      descriptors: [browser],
    });
    expect(visible(ctx, agent)).toEqual(["read"]);
    grants.activate("browser-research", "model");
    expect(visible(ctx, agent)).toEqual(["read", "browser_open"]);
    grants.dispose();
    // The mask is gone, so every global tool is visible again, while the
    // policy itself claims nothing beyond its base.
    expect(visible(ctx, agent)).toEqual(["read", "browser_open", "shell"]);
    expect(grants.effectiveTools()).toEqual(new Set(["read"]));
  });
});
