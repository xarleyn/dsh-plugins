/**
 * Client activation: the entry binds the plugin's settings namespace, registers
 * the native card, and reaches the account-scoped page through the Remote
 * gateway.
 *
 * The Remote half of this file runs against a **real Cordis application**, and
 * that is the point of it. On a hand-written context `ctx.remote` is simply
 * `undefined`, which is why this file stayed green while the browser kept dying:
 * on a real context inside a plugin fiber the same read throws
 * `cannot get property "remote" without inject`, and the loader turns that into
 * `failed to apply loader entry (@yadsh/dsh-openviking-memory)` — the whole
 * plugin tree goes with it. Only a real fiber can tell the two apart.
 */

import { Context, Service } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apply, inject as CLIENT_INJECT } from "../src/client/index.js";

/** Every namespace handed to the account-scoped page, in order. */
const sectionFaces = vi.hoisted(() => [] as unknown[]);

// The page's wiring is observed at its seam: `createMemorySettingsSection` is
// what receives the mounted namespace, so recording its argument is how a test
// can tell a namespace from `undefined`.
vi.mock("../src/client/qa-settings.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/client/qa-settings.js")>();
  return {
    ...actual,
    createMemorySettingsSection: (remote: unknown) => {
      sectionFaces.push(remote);
      return actual.createMemorySettingsSection(remote as never);
    },
  };
});

interface CardRegistration {
  readonly name: string;
  readonly key: string;
}

interface SectionRegistration {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly component: unknown;
}

interface StyleStub {
  readonly dataset: Record<string, string>;
  textContent: string;
  readonly remove: () => void;
}

/** The browser APIs the entry touches, with the stylesheet it creates. */
function stubDocument(): StyleStub[] {
  const styles: StyleStub[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const style: StyleStub = {
        dataset: {},
        textContent: "",
        remove: vi.fn(),
      };
      styles.push(style);
      return style;
    },
    head: { append: vi.fn(), appendChild: vi.fn() },
    querySelector: vi.fn(() => null),
  });
  return styles;
}

/** One mounted namespace: the account-scoped RPCs the settings page calls. */
class FakeNamespace extends Service {
  readonly calls: string[] = [];

  constructor(ctx: Context) {
    super(ctx, "remote.openvikingMemory");
  }

  userMemorySettings(token: string): unknown {
    this.calls.push(`userMemorySettings:${token}`);
    return { autoInject: null, profile: null, recall: null };
  }

  setUserMemorySettings(token: string, patch: unknown): unknown {
    this.calls.push(`setUserMemorySettings:${token}`);
    return patch;
  }

  resetUserMemorySettings(token: string): unknown {
    this.calls.push(`resetUserMemorySettings:${token}`);
    return {};
  }
}

/**
 * The gateway client's contract, at the size this bundle sees it: `$mount`
 * installs `remote.<namespace>` as a service of its own, which is why the
 * namespace is reachable only from a context that injected it.
 */
class FakeGateway extends Service {
  readonly contributions: unknown[] = [];
  /** The namespaces this gateway has mounted, in mount order. */
  readonly namespaces: FakeNamespace[] = [];

  constructor(ctx: Context) {
    super(ctx, "remote");
  }

  async $mount(contribution: unknown): Promise<() => Promise<void>> {
    this.contributions.push(contribution);
    const fiber = this.ctx.plugin({
      name: "remote.openvikingMemory",
      // A block body on purpose: an `apply` that returns a value hands it back
      // as its disposer, and a Service is not one.
      apply: (ctx: Context) => {
        this.namespaces.push(new FakeNamespace(ctx));
      },
    });
    await fiber.await();
    return async () => {
      await fiber.dispose();
    };
  }
}

/**
 * The browser assembly, at the size this bundle sees it: a real Cordis root
 * with the two services the face declares, and a gateway the test can mount
 * before or after the entry.
 */
