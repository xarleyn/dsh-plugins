import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { Context, Service } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import {
  createQaListSubagentModelsTool,
  createQaSubagentTool,
  type QaSubagentToolsOptions,
  type QaSubagentsFace,
} from "../../src/qa-tools/subagent-tools.js";
import type { QaSessionModelPolicy } from "../../src/access/model-policy.js";
import { createQaToolCatalog } from "../../src/qa-tools/catalog.js";

const standard = { provider: "local", model: "standard" };
const small = { provider: "local", model: "small" };
const restricted = { provider: "private", model: "restricted" };
const catalog = {
  groups: [
    {
      id: "local",
      models: [
        { id: "standard" },
        {
          id: "small",
          reasoning: { efforts: [{ id: "low" }, { id: "high" }] },
        },
      ],
    },
    { id: "private", models: [{ id: "restricted" }] },
  ],
};

function fixture() {
  let policy: QaSessionModelPolicy = {
    pair: standard,
    layer: "subrole",
    allowedModels: [small],
  };
  const modelCatalog = vi.fn(async () => catalog);
  const resolveCallConfig = vi.fn(async () => small);
  const startActivation = vi.fn(async () => ({ childId: "child-1" }));
  const backend = { capabilities: { agentOptions: true, depthLimit: true } };
  const runtime: QaSubagentsFace = {
    getProvider: vi.fn(() => backend),
    resolveMaxDepth: vi.fn(() => 2),
    startActivation,
  };
  const agent = {
    id: "parent-1",
    session: { id: "parent-1" },
    options: standard,
  } as Agent;
  const controller = new AbortController();
  const exec = { agent, signal: controller.signal } as ToolRunContext;
  const options: QaSubagentToolsOptions = {
    ctx: {
      sessionController: { modelCatalog },
      llm: { resolveCallConfig },
    } as unknown as Context,
    policy: vi.fn(() => policy),
    runtime: () => runtime,
  };
  const args = {
    description: "Check report",
    prompt: "Review the supplied demo report.",
    ...small,
  };
  return {
    options,
    exec,
    args,
    runtime,
    backend,
    controller,
    modelCatalog,
    resolveCallConfig,
    startActivation,
    setPolicy(value: QaSessionModelPolicy) {
      policy = value;
    },
    list: () => createQaListSubagentModelsTool(options).execute({}, exec),
    start: (overrides: Record<string, unknown> = {}) =>
      createQaSubagentTool(options).execute({ ...args, ...overrides }, exec),
  };
}

describe("QA subagent model choices", () => {
  it("lists only live grants and their allowed efforts", async () => {
    const f = fixture();
    f.setPolicy({
      pair: standard,
      layer: "account",
      allowedModels: [
        { ...small, reasoningEffort: "low" },
        { provider: "missing", model: "retired" },
      ],
    });
    const value = JSON.parse((await f.list()) as string);
    expect(value.models).toEqual([
      { ...standard, label: "standard", reasoningEfforts: [] },
      { ...small, label: "small", reasoningEfforts: ["low"] },
    ]);
    expect(JSON.stringify(value)).not.toContain("restricted");
  });

  it("rechecks grants after an asynchronous catalog read", async () => {
    const f = fixture();
    f.modelCatalog.mockImplementationOnce(async () => {
      f.setPolicy({ pair: standard, layer: "account", allowedModels: [] });
      return catalog;
    });
    expect(JSON.parse((await f.list()) as string).models).toHaveLength(1);
  });

  it("does not expose the whole catalog when no model policy exists", async () => {
    const f = fixture();
    f.setPolicy({ pair: undefined, layer: undefined });
    expect(JSON.parse((await f.list()) as string)).toEqual({ models: [] });
    await expect(f.start()).rejects.toThrow(/not allowed/u);
    expect(f.startActivation).not.toHaveBeenCalled();
  });

  it("refuses missing agents and callers without attested ownership", async () => {
    const f = fixture();
    await expect(
      createQaListSubagentModelsTool(f.options).execute({}, {
        signal: f.exec.signal,
      } as ToolRunContext),
    ).rejects.toThrow(/QA agent/u);
    vi.spyOn(f.options, "policy").mockImplementation(() => {
      throw new Error("An attested QA conversation is required.");
    });
    await expect(f.list()).rejects.toThrow(/attested/u);
    await expect(f.start()).rejects.toThrow(/attested/u);
    expect(f.modelCatalog).not.toHaveBeenCalled();
    expect(f.startActivation).not.toHaveBeenCalled();
  });

  it("keeps new tools in the activated catalog only when policy wiring is supplied", () => {
    const f = fixture();
    const deps = {
      catalogVersion: "6",
      activationMode: "all",
      catalogTools: () => [],
      activeTools: () => [],
      skillLoaded: () => false,
    };
    const names = (subagents?: QaSubagentToolsOptions) =>
      createQaToolCatalog({
        ...deps,
        ...(subagents === undefined ? {} : { subagents }),
      }).map((entry) => entry.definition.name);
    expect(names()).not.toContain("qa_subagent");
    expect(names(f.options)).toContain("qa_list_subagent_models");
    expect(names(f.options)).toContain("qa_subagent");
  });
});

