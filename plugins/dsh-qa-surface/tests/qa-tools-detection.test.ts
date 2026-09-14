import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { describe, expect, it } from "vitest";
import { QaToolActivationDetector } from "../src/qa-tools/activation-detector.js";
import { QaToolActivationLifecycle } from "../src/qa-tools/lifecycle.js";
import { sessionLoadedSkill } from "../src/qa-tools/durable-marker.js";
import { QaToolActivationManager } from "../src/qa-tools/activation-manager.js";
import type { QaToolDescriptor } from "../src/qa-tools/types.js";

type Listener = (...args: never[]) => unknown;

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as PluginLogger;

function catalog(): QaToolDescriptor[] {
  return [
    {
      definition: {
        name: "qa_probe",
        description: "probe",
        parameters: { type: "object", properties: {} },
        output: {
          schema: { type: "string" },
          render: () => [{ type: "text", text: "ok" }],
        },
        execute: async () => "ok",
      },
    },
  ];
}

function world() {
  const listeners = new Map<string, Listener[]>();
  const registered: string[] = [];
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
  const agent = (id: string, preset?: string) =>
    ({
      id,
      session: {
        id: `${id}-session`,
        header: preset === undefined ? {} : { agentPreset: preset },
        snapshotEvents: () => [],
      },
      ctx: {
        tools: {
          register: (definition: { name: string }) => {
            registered.push(definition.name);
            return () => {
              registered.splice(registered.indexOf(definition.name), 1);
            };
          },
        },
      },
    }) as unknown as Agent;
  return { ctx, emit, agent, registered };
}

function skillResult(name: string) {
  return {
    isError: false,
    value: { name, provider: "filesystem", content: "instructions" },
  };
}

describe("skill-load detector", () => {
  it("activates the catalog on a successful load of the configured skill", () => {
    const w = world();
    const manager = new QaToolActivationManager({
      catalog: catalog(),
      catalogVersion: "1",
      logger: silentLogger,
    });
    new QaToolActivationDetector(w.ctx, {
      manager,
      logger: silentLogger,
      activationSkill: "qa-surface",
      isManagedAgent: () => true,
    });
    const agent = w.agent("a");
    w.emit("tools/result", { agent, name: "skill" }, skillResult("qa-surface"));
    expect(w.registered).toEqual(["qa_probe"]);
    expect(manager.isActive(agent)).toBe(true);
  });

  it("ignores another skill, a failed load, and a different tool", () => {
    const w = world();
    const manager = new QaToolActivationManager({
      catalog: catalog(),
      catalogVersion: "1",
      logger: silentLogger,
    });
    new QaToolActivationDetector(w.ctx, {
      manager,
      logger: silentLogger,
      activationSkill: "qa-surface",
      isManagedAgent: () => true,
    });
    const agent = w.agent("a");
    w.emit(
      "tools/result",
      { agent, name: "skill" },
      skillResult("other-skill"),
    );
    w.emit(
      "tools/result",
      { agent, name: "skill" },
      { isError: true, error: { name: "Error", code: "unknown" } },
    );
    w.emit("tools/result", { agent, name: "read" }, skillResult("qa-surface"));
    w.emit("tools/result", { name: "skill" }, skillResult("qa-surface"));
    expect(w.registered).toEqual([]);
    expect(manager.isActive(agent)).toBe(false);
  });

  it("ignores an agent outside the configured presets", () => {
    const w = world();
    const manager = new QaToolActivationManager({
      catalog: catalog(),
      catalogVersion: "1",
      logger: silentLogger,
    });
    new QaToolActivationDetector(w.ctx, {
      manager,
      logger: silentLogger,
      activationSkill: "qa-surface",
      isManagedAgent: (agent) =>
        agent.session.header.agentPreset === "qa-research",
    });
    const outsider = w.agent("outsider", "code");
    w.emit(
      "tools/result",
      { agent: outsider, name: "skill" },
      skillResult("qa-surface"),
    );
    expect(w.registered).toEqual([]);
    expect(manager.isActive(outsider)).toBe(false);
  });

  it("activates once for repeated loads", () => {
    const w = world();
    const manager = new QaToolActivationManager({
      catalog: catalog(),
      catalogVersion: "1",
      logger: silentLogger,
    });
    new QaToolActivationDetector(w.ctx, {
      manager,
      logger: silentLogger,
      activationSkill: "qa-surface",
      isManagedAgent: () => true,
    });
    const agent = w.agent("a");
    w.emit("tools/result", { agent, name: "skill" }, skillResult("qa-surface"));
    w.emit("tools/result", { agent, name: "skill" }, skillResult("qa-surface"));
    expect(w.registered).toEqual(["qa_probe"]);
  });
});

