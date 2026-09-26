// @vitest-environment jsdom

/**
 * The browser half under a real Cordis context.
 *
 * The account controller is rebuilt whenever the remote wiring re-injects, and
 * the boot `whoami` of the instance being replaced answers for the token this
 * browser had *then*: "not authenticated" clears the shared localStorage key,
 * which by then carries the fresh instance's login. Telling that race apart
 * needs the module itself — loaded, unloaded, and loaded again — because a unit
 * test that called `dispose()` directly would also pass on a module that never
 * calls it.
 */

import { Context, type Plugin } from "@deepseek-ai/cordis";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as clientModule from "../../src/client/index.js";
import type { QaAccountsController } from "../../src/client/QaAccountsController.js";
import type { QaAccountsApi } from "../../src/client/types.js";
import { resolveConfig } from "../../src/resolve-config.js";
import type { QaWhoamiResult } from "../../src/types.js";
import {
  TOKEN_KEY,
  remote as accountsRemote,
  session,
} from "../accounts/accounts-controller.helpers.js";

const { apply, inject: CLIENT_INJECT } = clientModule;

/** What the ModuleLoader hands the host: the same shape this module exports. */
const CLIENT_PLUGIN: Plugin = {
  name: "dsh-qa-surface",
  inject: CLIENT_INJECT,
  apply,
};

/** One slot registration the module performed. */
interface Registration {
  readonly name: string;
  readonly inject?: () => Record<string, unknown>;
}

/** Let every continuation queued by the module run. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Serve everything the browser half injects, and record what it registers. */
function harness(accounts: QaAccountsApi) {
  const ctx = new Context();
  const registrations: Registration[] = [];
  const policyRemote = {
    ...accounts,
    describe: async () => ({ ok: true as const, value: resolveConfig({}) }),
  };
  ctx.provide("remote", {
    qaSurface: policyRemote,
    session: {},
    agentPresets: {},
    $mount: async () => async () => undefined,
  });
  ctx.provide("remote.qaSurface", policyRemote);
  ctx.provide("remote.session", {});
  ctx.provide("remote.agentPresets", {});
  ctx.provide("sessions", { list: { getSnapshot: () => ({ byId: {} }) } });
  ctx.provide("uiConversation", {});
  ctx.provide("connection", {
    generation: {
      getSnapshot: () => "generation-1",
      subscribe: () => () => undefined,
    },
  });
  ctx.provide("configForms", {
    get: () => ({
      getSnapshot: () => ({ status: "unavailable" }),
      subscribe: () => () => undefined,
      mutate: async () => true,
    }),
  });
  ctx.provide("slots", {
    inject: (_name: string, factory: () => (() => void) | void) => {
      const dispose = factory();
      return () => {
        if (typeof dispose === "function") dispose();
      };
    },
    register: (options: Registration) => {
      registrations.push(options);
      return () => {
        const index = registrations.indexOf(options);
        if (index >= 0) registrations.splice(index, 1);
      };
    },
  });

  return {
    /** Start the module; `face()` reads the overlay face it registered. */
    async load() {
      const fiber = await ctx.plugin(CLIENT_PLUGIN);
      return {
        dispose: () => fiber.dispose(),
        // This stand-in registry keeps an unloaded instance's registration
        // (the host releases it with the fiber), so the face is read off the
        // newest one.
        face: () =>
          registrations
            .filter((item) => item.name === "shell.overlay")
            .at(-1)
            ?.inject?.() as unknown as { accounts: QaAccountsController },
      };
    },
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe("browser half rebuild", () => {
  it("refuses a replaced instance its late answer over the stored token", async () => {
    /** The boot probe of the instance being replaced stays in flight. */
    let answerStale: (result: RemoteResult<QaWhoamiResult>) => void = () =>
      undefined;
    const stale = new Promise<RemoteResult<QaWhoamiResult>>((resolve) => {
      answerStale = resolve;
    });
    let probes = 0;
    const accountsWhoami = vi.fn(async () => {
      probes += 1;
      // Every instance after the first learns right away that the token this
      // browser holds no longer identifies anyone.
      return probes === 1
        ? stale
        : { ok: true as const, value: { authenticated: false } };
    });
    const accounts = accountsRemote({
      accountsWhoami,
      accountsLogin: vi.fn(async () => session("t-fresh")),
    });
    window.localStorage.setItem(TOKEN_KEY, "t-stale");

    const world = harness(accounts);
    const replaced = await world.load();
    await settled();
    expect(accountsWhoami).toHaveBeenCalledWith("t-stale");

    // The remote wiring re-injects: this instance is gone from here on.
    await replaced.dispose();
    const current = await world.load();
    await settled();
    expect(accountsWhoami).toHaveBeenCalledTimes(2);

    // The visitor signs into the fresh instance, which stores its token.
    await current.face().accounts.login("a@b.co", "secret");
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("t-fresh");

    // And only now does the old instance learn its token was stale.
    answerStale({ ok: true, value: { authenticated: false } });
    await settled();

    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("t-fresh");
  });
});
