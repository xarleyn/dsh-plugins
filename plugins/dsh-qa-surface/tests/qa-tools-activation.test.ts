import { describe, expect, it, vi } from "vitest";
import { QaToolActivationManager } from "../src/qa-tools/activation-manager.js";
import type { QaToolDescriptor } from "../src/qa-tools/types.js";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";

function logger(): PluginLogger & { entries: Record<string, unknown>[] } {
  const entries: Record<string, unknown>[] = [];
  const record =
    (level: string) => (event: string, data?: Record<string, unknown>) => {
      entries.push({ level, event, ...data });
    };
  return {
    entries,
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  } as unknown as PluginLogger & { entries: Record<string, unknown>[] };
}

function tool(name: string): QaToolDescriptor {
  return {
    definition: {
      name,
      description: name,
      parameters: { type: "object", properties: {} },
      output: {
        schema: { type: "string" },
        render: () => [{ type: "text", text: name }],
      },
      execute: async () => name,
    },
  };
}

/**
 * A live agent with a tool registry that behaves like the real one: registering
 * a name twice in the same scope fails, and each disposer removes exactly one
 * registration.
 */
function fakeAgent(id: string, failOn?: string) {
  const registered: string[] = [];
  const disposed: string[] = [];
  const agent = {
    id,
    session: { id: `${id}-session` },
    ctx: {
      tools: {
        register: (definition: { name: string }) => {
          if (definition.name === failOn) {
            throw new Error(`register failed for ${definition.name}`);
          }
          if (registered.includes(definition.name)) {
            throw new Error(`duplicate tool "${definition.name}"`);
          }
          registered.push(definition.name);
          return () => {
            disposed.push(definition.name);
            registered.splice(registered.indexOf(definition.name), 1);
          };
        },
      },
    },
  };
  return {
    agent: agent as unknown as Agent,
    registered,
    disposed,
  };
}

function manager(catalog: QaToolDescriptor[]) {
  const log = logger();
  return {
    log,
    instance: new QaToolActivationManager({
      catalog,
      catalogVersion: "1",
      logger: log,
    }),
  };
}

describe("QA tool activation manager", () => {
  it("registers the whole catalog once", () => {
    const world = fakeAgent("a");
    const { instance } = manager([tool("qa_one"), tool("qa_two")]);
    expect(instance.activate(world.agent, "skill")).toEqual({
      status: "activated",
      count: 2,
    });
    expect(world.registered).toEqual(["qa_one", "qa_two"]);
    expect(instance.isActive(world.agent)).toBe(true);
    expect(instance.activeToolNames(world.agent)).toEqual(["qa_one", "qa_two"]);
  });

  it("is idempotent across repeated activations", () => {
    const world = fakeAgent("a");
    const { instance } = manager([tool("qa_one")]);
    instance.activate(world.agent, "skill");
    expect(instance.activate(world.agent, "skill")).toEqual({
      status: "already-active",
    });
    expect(world.registered).toEqual(["qa_one"]);
  });

  it("rolls every earlier registration back when one tool fails", () => {
    const world = fakeAgent("a", "qa_two");
    const { instance, log } = manager([
      tool("qa_one"),
      tool("qa_two"),
      tool("qa_three"),
    ]);
    const result = instance.activate(world.agent, "skill");
    expect(result.status).toBe("failed");
    expect(world.registered).toEqual([]);
    expect(world.disposed).toEqual(["qa_one"]);
    expect(instance.isActive(world.agent)).toBe(false);
    expect(instance.activeToolNames(world.agent)).toEqual([]);
    expect(
      log.entries.some(
        (entry) =>
          entry.event === "qa-tools.activation-failed" &&
          entry.tool === "qa_two",
      ),
    ).toBe(true);
  });

  it("rejects a duplicate-name catalog before registering anything", () => {
    const world = fakeAgent("a");
    const { instance } = manager([tool("qa_one"), tool("qa_one")]);
    expect(instance.activate(world.agent, "skill").status).toBe("failed");
    expect(world.registered).toEqual([]);
  });

  it("unregisters in reverse order and is safe to dispose twice", () => {
    const world = fakeAgent("a");
    const { instance } = manager([tool("qa_one"), tool("qa_two")]);
    instance.activate(world.agent, "immediate");
    instance.disposeAgent(world.agent);
    instance.disposeAgent(world.agent);
    expect(world.disposed).toEqual(["qa_two", "qa_one"]);
    expect(world.registered).toEqual([]);
    expect(instance.isActive(world.agent)).toBe(false);
  });

  it("keeps two agents' activations independent", () => {
    const a = fakeAgent("a");
    const b = fakeAgent("b");
    const { instance } = manager([tool("qa_one")]);
    instance.activate(a.agent, "skill");
    expect(instance.isActive(a.agent)).toBe(true);
    expect(instance.isActive(b.agent)).toBe(false);
    expect(instance.activeToolNames(b.agent)).toEqual([]);
    instance.disposeAgent(a.agent);
    expect(instance.isActive(b.agent)).toBe(false);
    instance.activate(b.agent, "skill");
    expect(b.registered).toEqual(["qa_one"]);
  });

  it("contains a throwing disposer and still clears the rest", () => {
    const world = fakeAgent("a");
    const { instance, log } = manager([tool("qa_one"), tool("qa_two")]);
    const original = world.agent.ctx.tools.register;
    let calls = 0;
    // The second disposer blows up: rollback must contain it and still unwind
    // the first registration.
    world.agent.ctx.tools.register = ((definition: ToolDefinition) => {
      const dispose = original(definition);
      calls += 1;
      return calls === 2
        ? () => {
            dispose();
            throw new Error("dispose failed");
          }
        : dispose;
    }) as typeof original;
    instance.activate(world.agent, "skill");
    instance.disposeAgent(world.agent);
    expect(world.registered).toEqual([]);
    expect(
      log.entries.some((entry) => entry.event === "qa-tools.dispose-failed"),
    ).toBe(true);
  });

  it("does not register when the catalog is empty", () => {
    const world = fakeAgent("a");
    const { instance } = manager([]);
    const register = vi.spyOn(world.agent.ctx.tools, "register");
    expect(instance.activate(world.agent, "immediate")).toEqual({
      status: "activated",
      count: 0,
    });
    expect(register).not.toHaveBeenCalled();
  });
});