function createClientApp() {
  const root = new Context();
  const cards: CardRegistration[] = [];
  const sections: SectionRegistration[] = [];
  const styles = stubDocument();
  let gateway: FakeGateway | undefined;

  root.provide("settingsScope", { bind: () => ({}) });
  root.provide("qaUserSettingsSections", {
    register: (section: SectionRegistration) => {
      sections.push(section);
      return vi.fn();
    },
  });
  root.provide("slots", {
    inject: (_name: string, callback: () => unknown) => callback(),
    register: (options: CardRegistration) => {
      cards.push(options);
      return vi.fn();
    },
  });

  return {
    root,
    cards,
    sections,
    styles,
    /** The namespace the gateway mounted, once it did. */
    get namespace(): FakeNamespace | undefined {
      return gateway?.namespaces[0];
    },
    /** Mount the gateway client, the way a browser assembly does. */
    mountGateway(): void {
      root.plugin({
        name: "gateway",
        apply: (ctx: Context) => {
          gateway = new FakeGateway(ctx);
        },
      });
    },
    /** Apply the entry the way the client loader does: one plugin, its own face. */
    applyEntry() {
      return root.plugin({
        name: "dsh-openviking-memory",
        inject: [...CLIENT_INJECT],
        apply,
      });
    },
  };
}

describe("client activation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sectionFaces.length = 0;
  });

  it("binds the namespace and registers the native card", () => {
    const scope = {};
    let cardFace: (() => unknown) | undefined;

    const disposeSlot = vi.fn();
    const ctx = {
      settingsScope: { bind: vi.fn(() => scope) },
      // A page with no gateway at all: the entry still has to register the
      // card, so the waiting fiber it opens is a no-op to dispose.
      inject: vi.fn(() => ({ dispose: vi.fn() })),
      slots: {
        inject: vi.fn((_name: string, callback: () => unknown) => callback()),
        register: vi.fn((options: { inject: () => unknown }) => {
          cardFace = options.inject;
          return disposeSlot;
        }),
      },
    };

    const style: StyleStub = {
      dataset: {},
      textContent: "",
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => style),
      head: { appendChild: vi.fn() },
      querySelector: vi.fn(() => null),
    });

    const dispose = apply(ctx as never);
    const face = cardFace?.() as { scope: unknown };

    expect(ctx.settingsScope.bind).toHaveBeenCalledWith({
      namespace: "dsh-openviking-memory",
    });
    expect(face.scope).toBe(scope);
    expect(ctx.slots.register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "settings.plugin.item",
        key: "dsh-openviking-memory",
      }),
      expect.anything(),
    );
    // Canonical shell travels with the card.
    expect(style.textContent).toContain(".dsh-plugin-card{");
    expect(style.dataset.plugin).toBe("@yadsh/dsh-openviking-memory");

    dispose();
    expect(disposeSlot).toHaveBeenCalledOnce();
    expect(style.remove).toHaveBeenCalledOnce();
  });

  it("renders no card when the settings binder is unavailable", () => {
    const dispose = apply({ slots: {} } as never);
    expect(dispose).toBeTypeOf("function");
    expect(() => dispose()).not.toThrow();
  });

  it("applies on a loader fiber while the Remote gateway is still absent", async () => {
    const app = createClientApp();
    const fiber = app.applyEntry();

    // `await` rethrows whatever the loader logged: before the fix this was
    // `cannot get property "remote" without inject`, and the entry — the card
    // included — was gone from the UI.
    await fiber.await();

    expect(app.cards).toHaveLength(1);
    expect(app.sections).toHaveLength(0);
  });

  it("registers the account-scoped page once the gateway mounts the namespace", async () => {
    const app = createClientApp();
    const fiber = app.applyEntry();
    await fiber.await();

    // No gateway yet: the native card is there, the account page is not.
    expect(app.cards).toHaveLength(1);
    expect(app.sections).toHaveLength(0);

    app.mountGateway();
    await vi.waitFor(() => {
      expect(app.sections).toHaveLength(1);
    });

    expect(app.sections[0]?.id).toBe("openviking-memory");
    expect(app.sections[0]?.title).toBe("Память");
    expect(app.sections[0]?.order).toBe(45);

    // The page is wired to the namespace the gateway actually mounted, not to
    // an unresolved property of the gateway: the face it holds reaches the very
    // service the mount installed, own state and all.
    expect(sectionFaces).toHaveLength(1);
    const face = sectionFaces[0] as FakeNamespace;
    face.userMemorySettings("token");
    expect(app.namespace?.calls).toEqual(["userMemorySettings:token"]);

    const qaStyle = app.styles.find(
      (style) => style.dataset.dshOpenvikingMemory === "qa-settings",
    );
    expect(qaStyle?.textContent).toContain(".ovm-qa__toggle");

    // Disposing the entry unmounts the contribution and the page with it.
    await fiber.dispose();
    expect(qaStyle?.remove).toHaveBeenCalled();
  });
});
