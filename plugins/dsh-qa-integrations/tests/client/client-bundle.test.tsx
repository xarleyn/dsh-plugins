// @vitest-environment jsdom

/**
 * The built artifact, not the sources: this evaluates `lib/client.js` the way
 * the browser does — through `window.__ModuleLoader__`, with a module table
 * that carries React and nothing else — and then drives the surfaces the bundle
 * registered. A bundle that reaches for a module its table does not hold fails
 * here and nowhere else, because every source-level test resolves imports
 * through Vite.
 *
 * The two Plugins panel seats are driven the way the panel drives them: the
 * component the bundle registers, rendered with the face that registration's
 * own `inject` builds. A card that mounts in a source test but not from the
 * bundle — a section the build dropped, a form the seat hands under a name the
 * card does not read — shows up here.
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
import { QA_INTEGRATIONS_ROW_SUMMARY } from "../../src/client/operator-card.js";

function failure(message: string): RemoteFailure {
  return { message } as unknown as RemoteFailure;
}

/** One seat as the bundle registered it, with the face that registration builds. */
interface MountedSlot {
  readonly name: string;
  readonly key?: string;
  readonly component: ComponentType;
  readonly injected?: { readonly settingsForm?: unknown };
}

interface MountedBundle {
  readonly sections: {
    id?: string;
    title?: string;
    component?: ComponentType<{ token: string }>;
  }[];
  readonly slots: MountedSlot[];
}

/**
 * Evaluate the artifact and apply it against a host whose deployment is enabled,
 * serves one Confluence site, and has the operator's namespace live.
 */
