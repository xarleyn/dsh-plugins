// @vitest-environment jsdom

/**
 * The built artifact, not the sources: this evaluates `lib/client.js` the way
 * the browser does — through `window.__ModuleLoader__`, with a module table
 * that carries React and nothing else — and then drives the surface the bundle
 * registered. A bundle that reaches for a module its table does not hold fails
 * here and nowhere else, because every source-level test resolves imports
 * through Vite.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import type { ComponentType } from "react";
import { render, screen } from "@testing-library/react";
import type { RemoteFailure } from "@deepseek-ai/dsh-typert-protocol";
import { createModuleLoaderStub } from "@yadsh/dsh-test-kit";

function failure(message: string): RemoteFailure {
  return { message } as unknown as RemoteFailure;
}

describe("classic browser bundle", () => {
  it("registers under the full package name and mounts the Confluence card", async () => {
    const source = await readFile(
      join(import.meta.dirname, "..", "lib", "client.js"),
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
    expect(loader.registrations[0]?.id).toBe("@yadsh/dsh-qa-integrations");

    // Anything the bundle needs beyond React has to be inlined at build time.
    const moduleTable: Readonly<Record<string, unknown>> = {
      react: React,
      "react/jsx-runtime": jsxRuntime,
    };
    const requested: string[] = [];
    const exports = loader.registrations[0]?.factory((name: string) => {
      requested.push(name);
      const module = moduleTable[name];
      if (module === undefined) {
        throw new Error(`client bundle missed the module table: ${name}`);
      }
      return module;
    }) as {
      apply: (ctx: unknown) => Promise<void>;
      inject: readonly string[];
    };
    expect([...new Set(requested)].sort()).toEqual([
      "react",
      "react/jsx-runtime",
    ]);
    expect(exports.inject).toContain("qaUserSession");

    const sections: {
      id?: string;
      title?: string;
      component?: ComponentType<{ token: string }>;
    }[] = [];
    const slots: { name: string; key?: string }[] = [];
    const face = {
      remote: {
        $mount: async () => async () => {},
        qaIntegrations: {
          describe: async () => ({
            ok: true as const,
            value: { enabled: true, providers: ["confluence"] },
          }),
          confluenceSites: async () => ({
            ok: true as const,
            value: [
              {
                id: "company",
                label: "Company",
                baseUrl: "https://company.atlassian.net",
              },
            ],
          }),
          getConfluence: async () => ({
            ok: false as const,
            error: failure(
              "Integration request failed (reason: ResourceNotFound)",
            ),
          }),
        },
      },
      qaUserSettingsSections: {
        register: (section: { id?: string; title?: string }) => {
          sections.push(section);
          return () => {};
        },
      },
      qaUserSession: {
        getSnapshot: () => ({ stage: "authed", token: "qa-account-token" }),
        subscribe: () => () => {},
      },
      slots: {
        inject: (_name: string, factory: () => unknown) => {
          factory();
          return () => {};
        },
        register: (options: { name: string; key?: string }) => {
          slots.push(options);
          return () => {};
        },
      },
      effect: (factory: () => unknown) => {
        const remove = factory();
        return () => {
          if (typeof remove === "function") (remove as () => void)();
        };
      },
    };
    await exports.apply({
      remote: face.remote,
      inject: (_deps: unknown, callback: (injected: unknown) => unknown) => {
        callback(face);
      },
      effect: face.effect,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sections.map((section) => section.id)).toEqual(["integrations"]);
    expect(slots).toEqual([
      { name: "settings.plugin.item", key: "qa-integrations" },
    ]);
    // The section the bundle registered mounts the provider the Host named.
    const Page = sections[0]?.component;
    expect(Page).toBeDefined();
    const rendered = render(
      Page === undefined ? null : <Page token="qa-account-token" />,
    );
    // One configured site means no selector: the card names it and asks for the
    // credential alone.
    expect(await screen.findByLabelText("Atlassian API token")).toBeDefined();
    expect(screen.getByText("Сайт: Company")).toBeDefined();
    expect(screen.getByText("Confluence")).toBeDefined();
    // A refused read is answered with the taxonomy the card renders, so a
    // deployment whose site cannot be reached still explains itself.
    await screen.findByText(/Confluence не нашёл страницу/u);
    expect(screen.queryByText("Показать токен")).toBeNull();
    rendered.unmount();
  });
});
