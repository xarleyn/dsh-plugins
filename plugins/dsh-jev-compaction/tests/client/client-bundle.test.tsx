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

// The expected sentence comes from the source on purpose: the bundle test then
// fails when the compiled answer drifts from the line the card describes.
import { JEV_COMPACTION_ROW_SUMMARY } from "../../src/client/card.js";

const PACKAGE_NAME = "@yadsh/dsh-jev-compaction";

interface ClientExports {
  readonly apply: (ctx: unknown) => () => void;
  readonly inject: readonly string[];
}

async function loadBundle(): Promise<{
  exports: ClientExports;
  requested: string[];
  ids: string[];
  source: string;
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
    source,
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
    expect([...exports.inject]).toEqual(["slots", "configForms"]);
  });

  it("mounts the card into the row's configuration seat as a bare body", async () => {
    const { exports } = await loadBundle();
    const registrations: {
      name: string;
      key?: string;
      inject?: () => unknown;
      component?: (props: never) => unknown;
    }[] = [];
    const face = {
      configForms: {
        get: (entryId: string) => {
          // The profile entry id from cordis.patch.yml is the settings
          // namespace on 0.1.7; a different string edits nothing.
          expect(entryId).toBe("dsh-jev-compaction");
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
    expect(registrations[0]!.name).toBe("plugins.row.config");
    // `<package name>#<row id>`: the row id is the namespace the form above was
    // resolved under, which is what keeps a saved value readable after the move.
    expect(registrations[0]!.key).toBe(
      "@yadsh/dsh-jev-compaction#dsh-jev-compaction",
    );

    const props = registrations[0]!.inject?.();
    expect(props).toEqual({ settingsForm: expect.anything() });

    const Component = registrations[0]!.component;
    expect(Component).toBeDefined();
    // Rendered as an element, not called as a plain function: a direct call
    // leaves React's hook dispatcher unset. `view: 'page'` is what the page asks
    // for when the row's configuration is opened.
    render(
      React.createElement(
        Component as unknown as React.ComponentType<Record<string, unknown>>,
        { ...(props as Record<string, unknown>), view: "page" },
      ),
    );
    // The compiled bundle mounts the settings body straight into the section the
    // page expanded: no disclosure step, and no card markup of ours around it.
    expect(document.querySelector(".jevc-body")).not.toBeNull();
    expect(screen.getByTestId("jevc-enabled")).toBeTruthy();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("names its seat in the registration and carries no shell", async () => {
    const { source } = await loadBundle();
    // The card contract reads the surface off the bundle text, so the seat has to
    // sit in the registration call itself rather than behind a constant.
    expect(source).toMatch(/\{\s*name:\s*"plugins\.row\.config"\s*,\s*key:/u);
    // The Plugins page draws this card's frame, heading and expand control: a
    // shared shell or our chevron inside that frame is a second card (AGENTS.md).
    expect(source).not.toMatch(/dsh-plugin-card/u);
    expect(source).not.toMatch(/m3\.5 5\.25 3\.5 3\.5 3\.5-3\.5/u);
    // The surface the card was moved off is not registered, named, or described.
    expect(source).not.toMatch(
      /settings\.plugins\.tab|settings\.plugin\.item/u,
    );
  });

  it("answers the row's summary fallback from the compiled bundle", async () => {
    const { exports } = await loadBundle();
    const registrations: {
      key?: string;
      inject?: () => unknown;
      component?: unknown;
    }[] = [];
    exports.apply({
      configForms: {
        // The Host section behind this row serves no values, so the body view
        // would answer with the line about an unavailable session: any other
        // text the page sees here can only be the summary answer.
        get: () => ({
          getSnapshot: () => ({ status: "unavailable", value: undefined }),
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
        register: (
          options: Omit<(typeof registrations)[number], "component">,
          component: unknown,
        ) => {
          registrations.push({ ...options, component });
          return () => {};
        },
      },
    });
    // Whether the page ever asks is the Host's inventory to decide; what the
    // bundle owns is that the fallback survived compilation and stays a sentence.
    const Component = registrations[0]!.component as React.ComponentType<
      Record<string, unknown>
    >;
    const { container } = render(
      React.createElement(Component, {
        ...(registrations[0]!.inject?.() as Record<string, unknown>),
        view: "summary",
      }),
    );
    expect(container.textContent).toBe(JEV_COMPACTION_ROW_SUMMARY);
    expect(container.querySelector(".jevc-body")).toBeNull();
    expect(container.querySelector("input, select, button")).toBeNull();
  });

  it("names and describes its row from the locale the Host reads", async () => {
    /*
     * The Plugins page titles this bundle's row and prints its one-liner from the
     * package's exported `locale/en.json`, which it resolves without activating the
     * plugin — the seat hands its registrant no label. Without the file the row is
     * named by its full package specifier, and a description that drifts from the
     * summary answer above lets one row describe two different pages.
     */
    const meta = (
      JSON.parse(
        await readFile(
          join(import.meta.dirname, "..", "..", "locale/en.json"),
          "utf8",
        ),
      ) as { meta: { description: string; title: string } }
    ).meta;
    expect(meta.title).toBe("Jev Compaction");
    expect(meta.description).toBe(JEV_COMPACTION_ROW_SUMMARY);
  });

  it("injects its stylesheet once, tagged with the package name", async () => {
    const { exports } = await loadBundle();
    exports.apply({
      configForms: {
        get: () => ({
          getSnapshot: () => ({ status: "unavailable", value: undefined }),
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
    const css = tags[0]!.textContent ?? "";
    expect(css).toContain(".jevc-body{");
    expect(css).not.toContain(".dsh-plugin-card");
    // Every control this plugin renders dresses its ring from the Host's token
    // pair, each half with a fallback: an undeclared token drops the whole
    // `outline` shorthand, and a hard-coded outline loses to the Host's focus.css.
    const declarationsOf = (selector: string): string => {
      const start = css.indexOf(selector);
      expect(start, `${selector} keeps a rule`).toBeGreaterThanOrEqual(0);
      const open = css.indexOf("{", start);
      return css.slice(open + 1, css.indexOf("}", open));
    };
    for (const selector of [
      ".jevc-input:focus-visible",
      ".jevc-toggle:focus-visible",
      ".jevc-tag-remove:focus-visible",
      ".jevc-button:focus-visible",
      ".jevc-details>summary:focus-visible",
    ]) {
      const declarations = declarationsOf(selector);
      expect(declarations).toContain("var(--dsw-focus-ring-width, 2px)");
      expect(declarations).toContain(
        "var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))",
      );
    }
  });
});
