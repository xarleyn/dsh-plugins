// @vitest-environment jsdom

/**
 * The built artifact, not the sources: this evaluates `lib/client.js` the way
 * the browser does — through `window.__ModuleLoader__`, with a module table
 * that carries React and nothing else — and then drives what the bundle
 * registered. A bundle that reaches for a module its table does not hold fails
 * here and nowhere else, because every source-level test resolves imports
 * through Vite.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { createModuleLoaderStub } from "@yadsh/dsh-test-kit";

const PACKAGE_NAME = "@yadsh/dsh-jev-compaction";

interface ClientExports {
  readonly apply: (ctx: unknown) => () => void;
  readonly inject: readonly string[];
}

async function loadBundle(): Promise<{
  exports: ClientExports;
  requested: string[];
  ids: string[];
}> {
  const source = await readFile(
    join(import.meta.dirname, "..", "..", "lib", "client.js"),
    "utf8",
  );
  const loader = createModuleLoaderStub();
  const sandbox = {
    // The page the bundle mounts itself on: it injects a stylesheet, so the
    // sandbox has the document the browser would have given it.
    window: { ...loader.window, document: globalThis.document },
    document: globalThis.document,
    console,
    setTimeout,
    clearTimeout,
    Promise,
  };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "client.js" }).runInContext(sandbox);

  expect(loader.registrations).toHaveLength(1);
  const registration = loader.registrations[0]!;
  const moduleTable: Readonly<Record<string, unknown>> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
  };
  const requested: string[] = [];
  const exports = registration.factory((name: string) => {
    requested.push(name);
    const module = moduleTable[name];
    if (module === undefined) {
      throw new Error(`client bundle missed the module table: ${name}`);
    }
    return module;
  }) as ClientExports;
  return {
    exports,
    requested: [...new Set(requested)].sort(),
    ids: loader.registrations.map((entry) => entry.id),
  };
}

describe("classic browser bundle", () => {
  it("registers under the full package name", async () => {
    const { ids } = await loadBundle();
    expect(ids).toEqual([PACKAGE_NAME]);
  });

  it("asks the page for React and nothing else", async () => {
    const { requested } = await loadBundle();
    expect(requested).toEqual(["react", "react/jsx-runtime"]);
  });

  it("declares exactly the client services it reads", async () => {
    const { exports } = await loadBundle();
    expect([...exports.inject]).toEqual(["slots", "settingsScope"]);
  });

  it("mounts the card into settings.plugin.item and renders the shell", async () => {
    const { exports } = await loadBundle();
    const registrations: {
      name: string;
      key?: string;
      inject?: () => unknown;
      component?: (props: never) => unknown;
    }[] = [];
    const face = {
      settingsScope: {
        bind: (spec: { namespace: string }) => {
          expect(spec.namespace).toBe("jev-compaction");
          // One stable snapshot object: a fresh one per call would make
          // useSyncExternalStore re-render forever.
          const snapshot = {
            status: "ready",
            value: { enabled: true },
            base: {},
            user: {},
            revision: 0,
            writable: true,
            mode: "host",
          };
          return {
            getSnapshot: () => snapshot,
            subscribe: () => () => {},
            mutate: async () => {},
            set: async () => {},
            unset: async () => {},
          };
        },
      },
      slots: {
        inject: (_name: string, factory: () => unknown) => {
          factory();
          return () => {};
        },
        register: (
          options: Omit<(typeof registrations)[number], "component">,
          component: (props: never) => unknown,
        ) => {
          registrations.push({ ...options, component });
          return () => {};
        },
      },
    };
    exports.apply(face);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.name).toBe("settings.plugin.item");
    expect(registrations[0]!.key).toBe("jev-compaction");

    const scope = registrations[0]!.inject?.();
    expect(scope).toEqual({ scope: expect.anything() });

    const Component = registrations[0]!.component;
    expect(Component).toBeDefined();
    // Rendered as an element, not called as a plain function: a direct call
    // leaves React's hook dispatcher unset.
    render(
      React.createElement(
        Component as unknown as React.ComponentType<Record<string, unknown>>,
        scope as Record<string, unknown>,
      ),
    );
    expect(screen.getByText("Jev Compaction")).toBeTruthy();
    expect(document.querySelector("li.dsh-plugin-card")?.className).toContain(
      "dsh-plugin-card",
    );
  });

  it("injects its stylesheet once, tagged with the package name", async () => {
    const { exports } = await loadBundle();
    exports.apply({
      settingsScope: {
        bind: () => ({
          getSnapshot: () => ({ status: "unavailable" }),
          subscribe: () => () => {},
          mutate: async () => {},
          set: async () => {},
          unset: async () => {},
        }),
      },
      slots: {
        inject: (_name: string, factory: () => unknown) => {
          factory();
          return () => {};
        },
        register: () => () => {},
      },
    });
    const tags = document.querySelectorAll(
      `style[data-plugin="${PACKAGE_NAME}"]`,
    );
    expect(tags).toHaveLength(1);
    expect(tags[0]!.textContent).toContain(".dsh-plugin-card{");
  });
});
