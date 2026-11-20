import * as NativeExecutor from "@deepseek-ai/dsh-tool-executor-native";
import { Context } from "@deepseek-ai/cordis";
import AgentRegistry, { type Agent } from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import LlmRuntime, {
  createUserMessage,
  LlmAdapter,
  LlmError,
} from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import SessionStore, { SessionId } from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { createPluginLogger } from "@yadsh/dsh-plugin-log";
import { expect, it, onTestFinished } from "vitest";
import { installQaSkillPolicy } from "../../src/enforcement/skill-policy.js";
import { QaAgentToolGrants } from "../../src/enforcement/tool-grants.js";
import { QaIntegrationQuestionPolicy } from "../../src/integration/question-policy.js";
import { QaPromptNotes } from "../../src/prompt-notes.js";
import type { QaEffectiveCapabilityPolicy } from "../../src/types.js";
import { config, owningStore } from "./prompt-notes.helpers.js";

class CaptureAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  failThirdRequest = false;

  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request);
    if (this.failThirdRequest && this.requests.length === 3)
      throw new LlmError(
        "Synthetic context overflow",
        "CONTEXT_WINDOW_EXCEEDED",
      );
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text: "ok" };
    yield { type: "block-end", index: 0, block: { type: "text", text: "ok" } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

function notes(request: GenerateOptions): string[] {
  return request.messages.flatMap((message) =>
    message.role === "user" &&
    message.source?.kind === "qa-notes" &&
    message.source.form === "snapshot"
      ? message.source.sections.map((section) => section.name)
      : [],
  );
}

async function send(ctx: Context, agent: Agent, text: string): Promise<void> {
  const done = new Promise<void>((resolve) => {
    const stop = ctx.on("agent/status", ({ agent: subject, status }) => {
      if (subject !== agent || status !== "idle") return;
      stop();
      resolve();
    });
  });
  agent.followup(
    createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }),
  );
  await done;
}

it.each(["before", "after", "request", "retry"] as const)(
  "restores QA notes and the catalog in the next Host request after %s compaction",
  async (timing) => {
    const ctx = new Context();
    onTestFinished(() => ctx.fiber.dispose());
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjectionRegistry);
    await ctx.plugin(SystemPrompt, { includeRuntimeContext: false });
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(NativeExecutor);
    await ctx.plugin(SkillRegistry);
    ctx.skills.register({
      name: "demo-skill",
      description: "Demo instructions",
      source: "runtime",
      content: "Follow the demo instructions.",
    });
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(AgentLoop, { agents: [] });
    const adapter = new CaptureAdapter();
    adapter.failThirdRequest = timing === "retry";
    ctx.llm.registerAdapter(["demo"], adapter);
    const { accounts } = owningStore();
    onTestFinished(() => accounts.close());
    const logger = createPluginLogger({
      pluginId: "qa-context-test",
      file: false,
      console: "silent",
      level: "silent",
    });
    onTestFinished(() => logger.close());
    const installNotes = () =>
      new QaPromptNotes(ctx, {
        config: () => config(),
        accounts: () => accounts,
        isQaSession: (id) => id === "session-root",
        logger,
      });
    let ambient = installNotes();
    const questionPolicy = new QaIntegrationQuestionPolicy(ctx, () => accounts);
    onTestFinished(() => {
      ambient.dispose();
      questionPolicy.dispose();
    });
    let replaced = false;
    const compact = (agent: Agent, turn: number) => {
      if (turn !== 3 || replaced) return;
      const span = agent.session.surface.nodes.slice(1);
      expect(span.length).toBeGreaterThan(0);
      agent.session.append(
        "user/message",
        createUserMessage({
          content: [{ type: "text", text: "Conversation summary." }],
          source: { kind: "qa-notes", form: "snapshot", sections: [] },
        }),
        {
          surfaceOp: {
            op: "replace",
            startSeq: span[0]!,
            endSeq: span.at(-1)!,
          },
          sourceEventSeqs: span,
        },
      );
      replaced = true;
    };
    ctx.on("agent/pre-step", async ({ agent, turn }, next) => {
      if (timing === "before") compact(agent, turn);
      const decision = await next();
      if (timing === "after") compact(agent, turn);
      return decision;
    });
    ctx.on("agent/request", async ({ agent, turn }, next) => {
      const request = await next();
      if (timing === "request") compact(agent, turn);
      return request;
    });
    ctx.on("agent/request-error", async ({ agent, turn }, next) => {
      if (timing !== "retry" || replaced) return next();
      compact(agent, turn);
      return { kind: "retry" };
    });
    const agent = await ctx.agentLoop.create(SessionId("session-root"), {
      provider: "demo",
      model: "demo",
    });
    agent.ctx.systemPrompt.section({
      name: "complete-persona",
      order: 0,
      complete: true,
      text: "QA assistant.",
    });
    const policy: QaEffectiveCapabilityPolicy = {
      subroleId: "analyst",
      tools: ["skill"],
      grantableTools: [],
      skills: ["demo-skill"],
      userSkills: [],
      sources: {
        systemTools: [],
        commonTools: [],
        roleTools: ["skill"],
        commonGrantableTools: [],
        roleGrantableTools: [],
        systemSkills: [],
        commonSkills: [],
        roleSkills: ["demo-skill"],
        declaredSkills: [],
      },
      missingTools: [],
      missingSkills: [],
      policyRevision: "demo-1",
    };
    const grants = new QaAgentToolGrants({
      agent,
      baseTools: [],
      grantableTools: [],
      agentLocalTools: new Set(["skill"]),
      descriptors: new Map(),
      logger,
    });
    const skillOptions = {
      agent,
      policy,
      grants,
      logger,
      discovered: new Map(
        (await ctx.skills.list({ scope: agent })).map((skill) => [
          skill.name,
          skill,
        ]),
      ),
    };
    let skillPolicy = installQaSkillPolicy(skillOptions);
    onTestFinished(() => {
      skillPolicy();
      grants.dispose();
    });

    await send(ctx, agent, "first");
    await send(ctx, agent, "unchanged");
    expect(adapter.requests).toHaveLength(2);
    const expected = notes(adapter.requests[0]!);
    expect(expected).toHaveLength(5);
    expect(new Set(expected).size).toBe(5);
    expect(expected).toContain("qa-surface:available-skills");
    expect(expected).not.toContain("dsh-qa-surface:integration-clarifications");
    expect(notes(adapter.requests[1]!)).toEqual(expected);

    await send(ctx, agent, "compact");
    expect(replaced).toBe(true);
    const restoredIndex = timing === "retry" ? 3 : 2;
    expect(adapter.requests).toHaveLength(restoredIndex + 1);
    expect(notes(adapter.requests[restoredIndex]!).sort()).toEqual(
      [...expected].sort(),
    );
    expect(
      agent.session
        .snapshotEvents()
        .filter(
          (event) =>
            event.type === "user/message" &&
            event.data.source.kind === "qa-notes",
        ),
    ).toHaveLength(11);

    ambient.dispose();
    ambient = installNotes();
    skillPolicy();
    skillPolicy = installQaSkillPolicy(skillOptions);
    await send(ctx, agent, "after reload");
    expect(notes(adapter.requests[restoredIndex + 1]!).sort()).toEqual(
      [...expected].sort(),
    );
  },
);
