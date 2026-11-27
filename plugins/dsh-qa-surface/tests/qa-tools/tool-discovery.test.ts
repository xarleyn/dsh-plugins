import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import { createScope } from "@deepseek-ai/dsh-scope";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import Tools, { type ResolvedToolSet } from "@deepseek-ai/dsh-tools";
import * as NativeExecutor from "@deepseek-ai/dsh-tool-executor-native";
import { afterEach, expect, it, vi } from "vitest";
import { QaPolicyAdmission } from "../../src/secure-session.js";
import { QaApprovalGate } from "../../src/approvals.js";
import { QaSessionOwnership } from "../../src/session-ownership.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { FIND_TOOLS } from "../../src/qa-tools/find-tools.js";
import { QaAgentToolGrants } from "../../src/enforcement/tool-grants.js";
import { parseQaSkillMetadata } from "../../src/access/skill-metadata.js";
import type { QaResolvedSessionPolicy } from "../../src/access/service.js";

const write = "bitrix_add_crm_timeline_comment";
const families = [
  write,
  "gitlab_repository_tree",
  "teamcity_builds",
  "weblate_translation_get",
  "testit_test_runs",
];
const unchanged = [
  "read",
  "jira_search",
  "confluence_search",
  "gitlab_other_plugin",
];
const forbidden = "gitlab_private_view";
const skillOnly = "weblate_skill_operation";
const skillName = "review-translations";
const clean: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const f of clean.splice(0).reverse()) await f();
});

async function setup(
  initial: "off" | "observe" | "search",
  previous?: string[],
  accountFree = false,
  withSkill = false,
) {
  const ctx = new Context();
  clean.push(async () => {
    await ctx.fiber.dispose();
  });
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(Tools);
  await ctx.plugin(NativeExecutor);
  if (withSkill) {
    await ctx.plugin(SkillRegistry);
    ctx.skills.register({
      name: skillName,
      source: "runtime",
      description: "Review",
      content: "Review translations.",
    });
  }
  const calls: string[] = [];
  const ownerNames = [
    ...families,
    "jira_search",
    "confluence_search",
    forbidden,
    ...(withSkill ? [skillOnly] : []),
  ];
  for (const name of [
    ...families,
    ...unchanged,
    forbidden,
    ...(withSkill ? ["skill", skillOnly] : []),
  ])
    ctx.tools.register({
      name,
      description: "Synthetic operation " + name,
      parameters: { type: "object", properties: {} },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: String(value) }],
      },
      execute: async () => {
        calls.push(name);
        return name;
      },
    });
  const agentFor = (id: string) =>
    ({
      options: {},
      session: {
        id,
        header: { createdAt: Date.now() },
        surface: { nodes: [] },
        requestHeader: () =>
          previous && { tools: previous.map((name) => ({ name })) },
      },
    }) as unknown as Agent;
  const agent = agentFor("root"),
    other = agentFor("other");
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        for (const a of [agent, other])
          Object.assign(a, { ctx: createScope(inner, a).ctx });
      },
      { inject: ["tools", "systemPrompt"] },
    ),
  );
  ctx.provide("agents", {
    get: (id: string) => (id === "root" ? agent : other),
  } as never);
  ctx.provide("permissionPresets", {
    current: () => "qa-read-only",
    set: () => {},
    resolve: () => ({ approval: "never", sandbox: "read-only" }),
  } as never);
  let mode = initial;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  } as const;
  const admission = new QaPolicyAdmission(
    ctx,
    () =>
      resolveConfig({
        tools: { discoveryMode: mode },
        sources: { enabled: false },
        lockdown: { toolPolicy: { allow: unchanged } },
      }),
    logger as never,
    undefined,
    undefined,
    accountFree
      ? undefined
      : async () => {
          const baseTools = [
            ...unchanged,
            ...families,
            ...(withSkill ? ["skill"] : []),
          ];
          const grantableTools = [forbidden, ...(withSkill ? [skillOnly] : [])];
          const skills = withSkill
            ? await ctx.skills.list({ scope: agent })
            : [];
          return {
            policy: {
              tools: baseTools,
              grantableTools,
              skills: skills.map((s) => s.name),
              userSkills: [],
            },
            skills: new Map(skills.map((s) => [s.name, s])),
            adminPreview: false,
            createGrants: () =>
              new QaAgentToolGrants({
                agent,
                baseTools,
                grantableTools,
                agentLocalTools: new Set(),
                descriptors: new Map(
                  withSkill
                    ? [
                        [
                          skillName,
                          parseQaSkillMetadata(
                            skillName,
                            {
                              "qa-surface": {
                                version: 1,
                                tools: {
                                  requires: [
                                    skillOnly,
                                    "gitlab_repository_tree",
                                  ],
                                },
                              },
                            },
                            new Set(),
                          ),
                        ],
                      ]
                    : [],
                ),
                logger: logger as never,
              }),
          } as unknown as QaResolvedSessionPolicy;
        },
  );
  clean.push(() => admission.dispose());
  admission.registerPrincipalScopedTools(
    accountFree ? ownerNames.filter((n) => n !== forbidden) : ownerNames,
  );
  // This independent restriction (e.g. a preset) cannot be lifted by discovery.
  agent.ctx.tools.restrict({ deny: [forbidden] });
  return {
    ctx,
    agent,
    other,
    calls,
    logger,
    admission,
    ownerNames,
    attest: () => admission.secureSession("test", "root"),
    mode: (next: typeof mode) => {
      mode = next;
      admission.refreshDiscoveryMode();
    },
    async step(subject = agent) {
      const signal = new AbortController().signal;
      const toolSet = await ctx.tools.resolve({
        agent: subject,
        modelSelection: { provider: "fixture", model: "fixture" },
        signal,
      });
      clean.push(() => toolSet.dispose());
      return {
        toolSet,
        names: (
          await ctx.systemPrompt.assemble({
            agent: subject,
            scope: subject,
            toolSet,
          })
        ).tools.map((t) => t.name),
      };
    },
    async call(
      name: string,
      args: object,
      toolSet: ResolvedToolSet,
      subject = agent,
    ) {
      const batch = await ctx.tools.execute({
        agent: subject,
        toolSet,
        signal: new AbortController().signal,
        calls: [
          {
            id: ToolCallId("demo-call"),
            name,
            type: "tool-call",
            arguments: JSON.stringify(args),
          },
        ],
      });
      return batch.results[0]!.result;
    },
  };
}