describe("activation lifecycle", () => {
  it("restores a resumed session whose log shows the skill load", () => {
    const w = world();
    const manager = new QaToolActivationManager({
      catalog: catalog(),
      catalogVersion: "1",
      logger: silentLogger,
    });
    new QaToolActivationLifecycle(w.ctx, {
      manager,
      logger: silentLogger,
      isManagedAgent: () => true,
      dynamicActivation: true,
      activationSkill: "qa-surface",
    });
    const agent = resumedAgent(w.agent("a"), "qa-surface");
    w.emit("agent/created", { agent });
    expect(w.registered).toEqual(["qa_probe"]);
  });

  it("leaves a fresh session inactive until the skill loads", () => {
    const w = world();
    const manager = new QaToolActivationManager({
      catalog: catalog(),
      catalogVersion: "1",
      logger: silentLogger,
    });
    new QaToolActivationLifecycle(w.ctx, {
      manager,
      logger: silentLogger,
      isManagedAgent: () => true,
      dynamicActivation: true,
      activationSkill: "qa-surface",
    });
    const agent = w.agent("fresh");
    w.emit("agent/created", { agent });
    expect(w.registered).toEqual([]);
  });

  it("attaches immediately in the compatibility mode", () => {
    const w = world();
    const manager = new QaToolActivationManager({
      catalog: catalog(),
      catalogVersion: "1",
      logger: silentLogger,
    });
    new QaToolActivationLifecycle(w.ctx, {
      manager,
      logger: silentLogger,
      isManagedAgent: () => true,
      dynamicActivation: false,
      activationSkill: "qa-surface",
    });
    const agent = w.agent("fresh");
    w.emit("agent/created", { agent });
    expect(w.registered).toEqual(["qa_probe"]);
  });

  it("unregisters on disposal", () => {
    const w = world();
    const manager = new QaToolActivationManager({
      catalog: catalog(),
      catalogVersion: "1",
      logger: silentLogger,
    });
    new QaToolActivationLifecycle(w.ctx, {
      manager,
      logger: silentLogger,
      isManagedAgent: () => true,
      dynamicActivation: false,
      activationSkill: "qa-surface",
    });
    const agent = w.agent("fresh");
    w.emit("agent/created", { agent });
    w.emit("agent/disposed", { agent });
    expect(w.registered).toEqual([]);
  });
});

/** One agent whose session log carries a successful load of `skillName`. */
function resumedAgent(base: Agent, skillName: string): Agent {
  const events = [
    {
      type: "tool/call",
      seq: 0,
      data: { callId: "call-1", name: "skill", arguments: "{}" },
    },
    {
      type: "tool/result",
      seq: 1,
      data: {
        message: {
          content: [
            {
              type: "tool_result",
              callId: "call-1",
              isError: false,
              content: [
                {
                  type: "text",
                  text: `<skill_content name="${skillName}">\n<skill_instructions>\nbody\n</skill_instructions>\n</skill_content>`,
                },
              ],
            },
          ],
        },
      },
    },
  ];
  return {
    ...(base as unknown as Record<string, unknown>),
    session: {
      id: `${String(base.id)}-session`,
      header: {},
      snapshotEvents: () => events,
    },
  } as unknown as Agent;
}
describe("durable marker", () => {
  const events = (resultText: string, isError = false) => [
    {
      type: "tool/call",
      data: { callId: "c1", name: "skill", arguments: "{}" },
    },
    {
      type: "tool/result",
      data: {
        message: {
          content: [
            {
              type: "tool_result",
              callId: "c1",
              isError,
              content: [{ type: "text", text: resultText }],
            },
          ],
        },
      },
    },
  ];

  it("finds the loaded skill name in the logged result", () => {
    const session = {
      snapshotEvents: () =>
        events('<skill_content name="qa-surface">\n</skill_content>') as never,
    };
    expect(sessionLoadedSkill(session, "qa-surface")).toBe(true);
    expect(sessionLoadedSkill(session, "another")).toBe(false);
  });

  it("refuses an errored skill result", () => {
    const session = {
      snapshotEvents: () =>
        events(
          '<skill_content name="qa-surface">\n</skill_content>',
          true,
        ) as never,
    };
    expect(sessionLoadedSkill(session, "qa-surface")).toBe(false);
  });

  it("ignores a non-skill call and an unrelated tool result", () => {
    const session = {
      snapshotEvents: () =>
        [
          { type: "tool/call", data: { callId: "c1", name: "read" } },
          {
            type: "tool/result",
            data: {
              message: {
                content: [
                  {
                    type: "tool_result",
                    callId: "c1",
                    isError: false,
                    content: [
                      {
                        type: "text",
                        text: '<skill_content name="qa-surface">',
                      },
                    ],
                  },
                ],
              },
            },
          },
        ] as never,
    };
    expect(sessionLoadedSkill(session, "qa-surface")).toBe(false);
  });

  it("is empty for a session with no events", () => {
    expect(sessionLoadedSkill({ snapshotEvents: () => [] }, "qa-surface")).toBe(
      false,
    );
  });
});