async function mountBundle(): Promise<MountedBundle> {
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

  const sections: MountedBundle["sections"] = [];
  const slots: MountedSlot[] = [];
  // Both stores are read through `useSyncExternalStore`, which compares the
  // snapshot by identity: one fresh object per `getSnapshot()` call is an
  // infinite render loop, so the stub hands out the object it was given.
  const sessionSnapshot = { stage: "authed", token: "qa-account-token" };
  // The operator card renders only while its namespace is served, so the
  // artifact drives it against a live form.
  const formSnapshot = {
    status: "ready",
    value: {},
    base: {},
    user: {},
    revision: 1,
    writable: true,
    mode: "host",
  };
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
              deploymentType: "cloud" as const,
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
      getSnapshot: () => sessionSnapshot,
      subscribe: () => () => {},
    },
    configForms: {
      get: () => ({
        getSnapshot: () => formSnapshot,
        subscribe: () => () => {},
        mutate: async () => {},
        set: async () => {},
        unset: async () => {},
      }),
      whileServed: (
        namespaces: readonly string[],
        register: (served: ReadonlySet<string>) => () => void,
      ) => register(new Set(namespaces)),
    },
    slots: {
      inject: (_name: string, factory: () => unknown) => {
        factory();
        return () => {};
      },
      register: (
        options: {
          name: string;
          key?: string;
          id?: string;
          order?: number;
          label?: () => string;
          inject?: () => { readonly settingsForm?: unknown };
        },
        component: ComponentType,
      ) => {
        slots.push({
          name: options.name,
          key: options.key,
          component,
          // The host builds the face when it dispatches the seat; the operator
          // card's settings form is what this entry's own `inject` resolves.
          injected: options.inject?.(),
        });
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
  return { sections, slots };
}

describe("classic browser bundle", () => {
  it("registers under the full package name and mounts the Confluence card", async () => {
    const { sections, slots } = await mountBundle();

    expect(sections.map((section) => section.id)).toEqual(["integrations"]);
    // Two cards leave the bundle: the operator card over the plugin's own entry
    // (first — it does not wait for `describe()`) and the account card, each in
    // the keyed seat the Plugins page gives this bundle.
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({
      name: "plugins.row.config",
      key: "@yadsh/dsh-qa-integrations#qa-integrations",
    });
    expect(slots[0]?.component).toBeDefined();
    expect(slots[1]).toMatchObject({
      name: "plugins.bundle.config",
      key: "@yadsh/dsh-qa-integrations",
    });
    expect(slots[1]?.component).toBeDefined();
    // The section the bundle registered mounts the provider the Host named.
    const Page = sections[0]?.component;
    expect(Page).toBeDefined();
    const rendered = render(
      Page === undefined ? null : <Page token="qa-account-token" />,
    );
    // One configured site means no selector: the card names it, says which
    // product answers there, and asks for the credential alone.
    const card = "qa-integrations-provider-card-confluence";
    expect(await screen.findByLabelText("Atlassian API token")).toBeDefined();
    expect(screen.getByTestId(`${card}-instance-static`).textContent).toContain(
      "Сайт: Company",
    );
    expect(screen.getByTestId(`${card}-deployment`).textContent).toBe(
      "Развёртывание: Atlassian Cloud",
    );
    expect(screen.getByTestId(`${card}-title`).textContent).toBe("Confluence");
    // A refused read is answered with the taxonomy the card renders, so a
    // deployment whose site cannot be reached still explains itself.
    const error = await screen.findByTestId(`${card}-error`);
    expect(error.textContent).toContain("Confluence не нашёл страницу");
    expect(screen.queryByText("Показать токен")).toBeNull();
    rendered.unmount();
  });

  it("renders the operator card the row seat registers, in both of its views", async () => {
    const { slots } = await mountBundle();
    const row = slots.find((slot) => slot.name === "plugins.row.config");
    const RowEntry = row?.component as ComponentType<Record<string, unknown>>;
    expect(row?.key).toBe("@yadsh/dsh-qa-integrations#qa-integrations");
    expect(row?.injected?.settingsForm).toBeDefined();

    // `view: 'page'` is the form seat. The body and a knob inside it come out of
    // the bundle, which is what the source tests cannot show — and nothing that
    // would frame it does: the row-detail page draws the surface, the heading and
    // the disclosure, so a shell class or a toggle of ours here is the second
    // card the panel contract forbids.
    const page = render(<RowEntry view="page" {...row?.injected} />);
    expect(
      page.container.querySelector("[class*='dsh-plugin-card']"),
    ).toBeNull();
    // A `div` root, not the `ul`/`li` a card that owns its shell needs.
    expect(page.container.firstElementChild?.tagName).toBe("DIV");
    expect(page.container.querySelector("div.qai-op__body")).not.toBeNull();
    expect(screen.getByTestId("qa-integrations-enabled")).toBeDefined();
    page.unmount();

    // `view: 'summary'` is the row's description line: the page puts the answer
    // in its own `<p>`, so a sentence and not a card comes out of the bundle.
    const summary = render(<RowEntry view="summary" {...row?.injected} />);
    expect(summary.container.textContent).toBe(QA_INTEGRATIONS_ROW_SUMMARY);
    expect(summary.container.querySelector("li")).toBeNull();
    expect(summary.container.querySelector("input")).toBeNull();
    summary.unmount();
  });

  it("renders the account card the bundle seat registers", async () => {
    const { slots } = await mountBundle();
    const bundle = slots.find((slot) => slot.name === "plugins.bundle.config");
    expect(bundle?.key).toBe("@yadsh/dsh-qa-integrations");
    // The bundle seat is dispatched as `view: 'page'` only and hands no form: the
    // account card reaches the session service, so it renders with no props.
    const BundleCard = bundle?.component as ComponentType;
    const rendered = render(<BundleCard />);
    // Same rule on the bundle seat: the page wraps this view in its own
    // `data-plugin-config` section, so the bundle contributes a body and no frame.
    expect(
      rendered.container.querySelector("[class*='dsh-plugin-card']"),
    ).toBeNull();
    expect(
      rendered.container.querySelector("div.dsh-qa-integrations__body"),
    ).not.toBeNull();
    rendered.unmount();
  });
});