it.each(["off", "observe"] as const)(
  "%s preserves the exact native surface and direct calls",
  async (mode) => {
    const t = await setup(mode);
    await t.attest();
    const first = await t.step();
    expect(first.names.sort()).toEqual([...families, ...unchanged].sort());
    expect((await t.call(families[1]!, {}, first.toolSet)).isError).toBe(false);
    const logs = JSON.stringify(t.logger.info.mock.calls);
    expect(logs.includes("tool-discovery.observe")).toBe(mode === "observe");
    expect(logs.includes("tool-discovery.used")).toBe(mode === "observe");
  },
);

it("reveals only searched native tools on the next step without touching another agent, its role, or approval", async () => {
  const t = await setup("search");
  await t.attest();
  // Re-attestation validates the original, role-filtered inventory even while hidden.
  await t.attest();
  const a = await t.step();
  expect(
    t.logger.debug.mock.calls.filter(
      (row) => row[0] === "tool-discovery.setup-error",
    ),
  ).toEqual([]);
  expect(a.names.sort()).toEqual([...unchanged, FIND_TOOLS].sort());
  expect((await t.step(t.other)).names).toContain(write);
  expect((await t.step(t.other)).names).not.toContain(FIND_TOOLS);
  const list = await t.call(FIND_TOOLS, { browse: true }, a.toolSet);
  expect(list.isError).toBe(false);
  expect(list.content[0]).toMatchObject({
    type: "text",
    text: expect.stringContaining(write),
  });
  expect(JSON.stringify(list)).not.toContain(forbidden);
  const denied = await t.call(FIND_TOOLS, { query: forbidden }, a.toolSet);
  expect(JSON.stringify(denied)).not.toContain(forbidden);
  const jira = await t.call(
    FIND_TOOLS,
    { query: "jira_search_issues" },
    a.toolSet,
  );
  expect(jira.content[0]).toMatchObject({
    text: expect.stringContaining("use the matching callable jira_*"),
  });
  expect(jira.content[0]).toMatchObject({
    text: expect.stringContaining('"status":"no_matches"'),
  });
  expect((await t.step()).names).not.toContain(write);
  expect((await t.call(FIND_TOOLS, { query: write }, a.toolSet)).isError).toBe(
    false,
  );
  expect((await t.call(write, {}, a.toolSet)).isError).toBe(true);
  const b = await t.step();
  expect(b.names.sort()).toEqual([...a.names, write].sort());
  expect(t.calls).toEqual([]);
  expect((await t.call(forbidden, {}, b.toolSet)).isError).toBe(true);

  const ownership = new QaSessionOwnership((id) =>
    t.admission.knowsSession(id),
  );
  const gate = new QaApprovalGate(
    t.ctx,
    () => true,
    ownership,
    t.logger as never,
  );
  gate.install();
  clean.push(() => {
    gate.dispose();
    ownership.dispose();
  });
  t.ctx.on("tools/pre-execute", (exec, next) =>
    exec.name === write
      ? Promise.resolve({
          kind: "ask" as const,
          reason: "Confirm original operation",
        })
      : next(),
  );
  for (const answer of ["rejected", "allowed-once"] as const) {
    const pending = t.call(write, {}, b.toolSet);
    await vi.waitFor(() => expect(gate.list("root")).toHaveLength(1));
    const card = gate.list("root")[0]!;
    expect(card).toMatchObject({
      toolName: write,
      reason: "Confirm original operation",
    });
    expect(gate.answer("other", card.id, answer)).toBe(false);
    expect(t.calls).toEqual([]);
    gate.answer("root", card.id, answer);
    expect((await pending).isError).toBe(answer === "rejected");
  }
  expect(t.calls).toEqual([write]);
  t.mode("off");
  expect((await t.step()).names.sort()).toEqual(
    [...families, ...unchanged].sort(),
  );
});

