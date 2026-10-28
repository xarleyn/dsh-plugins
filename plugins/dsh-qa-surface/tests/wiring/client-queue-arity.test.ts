// @vitest-environment jsdom

/**
 * The queue-status call the browser half sends always carries both wire
 * arguments, even when the controller asks for the global read with none.
 *
 * The gateway client counts declared parameters, not TypeScript optionals, so
 * a 0-argument call never reached the Host: every initial send logged
 * `client api: qaSurface/queueStatus expected 2 argument(s), got 0` and the
 * ceiling read came back null (16/16 sends on the 28.10 acceptance wave). The
 * stub below enforces the same arity the real gateway client does, so the
 * assertion is the call surviving it.
 */

import { Context, type Plugin } from "@deepseek-ai/cordis";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as clientModule from "../../src/client/index.js";
import type { QaQueueStatus } from "../../src/types.js";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  remote as accountsRemote,
  session,
} from "../accounts/accounts-controller.helpers.js";

const { apply, inject: CLIENT_INJECT } = clientModule;

const CLIENT_PLUGIN: Plugin = {
  name: "dsh-qa-surface",
  inject: CLIENT_INJECT,
  apply,
};

interface Registration {
  readonly name: string;
  readonly inject?: () => Record<string, unknown>;
}

type QaQueueStatusFn = (
  token: string,
  sessionId: string,
) => Promise<RemoteResult<QaQueueStatus>>;

/**
 * Wrap a stub so it refuses any call whose argument count differs from the
 * generated contract — the check `packages/api/gateway/src/client/index.ts`
 * performs before a Remote invocation leaves the browser.
 */
function gatewayArity(expected: number, stub: QaQueueStatusFn): QaQueueStatusFn {
  // A function expression on purpose: the check is the call's own argument
  // count, which an arrow function cannot see.
  return function (token: string, sessionId: string) {
    if (arguments.length !== expected) {
      throw new Error(
        `client api: qaSurface/queueStatus expected ${String(expected)} argument(s), got ${String(arguments.length)}`,
      );
    }
    return stub(token, sessionId);
  };
}

function harness(queueStatus: unknown) {
  const ctx = new Context();
  const registrations: Registration[] = [];
  const policyRemote = {
    ...accountsRemote({
      accountsWhoami: vi.fn(async () => ({
        ok: true as const,
        value: { authenticated: false },
      })),
      accountsLogin: vi.fn(async () => session("t-arity")),
    }),
    describe: async () => ({ ok: true as const, value: resolveConfig({}) }),
    queueStatus,
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
  ctx.provide("uiConversation", { events: { register: () => () => {} } });
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
      return () => undefined;
    },
  });
  return {
    async load() {
      const fiber = await ctx.plugin(CLIENT_PLUGIN);
      return {
        dispose: () => fiber.dispose(),
        face: () =>
          registrations
            .filter((item) => item.name === "shell.overlay")
            .at(-1)
            ?.inject?.() as unknown as {
            queueStatus: (
              token?: string,
              sessionId?: string,
            ) => Promise<RemoteResult<QaQueueStatus>>;
          },
      };
    },
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe("browser half queue-status arity", () => {
  it("sends both wire arguments for the controller's no-argument global read", async () => {
    const stub = vi.fn(
      async () =>
        ({
          ok: true as const,
          value: { limit: 2, active: 0, full: false },
        }) as RemoteResult<QaQueueStatus>,
    );
    const world = harness(gatewayArity(2, stub as unknown as QaQueueStatusFn));
    const loaded = await world.load();
    try {
      const face = loaded.face();
      expect(face.queueStatus).toBeTypeOf("function");
      // The controller's `readQueueStatus()` calls the face with no arguments:
      // exactly the shape the old client turned into a 0-argument wire call.
      const result = await face.queueStatus();
      expect(result.ok).toBe(true);
      expect(stub).toHaveBeenLastCalledWith("", "");
      expect(stub.mock.calls.at(-1)).toHaveLength(2);
    } finally {
      await loaded.dispose();
    }
  });

  it("forwards the authorized per-chat read verbatim", async () => {
    const stub = vi.fn(
      async () =>
        ({
          ok: true as const,
          value: { limit: 2, active: 1, full: true, waiting: true, position: 1 },
        }) as RemoteResult<QaQueueStatus>,
    );
    const world = harness(gatewayArity(2, stub as unknown as QaQueueStatusFn));
    const loaded = await world.load();
    try {
      const result = await loaded.face().queueStatus("t-arity", "owned-chat");
      expect(result.ok).toBe(true);
      expect(stub).toHaveBeenLastCalledWith("t-arity", "owned-chat");
    } finally {
      await loaded.dispose();
    }
  });
});
