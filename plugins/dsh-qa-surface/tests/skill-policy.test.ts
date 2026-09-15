import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createScope } from "@deepseek-ai/dsh-scope";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import { describe, expect, it } from "vitest";
import { installQaSkillPolicy } from "../src/enforcement/skill-policy.js";
import type { QaEffectiveCapabilityPolicy } from "../src/types.js";

async function setup() {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(SkillRegistry);
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
  const agent = {
    id: "agent-a",
    session: { id: "session-a", header: { cwd: process.cwd() } },
  } as unknown as Agent;
  let scope!: ReturnType<typeof createScope>;
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        scope = createScope(inner, agent);
      },
      { inject: ["tools", "skills", "systemPrompt"] },
    ),
  );
  (agent as unknown as { ctx: Context }).ctx = scope.ctx;
  const discovered = new Map(
    (await ctx.skills.list({ scope: agent })).map((skill) => [
      skill.name,
      skill,
    ]),
  );
  return { ctx, agent, scope, discovered };
}

const policy: QaEffectiveCapabilityPolicy = {
  subroleId: "analyst",
  tools: ["skill"],
  skills: ["allowed-skill"],
  sources: {
    systemTools: [],
    commonTools: [],
    roleTools: ["skill"],
    systemSkills: [],
    commonSkills: [],
    roleSkills: ["allowed-skill"],
  },
  missingTools: [],
  missingSkills: [],
};

describe("QA skill policy consumer", () => {
  it("publishes only allowed skills and shadows the unfiltered loader", async () => {
    const { ctx, agent, discovered } = await setup();
    const dispose = installQaSkillPolicy(agent, policy, discovered);
    const assembly = await ctx.systemPrompt.assemble({ scope: agent });
    const text = assembly.sections.map(({ text }) => text).join("\n");
    expect(text).toContain("allowed-skill");
    expect(text).not.toContain("hidden-skill");

    const loader = ctx.tools.get("skill", agent)!;
    await expect(
      loader.execute({ name: "hidden-skill" }, {
        agent,
        signal: new AbortController().signal,
      } as never),
    ).rejects.toThrow(/SKILL_NOT_AVAILABLE/u);
    const loaded = await loader.execute({ name: "allowed-skill" }, {
      agent,
      signal: new AbortController().signal,
    } as never);
    expect(loaded).toMatchObject({
      name: "allowed-skill",
      content: expect.stringContaining("Follow allowed instructions."),
    });

    dispose();
    expect(ctx.tools.get("skill", agent)?.description).toBe(
      "unfiltered loader",
    );
  });
});