describe("QA native subagent startup", () => {
  it("starts through real Cordis service wrappers across asynchronous validation", async () => {
    const f = fixture();
    const ctx = new Context();
    class SmokeRuntime extends Service {
      constructor(inner: Context) {
        super(inner, "qaSmokeSubagents");
      }
      getProvider() {
        return f.backend;
      }
      resolveMaxDepth() {
        return 2;
      }
      startActivation(spec: Parameters<QaSubagentsFace["startActivation"]>[0]) {
        return f.runtime.startActivation(spec);
      }
    }
    await ctx.plugin((inner: Context) => {
      new SmokeRuntime(inner);
    });
    const options = {
      ...f.options,
      runtime: () => ctx.get("qaSmokeSubagents") as QaSubagentsFace | undefined,
    };
    try {
      await expect(
        createQaSubagentTool(options).execute(f.args, f.exec),
      ).resolves.toMatchObject({ kind: "activation", subagentId: "child-1" });
      expect(f.startActivation).toHaveBeenCalledOnce();
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it("passes the selected route, signal and depth to a parent-delivered native activation", async () => {
    const f = fixture();
    const parentOptions = { ...f.exec.agent!.options };
    await expect(f.start()).resolves.toEqual({
      kind: "activation",
      subagentId: "child-1",
      ...small,
      reasoningEffort: undefined,
    });
    expect(f.startActivation).toHaveBeenCalledExactlyOnceWith({
      provider: "spawn",
      label: f.args.description,
      delivery: "parent",
      signal: f.exec.signal,
      request: {
        parent: f.exec.agent,
        prompt: [{ type: "text", text: f.args.prompt }],
        agentOptions: { ...small, reasoningEffort: undefined },
        maxDepth: 2,
      },
    });
    expect(f.exec.agent!.options).toEqual(parentOptions);
  });

  it("refuses unauthorized, incomplete and unavailable model selections before starting", async () => {
    const f = fixture();
    for (const args of [
      restricted,
      { provider: undefined },
      { model: "retired" },
    ]) {
      await expect(f.start(args)).rejects.toThrow();
    }
    expect(f.resolveCallConfig).not.toHaveBeenCalled();
    expect(f.startActivation).not.toHaveBeenCalled();
  });

  it("validates effort grants and live model effort support", async () => {
    const f = fixture();
    f.setPolicy({
      pair: standard,
      layer: "account",
      allowedModels: [{ ...small, reasoningEffort: "low" }],
    });
    await expect(f.start({ reasoning_effort: "high" })).rejects.toThrow(
      /not allowed/u,
    );
    await expect(f.start({ reasoning_effort: "unknown" })).rejects.toThrow(
      /reasoning effort/u,
    );
    f.resolveCallConfig.mockResolvedValue({
      ...small,
      reasoningEffort: "low",
    } as typeof small);
    await f.start({ reasoning_effort: "low" });
    expect(f.startActivation).toHaveBeenCalledOnce();
    expect(f.resolveCallConfig).toHaveBeenCalledWith(
      { ...small, reasoningEffort: "low" },
      f.exec.signal,
    );
  });

  it("refuses an adapter default outside the effort policy", async () => {
    const f = fixture();
    f.setPolicy({
      pair: standard,
      layer: "account",
      allowedModels: [{ ...small, reasoningEffort: "low" }],
    });
    f.resolveCallConfig.mockResolvedValue({
      ...small,
      reasoningEffort: "high",
    } as typeof small);
    await expect(f.start({ reasoning_effort: "low" })).rejects.toThrow(
      /not allowed/u,
    );
    expect(f.startActivation).not.toHaveBeenCalled();
  });

  it("refuses grants revoked while the adapter resolves", async () => {
    const f = fixture();
    f.resolveCallConfig.mockImplementationOnce(async () => {
      f.setPolicy({ pair: standard, layer: "account", allowedModels: [] });
      return small;
    });
    await expect(f.start()).rejects.toThrow(/not allowed/u);
    expect(f.startActivation).not.toHaveBeenCalled();
  });

  it("refuses an adapter changing the chosen route to another permitted model", async () => {
    const f = fixture();
    f.resolveCallConfig.mockResolvedValue(standard);
    await expect(f.start()).rejects.toThrow(/different model/u);
    expect(f.startActivation).not.toHaveBeenCalled();
  });

  it("refuses a catalog removal during resolution", async () => {
    const f = fixture();
    f.resolveCallConfig.mockImplementationOnce(async () => {
      f.modelCatalog.mockResolvedValue({ groups: [] });
      return small;
    });
    await expect(f.start()).rejects.toThrow(/unavailable/u);
    expect(f.startActivation).not.toHaveBeenCalled();
  });

  it("refuses cancellation and provider replacement before startup", async () => {
    const f = fixture();
    f.resolveCallConfig.mockImplementationOnce(async () => {
      f.controller.abort();
      return small;
    });
    await expect(f.start()).rejects.toThrow();
    expect(f.startActivation).not.toHaveBeenCalled();
    const g = fixture();
    g.resolveCallConfig.mockImplementationOnce(async () => {
      vi.spyOn(g.runtime, "getProvider").mockReturnValue({
        capabilities: { agentOptions: true, depthLimit: true },
      });
      return small;
    });
    await expect(g.start()).rejects.toThrow(/changed/u);
    expect(g.startActivation).not.toHaveBeenCalled();
  });

  it("refuses missing backends and missing capability support", async () => {
    const f = fixture();
    vi.spyOn(f.runtime, "getProvider").mockReturnValue(undefined);
    await expect(f.start()).rejects.toThrow(/unavailable/u);
    vi.spyOn(f.runtime, "getProvider").mockReturnValue({
      capabilities: { agentOptions: true, depthLimit: false },
    });
    await expect(f.start()).rejects.toThrow(/depth/u);
    expect(f.startActivation).not.toHaveBeenCalled();
  });
});
