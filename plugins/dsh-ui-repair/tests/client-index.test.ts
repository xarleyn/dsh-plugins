// @vitest-environment jsdom

import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { apply, inject } from "../src/client/index.js";

describe("client entrypoint", () => {
  it("provides a browser-local service and removes it on disposal", () => {
    const removeService = vi.fn();
    const provide = vi.fn((_name: string, _value: unknown) => removeService);
    const unsubscribe = vi.fn();
    let snapshot: {
      status: "ready";
      value: { mode: "suggest" | "auto" };
      writable: true;
    } = {
        status: "ready",
        value: { mode: "suggest" },
        writable: true,
      };
    let settingsListener: (() => void) | undefined;
    const scope = {
      getSnapshot: () => snapshot,
      subscribe: vi.fn((listener: () => void) => {
        settingsListener = listener;
        return unsubscribe;
      }),
      set: vi.fn(),
      unset: vi.fn(),
    };
    const removeSlot = vi.fn();
    const removeRegistration = vi.fn();
    const ctx = {
      provide,
      settingsScope: { bind: vi.fn(() => scope) },
      slots: {
        inject: vi.fn((_slot: string, factory: () => unknown) => {
          factory();
          return removeSlot;
        }),
        register: vi.fn(() => removeRegistration),
      },
    };
    const dispose = apply(ctx as unknown as Context, {
      document,
      scanOnStartup: false,
      observeMutations: false,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(inject).toEqual(["slots", "settingsScope"]);
    expect(provide).toHaveBeenCalledWith("uiRepair", expect.anything());
    const runtime = provide.mock.calls[0]?.[1] as {
      getMode(): string;
    };
    expect(runtime.getMode()).toBe("suggest");
    expect(ctx.settingsScope.bind).toHaveBeenCalledWith({ namespace: "ui-repair" });
    expect(ctx.slots.inject).toHaveBeenCalledWith(
      "settings.plugin.item",
      expect.any(Function),
    );
    expect(ctx.slots.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: "settings.plugin.item", key: "ui-repair" }),
      expect.any(Function),
    );
    snapshot = {
      status: "ready",
      value: { mode: "auto" },
      writable: true,
    };
    settingsListener?.();
    expect(runtime.getMode()).toBe("auto");
    dispose();
    dispose();
    expect(removeService).toHaveBeenCalledTimes(1);
    expect(removeSlot).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("is a no-op without a DOM", () => {
    const provide = vi.fn();
    const dispose = apply({ provide } as unknown as Context, { document: null });
    dispose();
    expect(provide).not.toHaveBeenCalled();
  });
});
