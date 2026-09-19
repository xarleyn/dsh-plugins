import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { describe, expect, it } from "vitest";
import { createQaToolCatalog } from "../src/qa-tools/catalog.js";
import { QaTools } from "../src/qa-tools/index.js";

type Listener = (...args: never[]) => unknown;

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as PluginLogger;

function context() {
  const listeners = new Map<string, Listener[]>();
  const registered = new Map<string, string[]>();
  const ctx = {
    on: (name: string, listener: Listener) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
      return () => {
        listeners.set(
          name,
          (listeners.get(name) ?? []).filter((item) => item !== listener),
        );
      };
    },
  } as unknown as Context;
  const emit = (name: string, ...args: unknown[]) => {
    for (const listener of listeners.get(name) ?? []) {
      listener(...(args as never[]));
    }
  };
  const sessions = new Set<Agent>();
  const agent = (id: string, preset?: string) => {
    const own: string[] = [];
    const instance = {
      id,
      session: {
        id: `${id}-session`,
        header: preset === undefined ? {} : { agentPreset: preset },
        snapshotEvents: () => [],
      },
      ctx: {
        tools: {
          register: (definition: { name: string }) => {
            own.push(definition.name);
            const all = registered.get(id) ?? [];
            all.push(definition.name);
            registered.set(id, all);
            return () => {
              all.splice(all.indexOf(definition.name), 1);
            };
          },
        },
      },
    } as unknown as Agent;
    sessions.add(instance);
    return instance;
  };
  return { ctx, emit, agent, registered };
}

function qaTools(
  ctx: Context,
  overrides: Partial<ConstructorParameters<typeof QaTools>[1]> = {},
) {
  return new QaTools(ctx, {
    logger: silentLogger,
    dynamicActivation: true,
    activationSkill: "qa-surface",
    activationMode: "all",
    activationPresets: [],
    ...overrides,
  });
}

describe("QaTools integrator", () => {
  it("activates nothing at construction", () => {
    const w = context();
    qaTools(w.ctx);
    expect([...w.registered.values()].flat()).toEqual([]);
  });

  it("lets a managed agent unlock the catalog through the skill result", () => {
    const w = context();
    const tools = qaTools(w.ctx, { activationPresets: ["qa-research"] });
    const agent = w.agent("a", "qa-research");
    w.emit(
      "tools/result",
      { agent, name: "skill" },
      {
        isError: false,
        value: { name: "qa-surface", content: "x" },
      },
    );
    expect(tools.activeToolNames(agent)).toEqual([
      "qa_tools_selfcheck",
      "file_delete",
    ]);
  });

  it("keeps an agent of another preset inactive", () => {
    const w = context();
    const tools = qaTools(w.ctx, { activationPresets: ["qa-research"] });
    const agent = w.agent("a", "code");
    w.emit(
      "tools/result",
      { agent, name: "skill" },
      {
        isError: false,
        value: { name: "qa-surface", content: "x" },
      },
    );
    expect(tools.activeToolNames(agent)).toEqual([]);
    expect(w.registered.get("a") ?? []).toEqual([]);
  });

  it("attaches immediately when dynamic activation is off", () => {
    const w = context();
    const tools = qaTools(w.ctx, { dynamicActivation: false });
    const agent = w.agent("a", "qa-research");
    w.emit("agent/created", { agent });
    expect(tools.activeToolNames(agent)).toEqual([
      "qa_tools_selfcheck",
      "file_delete",
    ]);
  });

  it("stops reporting names once the plugin disposes", () => {
    const w = context();
    const tools = qaTools(w.ctx);
    const agent = w.agent("a");
    w.emit(
      "tools/result",
      { agent, name: "skill" },
      {
        isError: false,
        value: { name: "qa-surface", content: "x" },
      },
    );
    expect(tools.activeToolNames(agent)).toEqual([
      "qa_tools_selfcheck",
      "file_delete",
    ]);
    tools.dispose();
    // The plugin listener is gone; a later skill load no longer activates.
    const fresh = w.agent("b");
    w.emit(
      "tools/result",
      { agent: fresh, name: "skill" },
      {
        isError: false,
        value: { name: "qa-surface", content: "x" },
      },
    );
    expect(tools.activeToolNames(fresh)).toEqual([]);
  });
});

describe("qa_tools_selfcheck", () => {
  const deps = {
    catalogVersion: "7",
    activationMode: "all",
    catalogTools: () => ["qa_tools_selfcheck", "qa_other"],
    activeTools: () => ["qa_tools_selfcheck"],
    skillLoaded: () => true,
  };

  it("reports the calling agent's activation state", async () => {
    const [descriptor] = createQaToolCatalog(deps);
    const result = (await descriptor?.definition.execute({ action: "status" }, {
      agent: { id: "a" },
    } as never)) as Record<string, unknown>;
    expect(result).toEqual({
      catalogVersion: "7",
      activationMode: "all",
      catalogTools: ["qa_tools_selfcheck", "qa_other"],
      activeTools: ["qa_tools_selfcheck"],
      active: true,
      skillLoaded: true,
    });
  });

  it("reports an empty state for an agent-less execution", async () => {
    const [descriptor] = createQaToolCatalog(deps);
    const result = (await descriptor?.definition.execute(
      { action: "catalog" },
      {} as never,
    )) as Record<string, unknown>;
    expect(result.active).toBe(false);
    expect(result.activeTools).toEqual([]);
    expect(result.skillLoaded).toBe(false);
  });
});
