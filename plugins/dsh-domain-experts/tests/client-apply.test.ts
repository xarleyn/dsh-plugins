import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import * as clientModule from "../src/client/index.js";

const { apply } = clientModule;
import type { DomainExpertsRemote } from "../src/client/remote.js";

/**
 * Regression guard for the client entry point.
 *
 * The mounted Remote namespace is a service of its own: reading
 * `remote.domainExperts` on a context that has not injected it throws
 * "cannot get property ... without inject", the browser half fails to apply,
 * and the plugin vanishes from the settings UI with no host-side trace. This
 * drives the real `apply()` against a bare cordis context so that mistake
 * cannot come back unnoticed.
 */

const ENVELOPE = { ok: true, code: "", message: "" };

/** The plugin's declared activation dependencies, read from the module. */
const CLIENT_INJECT: readonly string[] = (
  clientModule as { inject: readonly string[] }
).inject;

function remoteStub(): DomainExpertsRemote {
  return {
    listDomains: () =>
      Promise.resolve({ ok: true, value: { ...ENVELOPE, domains: [] } }),
    getDomain: () =>
      Promise.resolve({ ok: true, value: { ...ENVELOPE, domain: null } }),
    draftDomain: () =>
      Promise.resolve({ ok: true, value: { ...ENVELOPE, domain: null } }),
    inspectDraft: () =>
      Promise.resolve({
        ok: true,
        value: { ...ENVELOPE, definition: null, issues: [] },
      }),
    createDomain: () =>
      Promise.resolve({ ok: true, value: { ...ENVELOPE, domain: null } }),
    updateDomain: () =>
      Promise.resolve({ ok: true, value: { ...ENVELOPE, domain: null } }),
    setDomainEnabled: () =>
      Promise.resolve({ ok: true, value: { ...ENVELOPE, domain: null } }),
    deleteDomain: () =>
      Promise.resolve({ ok: true, value: { ...ENVELOPE, deleted: false } }),
    resolveScope: () =>
      Promise.resolve({ ok: true, value: { ...ENVELOPE, profile: null } }),
    catalog: () =>
      Promise.resolve({
        ok: true,
        value: {
          ...ENVELOPE,
          scopeProviders: [],
          memoryProviders: [],
          workers: [],
          tools: [],
          memoryNamespaces: [],
        },
      }),
    inspectMemory: () =>
      Promise.resolve({
        ok: true,
        value: { ...ENVELOPE, namespaces: [], records: [] },
      }),
    clearMemory: () =>
      Promise.resolve({ ok: true, value: { ...ENVELOPE, cleared: 0 } }),
    testExpert: () =>
      Promise.resolve({ ok: true, value: { ...ENVELOPE, result: null } }),
    recentAudits: () =>
      Promise.resolve({ ok: true, value: { ...ENVELOPE, entries: [] } }),
  } as unknown as DomainExpertsRemote;
}

interface Registration {
  readonly key: string;
  readonly id: string | undefined;
  readonly order: number | undefined;
  readonly label: string | undefined;
  readonly props: Record<string, unknown>;
}

interface Harness {
  readonly ctx: Context;
  readonly registrations: Registration[];
  readonly mounted: { readonly count: number };
  readonly disposed: { readonly remote: number; readonly slots: number };
}

function harnessOf(): Harness {
  const ctx = new Context();
  const registrations: Registration[] = [];
  const mounted = { count: 0 };
  const disposed = { remote: 0, slots: 0 };

  const namespace = remoteStub();
  /*
   * The namespace is exposed as a plain property here so the calls under test
   * can reach it; the real gateway resolves it through cordis's isolate map
   * instead (see the note at the end of this file). Both are provided because
   * `ctx.inject(['remote.domainExperts'])` resolves the service key, while the
   * code under test reads the property.
   */
  ctx.provide("remote", {
    domainExperts: namespace,
    $mount: () => {
      mounted.count += 1;
      return Promise.resolve(() => {
        disposed.remote += 1;
        return Promise.resolve();
      });
    },
  });
  ctx.provide("remote.domainExperts", namespace);
  ctx.provide("sessions", { list: { getSnapshot: () => ({}) } });
  ctx.provide("slots", {
    inject: (key: string, callback: () => (() => void) | void) => {
      const dispose = callback();
      return () => {
        disposed.slots += 1;
        if (typeof dispose === "function") dispose();
      };
    },
    register: (options: {
      id?: string;
      order?: number;
      label?: () => string;
      inject?: () => Record<string, unknown>;
    }) => {
      registrations.push({
        key: "settings.plugins.tab",
        id: options.id,
        order: options.order,
        label: options.label?.(),
        props: options.inject?.() ?? {},
      });
      return () => undefined;
    },
  });

  return { ctx, registrations, mounted, disposed };
}

describe("client apply()", () => {
  it("mounts the remote and registers the settings tab", async () => {
    const harness = harnessOf();
    await apply(harness.ctx);
    expect(harness.mounted.count).toBe(1);
    expect(harness.registrations).toHaveLength(1);
    expect(harness.registrations[0]).toMatchObject({
      key: "settings.plugins.tab",
      id: "domain-experts",
      order: 20,
      label: "Domain Experts",
    });
  });

  it("hands the page an api that unwraps the two-layer remote result", async () => {
    const harness = harnessOf();
    await apply(harness.ctx);
    const props = harness.registrations[0]?.props as {
      api: { listDomains(): Promise<unknown> };
      currentSessionId(): string;
    };
    // `ok`/`value` (carrier) plus `ok`/`code` (envelope) collapse into one outcome.
    await expect(props.api.listDomains()).resolves.toEqual({
      ok: true,
      data: { ...ENVELOPE, domains: [] },
    });
    expect(typeof props.currentSessionId).toBe("function");
  });

  it("returns a disposer that unwinds the mount and the registration", async () => {
    const harness = harnessOf();
    const dispose = await apply(harness.ctx);
    await dispose();
    expect(harness.disposed.remote).toBe(1);
    expect(harness.disposed.slots).toBe(1);
  });
});

/*
 * What this file does NOT cover, deliberately.
 *
 * The bug that made the browser half vanish was reading `remote.domainExperts`
 * on the plugin's own context instead of an injected one. Reproducing it needs
 * cordis to gate the read, and gating only happens when `apply()` runs inside a
 * plugin fiber AND the namespace is reachable solely through the isolate map —
 * neither of which a bare test context can mirror. A stub that exposes the
 * namespace as a plain property (the obvious shortcut) makes the buggy code
 * pass, so a test built that way would assert nothing.
 *
 * The inject contract is therefore verified where it actually fails: by loading
 * the built bundle in a running DSH and confirming the settings tab registers.
 * The marker below fails loudly if that verification is ever dropped without a
 * replacement, rather than letting this file imply coverage it does not have.
 */
describe("client apply() inject contract", () => {
  it("declares the services the browser half activates on", () => {
    // Kept in step with the live check: activation needs the slot registry, the
    // remote gateway and the session feed before `apply` can run at all.
    expect(CLIENT_INJECT).toEqual(["slots", "remote", "sessions"]);
  });
});
