import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, test } from "vitest";

interface Registration {
  options: {
    name: string;
    inject?: (sessionId: string) => Record<string, unknown>;
  };
  component: unknown;
}

interface ClientHarness {
  React?: Record<string, unknown>;
  ReactDOM?: Record<string, unknown>;
  document?: Record<string, unknown>;
  remote?: Record<string, unknown>;
}

function registrationsFor(declared: ReadonlySet<string>, harness: ClientHarness = {}): Registration[] {
  let definition: { factory: (require: (id: string) => unknown) => { apply: (ctx: unknown) => void } } | undefined;
  const registrations: Registration[] = [];
  const slots = {
    inject(name: string, callback: () => (() => void)): () => void {
      return declared.has(name) ? callback() : () => {};
    },
    register(options: Registration["options"], component: unknown): () => void {
      registrations.push({ options, component });
      return () => {};
    },
  };
  const sessions = {
    list: {
      getSnapshot: () => ({ byId: { session: { cwd: "/workspace" } } }),
    },
  };
  const document = harness.document ?? {
    createElement: () => ({ textContent: "", parentNode: null }),
    head: { appendChild: () => {} },
  };
  const source = readFileSync(new URL("../src/client.ts", import.meta.url), "utf8");
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: (value: typeof definition) => { definition = value; } } },
    document,
    navigator: { language: "en" },
    console,
  });
  if (definition === undefined) throw new Error("client module did not register");
  const plugin = definition.factory((id) => {
    if (id === "react") return harness.React ?? {};
    if (id === "react-dom") return harness.ReactDOM ?? {};
    throw new Error(`unexpected module ${id}`);
  });
  plugin.apply({
    get: (name: string) => name === "slots"
      ? slots
      : name === "sessions" ? sessions : name === "remote" ? harness.remote : undefined,
    effect: (callback: () => unknown) => callback(),
  });
  return registrations;
}

describe("client scope placement", () => {
  test("uses projection and host RPC reads instead of durable scope commands", () => {
    const source = readFileSync(new URL("../src/client.ts", import.meta.url), "utf8");

    expect(source).toContain("useProjection('session-scope')");
    expect(source).toContain("ctx.inject(['remote.sessionScope']");
    expect(source).toContain("scopeRemoteFace.list(sessionId, path)");
    expect(source).not.toMatch(/\/scope (?:capabilities|show|list)/);
  });

  test("mounts a dedicated non-durable sessionScope/list Remote", () => {
    let contribution: Record<string, unknown> | undefined;
    registrationsFor(new Set(["conversation.input.left"]), {
      remote: {
        $mount(value: Record<string, unknown>) {
          contribution = value;
          return Promise.resolve(() => {});
        },
      },
    });

    expect(contribution).toMatchObject({
      package: "@yadsh/dsh-session-scope",
      descriptors: [expect.objectContaining({
        service: "sessionScopeRead",
        namespace: "sessionScope",
        method: "list",
        invocation: { kind: "direct" },
      })],
    });
  });

  test("uses only the existing composer seat and resolves its workspace root", () => {
    const registrations = registrationsFor(new Set(["conversation.input.left"]));
    expect(registrations.map(({ options }) => options.name)).toEqual([
      "conversation.input.left",
    ]);
    expect(registrations[0]?.options.inject?.("session")).toEqual({
      workspaceRoot: "/workspace",
    });
  });

  test("does not depend on a new or private hero slot", () => {
    const registrations = registrationsFor(new Set(["conversation.hero.scope"]));
    expect(registrations).toHaveLength(0);
  });

  test("portals the blank-session button immediately after Workspace", () => {
    const states: unknown[] = [];
    const refs: Array<{ current: unknown }> = [];
    let stateCursor = 0;
    let refCursor = 0;
    let layoutEffect: (() => unknown) | undefined;
    const portals: Array<{ child: unknown; target: unknown }> = [];
    const preset = {};
    const inserted: Array<{ node: unknown; before: unknown }> = [];
    const row = {
      insertBefore: (node: unknown, before: unknown) => { inserted.push({ node, before }); },
      removeChild: () => {},
    };
    const workspace = { parentNode: row, nextSibling: preset };
    const heroRoot = {
      querySelector: (selector: string) => selector === 'button[aria-haspopup="menu"]' ? workspace : null,
    };
    const probe = {
      closest: (selector: string) => selector === '[data-phase="hero"]' ? heroRoot : null,
    };
    const mount = {
      className: "",
      parentNode: row,
      attributes: new Map<string, string>(),
      setAttribute(name: string, value: string) { this.attributes.set(name, value); },
    };
    const React = {
      Fragment: Symbol("Fragment"),
      useState(initial: unknown) {
        const index = stateCursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (value: unknown) => { states[index] = value; }];
      },
      useRef(initial: unknown) {
        const index = refCursor++;
        if (!(index in refs)) refs[index] = { current: initial };
        return refs[index];
      },
      useLayoutEffect(callback: () => unknown) { layoutEffect = callback; },
      createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
        if (type === "span" && props?.ref !== undefined) {
          (props.ref as { current: unknown }).current = probe;
        }
        return { type, props, children };
      },
    };
    const document = {
      createElement: (tag: string) => tag === "span"
        ? mount
        : { textContent: "", parentNode: null },
      head: { appendChild: () => {} },
    };
    const registrations = registrationsFor(new Set(["conversation.input.left"]), {
      React,
      ReactDOM: {
        createPortal(child: unknown, target: unknown) {
          portals.push({ child, target });
          return { child, target };
        },
      },
      document,
    });
    const ScopeButton = registrations[0]?.component as (props: Record<string, unknown>) => unknown;
    const props = {
      useProjection: () => ({ mode: "full", roots: [], workspaceRoot: "/workspace" }),
      sessionId: "session",
      session: { composerPhase: "blank" },
      workspaceRoot: "/workspace",
    };

    ScopeButton(props);
    expect(layoutEffect).toBeTypeOf("function");
    layoutEffect?.();
    stateCursor = 0;
    refCursor = 0;
    ScopeButton(props);

    expect(inserted).toEqual([{ node: mount, before: preset }]);
    expect(mount.className).toBe("wss-heroMount");
    expect(mount.attributes.get("data-session-scope-hero-mount")).toBe("");
    expect(portals).toHaveLength(1);
    expect(portals[0]?.target).toBe(mount);
  });
});
