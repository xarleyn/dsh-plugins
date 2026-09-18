import { describe, expect, it } from "vitest";
import { installLocaleHook } from "../src/runtime/locale-hook.js";
import {
  createDiagnostics,
  createRegistry,
  createTranslator,
} from "./locale-hook.helpers.js";

describe("installLocaleHook", () => {
  it("delegates with the exact original argument list", () => {
    const argumentCounts: number[] = [];
    const runtime = {
      translate(...args: unknown[]): number {
        argumentCounts.push(args.length);
        return args.length;
      },
      getSnapshot: () => ({ active: "zh" }),
      subscribe: () => () => undefined,
    };

    installLocaleHook(runtime, createRegistry(), createDiagnostics());

    expect(runtime.translate("composer", "greeting")).toBe(2);
    expect(argumentCounts).toEqual([2]);
  });

  it("updates a translator bound before installation", () => {
    const runtime = {
      translate(
        namespace: string,
        key: string,
        _params?: Record<string, unknown>,
      ): string {
        return `${namespace}:${key}`;
      },
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
      bind(namespace: string) {
        return (key: string, params?: Record<string, unknown>) =>
          this.translate(namespace, key, params);
      },
    };
    const bound = runtime.bind("composer");

    installLocaleHook(runtime, createRegistry(), createDiagnostics());

    expect(bound("greeting", { name: "Grace" })).toBe("Hello Grace");
  });

  it("delegates non-English locales with the runtime as the exact this value", () => {
    let observedThis: unknown;
    const runtime = {
      translate(this: unknown, namespace: string, key: string): string {
        observedThis = this;
        return `${namespace}:${key}`;
      },
      getSnapshot(this: unknown) {
        expect(this).toBe(runtime);
        return { active: "zh" };
      },
      subscribe: () => () => undefined,
    };

    installLocaleHook(runtime, createRegistry(), createDiagnostics());

    expect(runtime.translate("composer", "greeting")).toBe("composer:greeting");
    expect(observedThis).toBe(runtime);
  });

  it("does not swallow an exception from the original translator", () => {
    const failure = new Error("translation failed");
    const runtime = {
      translate(): never {
        throw failure;
      },
      getSnapshot: () => ({ active: "zh" }),
      subscribe: () => () => undefined,
    };

    installLocaleHook(runtime, createRegistry(), createDiagnostics());

    expect(() => runtime.translate()).toThrow(failure);
  });

  it("fails open for primitive, missing, nonfunction, and unreadable runtime shapes", () => {
    const throwingTranslate = Object.defineProperty({}, "translate", {
      get(): never {
        throw new Error("translate unavailable");
      },
    });
    const throwingSnapshot = Object.defineProperty(
      {
        translate: () => "fallback",
        subscribe: () => () => undefined,
      },
      "getSnapshot",
      {
        get(): never {
          throw new Error("snapshot method unavailable");
        },
      },
    );
    const throwingSubscribe = Object.defineProperty(
      {
        translate: () => "fallback",
        getSnapshot: () => ({ active: "en" }),
      },
      "subscribe",
      {
        get(): never {
          throw new Error("subscribe unavailable");
        },
      },
    );
    const cases: readonly unknown[] = [
      null,
      undefined,
      1,
      "runtime",
      {},
      { translate: 1, getSnapshot: () => ({}), subscribe: () => undefined },
      { translate: () => "fallback", subscribe: () => undefined },
      {
        translate: () => "fallback",
        getSnapshot: () => ({}),
        subscribe: false,
      },
      throwingTranslate,
      throwingSnapshot,
      throwingSubscribe,
    ];

    for (const candidate of cases) {
      const diagnostics = createDiagnostics();
      expect(() =>
        installLocaleHook(candidate, createRegistry(), diagnostics),
      ).not.toThrow();
      expect(diagnostics.snapshot()).toContainEqual({
        level: "error",
        code: "incompatible_locale_runtime",
        message: expect.any(String),
      });
    }
  });

  it("captures snapshot and subscription method values once during adaptation", () => {
    let snapshotReads = 0;
    let subscribeReads = 0;
    const runtime = {
      translate: createTranslator("fallback"),
      get getSnapshot() {
        snapshotReads += 1;
        if (snapshotReads > 1) throw new Error("snapshot getter changed");
        return () => ({ active: "en" });
      },
      get subscribe() {
        subscribeReads += 1;
        if (subscribeReads > 1) throw new Error("subscribe getter changed");
        return () => () => undefined;
      },
    };

    installLocaleHook(runtime, createRegistry(), createDiagnostics());

    expect(runtime.translate("composer", "greeting", { name: "Lin" })).toBe(
      "Hello Lin",
    );
    expect(snapshotReads).toBe(1);
    expect(subscribeReads).toBe(1);
  });

  it("diagnoses invalid and unreadable active locale snapshots", () => {
    const unreadableActive = Object.defineProperty({}, "active", {
      get(): never {
        throw new Error("active unavailable");
      },
    });

    for (const snapshot of [null, {}, { active: 1 }, unreadableActive]) {
      const diagnostics = createDiagnostics();
      const runtime = {
        translate: createTranslator("fallback"),
        getSnapshot: () => snapshot,
        subscribe: () => () => undefined,
      };
      installLocaleHook(runtime, createRegistry(), diagnostics);

      expect(runtime.translate("composer", "greeting")).toBe("fallback");
      expect(diagnostics.snapshot()).toContainEqual({
        level: "error",
        code: "locale_snapshot_failed",
        message: expect.any(String),
      });
    }
  });
});