it("cannot discover an unactivated grant and opens only the successful skill's requirements on the next step", async () => {
  const t = await setup("search", undefined, false, true);
  await t.attest();
  const first = await t.step();
  const listed = await t.call(FIND_TOOLS, { browse: true }, first.toolSet);
  expect(listed.isError).toBe(false);
  expect(JSON.stringify(listed.content)).not.toContain(skillOnly);
  expect(
    (await t.call("skill", { name: skillName }, first.toolSet)).isError,
  ).toBe(false);
  expect((await t.call(skillOnly, {}, first.toolSet)).isError).toBe(true);
  const next = await t.step();
  expect(next.names).toContain(skillOnly);
  expect(next.names).toContain("gitlab_repository_tree");
  expect(next.names).not.toContain(write);
  expect((await t.call(skillOnly, {}, next.toolSet)).isError).toBe(false);
});

it("restores only previously opened allowed names, leaving older ordinary chats unchanged", async () => {
  const restored = await setup("search", [
    FIND_TOOLS,
    "teamcity_builds",
    forbidden,
  ]);
  await restored.attest();
  expect((await restored.step()).names.sort()).toEqual(
    [...unchanged, FIND_TOOLS, "teamcity_builds"].sort(),
  );
  const old = await setup("search", unchanged);
  await old.attest();
  expect((await old.step()).names.sort()).toEqual(
    [...families, ...unchanged].sort(),
  );
});

it("keeps account-free integrations callable after repeated admission and drops newly masked entries from search", async () => {
  const t = await setup("search", undefined, true);
  await t.attest();
  await t.attest();
  const a = await t.step();
  expect(a.names).toContain(FIND_TOOLS);
  expect(a.names).not.toContain(write);
  t.agent.ctx.tools.restrict({ deny: [write] });
  const result = await t.call(FIND_TOOLS, { query: write }, a.toolSet);
  expect(result.isError).toBe(false);
  expect(JSON.stringify(result.content)).not.toContain(write);
  expect((await t.step()).names).not.toContain(write);
  const hit = await t.call(FIND_TOOLS, { query: "переводы" }, a.toolSet);
  expect(JSON.stringify(hit.content)).toContain("weblate_translation_get");
  const next = await t.step();
  expect(
    (await t.call("weblate_translation_get", {}, next.toolSet)).isError,
  ).toBe(false);
});

it("leaves the original tools in place if an executor cannot advertise the finder", async () => {
  const t = await setup("search");
  t.agent.ctx.tools.setExecutor({
    describe: (defs) => ({
      schemas: defs
        .filter((d) => d.name !== FIND_TOOLS)
        .map(({ name, description, parameters }) => ({
          name,
          description,
          parameters,
        })),
    }),
    execute: async () => {
      throw new Error("not used");
    },
  });
  await t.attest();
  expect((await t.step()).names.sort()).toEqual(
    [...families, ...unchanged].sort(),
  );
  expect(t.ctx.tools.get(FIND_TOOLS, t.agent)).toBeUndefined();
});
