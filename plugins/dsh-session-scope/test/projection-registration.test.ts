import { describe, expect, test } from "vitest";

import { apply } from "../src/index.js";

interface ProjectionDefinition {
  key: string;
  stateSchema?: { parse(value: unknown): unknown };
  wire?: {
    viewSchema: { parse(value: unknown): unknown };
    view(state: Record<string, unknown>): unknown;
  };
}

function registeredProjections(): ProjectionDefinition[] {
  const definitions: ProjectionDefinition[] = [];
  const sandboxPolicy = {
    workspaceRoot: "/workspace",
    resolve: () => ({ mode: "workspace-write", workspaceRoot: "/workspace" }),
  };
  const ctx = {
    sandboxPolicy,
    get(name: string) {
      return name === "sandboxPolicy" ? sandboxPolicy : undefined;
    },
    on: () => () => {},
    inject(dependencies: string[], callback: (child: unknown) => void) {
      if (dependencies.length === 1 && dependencies[0] === "sessionProjections") {
        callback({
          sessionProjections: {
            register(definition: ProjectionDefinition) {
              definitions.push(definition);
              return () => {};
            },
          },
        });
      }
    },
  };

  const dispose = apply(ctx);
  dispose();
  return definitions;
}

describe("session projection registration", () => {
  test("uses the current state and wire projection contract", () => {
    const definitions = registeredProjections();

    expect(definitions.map(({ key }) => key)).toEqual(["session-scope", "workspace-scope"]);
    for (const definition of definitions) {
      expect(definition.stateSchema?.parse).toBeTypeOf("function");
      expect(definition.wire?.viewSchema.parse).toBeTypeOf("function");
      expect(definition.wire?.view).toBeTypeOf("function");
    }
  });

  test("publishes the session scope without its migration-only marker", () => {
    const definition = registeredProjections().find(({ key }) => key === "session-scope");
    const state = {
      mode: "focused",
      workspaceRoot: "/workspace",
      roots: ["/workspace/apps"],
      navigationRoots: ["/workspace"],
      hasSnapshot: true,
    };

    const view = definition?.wire?.view(state);
    expect(view).toEqual({
      mode: "focused",
      workspaceRoot: "/workspace",
      roots: ["/workspace/apps"],
      navigationRoots: ["/workspace"],
      capabilities: {
        focused: true,
        isolated: false,
        isolatedBackend: null,
      },
    });
    expect(definition?.wire?.viewSchema.parse(view)).toEqual(view);
  });
});
