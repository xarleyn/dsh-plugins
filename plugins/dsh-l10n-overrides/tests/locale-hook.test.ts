import { describe, expect, it, vi } from "vitest";
import { adaptDshLocaleRuntime } from "../src/adapters/dsh-locale-runtime.js";
import { Diagnostics } from "../src/registry/diagnostics.js";
import { TranslationPackRegistry } from "../src/registry/translation-registry.js";
import { installLocaleHook } from "../src/runtime/locale-hook.js";

function createDiagnostics(debug = false): Diagnostics {
  return new Diagnostics(
    {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    { debug },
  );
}

function createRegistry(
  diagnostics = createDiagnostics(),
): TranslationPackRegistry {
  const registry = new TranslationPackRegistry(diagnostics);
  registry.register({
    id: "composer-pack",
    target: { package: "example" },
    en: { composer: { greeting: "Hello {name}" } },
  });
  return registry;
}

function createTranslator(value: string) {
  return vi.fn(
    (_namespace: string, _key: string, _params?: Record<string, unknown>) =>
      value,
  );
}

describe("installLocaleHook", () => {
  it("does not mutate a compatible runtime until explicit adapter install", () => {
    let assignments = 0;
    let translate: (
      namespace: string,
      key: string,
      params?: Record<string, unknown>,
    ) => unknown = createTranslator("fallback");
    const runtime = {
      get translate() {
        return translate;
      },
      set translate(value) {
        assignments += 1;
        translate = value;
      },
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };

    const adapter = adaptDshLocaleRuntime(runtime);

    expect(adapter).toBeDefined();
    expect(assignments).toBe(0);
    const wrapper = function () {
      return "wrapped";
    };
    expect(adapter?.install(wrapper)).toEqual({ ok: true });
    expect(assignments).toBe(1);
  });

  it("returns an interpolated exact English override and diagnoses its owner", () => {
    const original = createTranslator("original");
    const runtime = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    const diagnostics = createDiagnostics(true);

    installLocaleHook(runtime, createRegistry(), diagnostics);

    expect(runtime.translate("composer", "greeting", { name: "Ada" })).toBe(
      "Hello Ada",
    );
    expect(original).not.toHaveBeenCalled();
    expect(diagnostics.snapshot()).toContainEqual({
      level: "debug",
      code: "locale_override_hit",
      message: expect.stringMatching(/en.*composer.*greeting.*composer-pack/),
    });
  });

  it("delegates an English registry miss to the captured original", () => {
    const original = createTranslator("fallback");
    const runtime = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };

    installLocaleHook(runtime, createRegistry(), createDiagnostics());

    expect(runtime.translate("composer", "missing", { count: 2 })).toBe(
      "fallback",
    );
    expect(original).toHaveBeenCalledWith("composer", "missing", { count: 2 });
  });

  it("diagnoses a failing snapshot once per installation and delegates", () => {
    const original = createTranslator("fallback");
    const runtime = {
      translate: original,
      getSnapshot(): never {
        throw new Error("snapshot unavailable");
      },
      subscribe: () => () => undefined,
    };
    const diagnostics = createDiagnostics();

    installLocaleHook(runtime, createRegistry(), diagnostics);

    expect(runtime.translate("composer", "greeting")).toBe("fallback");
    expect(runtime.translate("composer", "greeting")).toBe("fallback");
    expect(
      diagnostics
        .snapshot()
        .filter((entry) => entry.code === "locale_snapshot_failed"),
    ).toHaveLength(1);
  });

  it("rejects a duplicate installation without giving its disposer ownership", () => {
    const original = createTranslator("fallback");
    const runtime = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    const firstDiagnostics = createDiagnostics();
    const duplicateDiagnostics = createDiagnostics();

    const disposeFirst = installLocaleHook(
      runtime,
      createRegistry(),
      firstDiagnostics,
    );
    const installed = runtime.translate;
    const disposeDuplicate = installLocaleHook(
      runtime,
      createRegistry(),
      duplicateDiagnostics,
    );

    expect(duplicateDiagnostics.snapshot()).toContainEqual({
      level: "warning",
      code: "duplicate_locale_hook",
      message: expect.any(String),
    });
    expect(disposeDuplicate()).toBe(true);
    expect(runtime.translate).toBe(installed);
    expect(disposeFirst()).toBe(true);
    expect(runtime.translate).toBe(original);
    expect(disposeFirst()).toBe(true);
  });

  it("fails open when translate is frozen and reports the install failure", () => {
    const original = createTranslator("fallback");
    const runtime = Object.freeze({
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    });
    const diagnostics = createDiagnostics();

    const dispose = installLocaleHook(runtime, createRegistry(), diagnostics);

    expect(runtime.translate).toBe(original);
    expect(runtime.translate("composer", "greeting")).toBe("fallback");
    expect(diagnostics.snapshot()).toContainEqual({
      level: "error",
      code: "locale_hook_install_failed",
      message: expect.any(String),
    });
    expect(dispose()).toBe(true);
  });

  it("fails open when translate is a non-writable property", () => {
    const original = createTranslator("fallback");
    const runtime = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    Object.defineProperty(runtime, "translate", {
      configurable: true,
      enumerable: true,
      value: original,
      writable: false,
    });
    const diagnostics = createDiagnostics();

    installLocaleHook(runtime, createRegistry(), diagnostics);

    expect(runtime.translate).toBe(original);
    expect(diagnostics.snapshot()).toContainEqual({
      level: "error",
      code: "locale_hook_install_failed",
      message: expect.any(String),
    });
  });

  it("contains and diagnoses a translate identity trap during disposal", () => {
    const original = createTranslator("fallback");
    const target = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    let throwOnTranslateRead = false;
    const runtime = new Proxy(target, {
      get(current, property, receiver): unknown {
        if (property === "translate" && throwOnTranslateRead) {
          throw new Error("translate unavailable");
        }
        return Reflect.get(current, property, receiver);
      },
    });
    const diagnostics = createDiagnostics();
    const dispose = installLocaleHook(runtime, createRegistry(), diagnostics);
    const installed = target.translate;

    throwOnTranslateRead = true;

    expect(dispose()).toBe(false);
    expect(target.translate).toBe(installed);
    expect(diagnostics.snapshot()).toContainEqual({
      level: "error",
      code: "locale_hook_restore_failed",
      message: expect.any(String),
    });
  });

  it("rolls back a trapping install and releases ownership for retry", () => {
    const original = createTranslator("fallback");
    const target = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    let failInstall = true;
    const runtime = new Proxy(target, {
      set(current, property, value, receiver): boolean {
        const assigned = Reflect.set(current, property, value, receiver);
        if (property === "translate" && value !== original && failInstall) {
          throw new Error("install rejected after assignment");
        }
        return assigned;
      },
    });

    installLocaleHook(runtime, createRegistry(), createDiagnostics());

    expect(target.translate).toBe(original);
    failInstall = false;
    const retryDiagnostics = createDiagnostics();
    installLocaleHook(runtime, createRegistry(), retryDiagnostics);
    expect(target.translate).not.toBe(original);
    expect(
      retryDiagnostics
        .snapshot()
        .some((entry) => entry.code === "duplicate_locale_hook"),
    ).toBe(false);
  });

  it("diagnoses a restore setter that reports success without restoring", () => {
    const original = createTranslator("fallback");
    const target = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    let ignoreRestore = false;
    const runtime = new Proxy(target, {
      defineProperty(current, property, attributes): boolean {
        if (
          property === "translate" &&
          attributes.value === original &&
          ignoreRestore
        ) {
          return true;
        }
        return Reflect.defineProperty(current, property, attributes);
      },
      set(current, property, value, receiver): boolean {
        if (property === "translate" && value === original && ignoreRestore) {
          return true;
        }
        return Reflect.set(current, property, value, receiver);
      },
    });
    const diagnostics = createDiagnostics();
    const dispose = installLocaleHook(runtime, createRegistry(), diagnostics);
    const installed = target.translate;

    ignoreRestore = true;
    expect(dispose()).toBe(false);

    expect(target.translate).toBe(installed);
    expect(diagnostics.snapshot()).toContainEqual({
      level: "error",
      code: "locale_hook_restore_failed",
      message: expect.any(String),
    });
  });

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

  it("does not overwrite a foreign translator installed before disposal", () => {
    const original = createTranslator("original");
    const foreign = createTranslator("foreign");
    const runtime = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    const diagnostics = createDiagnostics();
    const dispose = installLocaleHook(runtime, createRegistry(), diagnostics);
    runtime.translate = foreign;

    dispose();

    expect(runtime.translate).toBe(foreign);
    expect(
      diagnostics
        .snapshot()
        .some((entry) => entry.code === "locale_hook_restore_failed"),
    ).toBe(false);
  });

  it("supports an idempotent disposal followed by a fresh installation", () => {
    const original = createTranslator("fallback");
    const runtime = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    const disposeFirst = installLocaleHook(
      runtime,
      createRegistry(),
      createDiagnostics(),
    );

    expect(disposeFirst()).toBe(true);
    expect(disposeFirst()).toBe(true);
    expect(runtime.translate).toBe(original);

    const secondDiagnostics = createDiagnostics();
    const disposeSecond = installLocaleHook(
      runtime,
      createRegistry(),
      secondDiagnostics,
    );
    expect(runtime.translate("composer", "greeting", { name: "Mina" })).toBe(
      "Hello Mina",
    );
    expect(
      secondDiagnostics
        .snapshot()
        .some((entry) => entry.code === "duplicate_locale_hook"),
    ).toBe(false);

    disposeSecond();
    expect(runtime.translate).toBe(original);
  });

  it("restores an inherited translator without leaving an own property", () => {
    class Runtime {
      translate(namespace: string, key: string): string {
        return `${namespace}:${key}`;
      }

      getSnapshot() {
        return { active: "en" };
      }

      subscribe() {
        return () => undefined;
      }
    }
    const runtime = new Runtime();
    const original = runtime.translate;
    expect(Object.hasOwn(runtime, "translate")).toBe(false);
    const dispose = installLocaleHook(
      runtime,
      createRegistry(),
      createDiagnostics(),
    );

    expect(dispose()).toBe(true);

    expect(runtime.translate).toBe(original);
    expect(Object.hasOwn(runtime, "translate")).toBe(false);
  });

  it("retains ownership after a failed restore until disposal can retry", () => {
    const original = createTranslator("fallback");
    const target = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    let failReads = false;
    const runtime = new Proxy(target, {
      get(current, property, receiver): unknown {
        if (property === "translate" && failReads) {
          throw new Error("translate unavailable");
        }
        return Reflect.get(current, property, receiver);
      },
    });
    const dispose = installLocaleHook(
      runtime,
      createRegistry(),
      createDiagnostics(),
    );
    const installed = target.translate;

    failReads = true;
    expect(dispose()).toBe(false);
    failReads = false;

    const duplicateDiagnostics = createDiagnostics();
    installLocaleHook(runtime, createRegistry(), duplicateDiagnostics);
    expect(duplicateDiagnostics.snapshot()).toContainEqual({
      level: "warning",
      code: "duplicate_locale_hook",
      message: expect.any(String),
    });
    expect(target.translate).toBe(installed);

    expect(dispose()).toBe(true);
    expect(target.translate).toBe(original);
  });

  it("tracks a wrapper left behind when install rollback is blocked", () => {
    const original = createTranslator("fallback");
    const target = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    let sabotage = true;
    const runtime = new Proxy(target, {
      defineProperty(current, property, attributes): boolean {
        if (property === "translate" && sabotage) return false;
        return Reflect.defineProperty(current, property, attributes);
      },
      set(current, property, value, receiver): boolean {
        if (property === "translate" && sabotage) {
          Reflect.set(current, property, value, current);
          throw new Error("install failed after mutation");
        }
        return Reflect.set(current, property, value, receiver);
      },
    });
    const installDiagnostics = createDiagnostics();

    const dispose = installLocaleHook(
      runtime,
      createRegistry(),
      installDiagnostics,
    );

    expect(target.translate).not.toBe(original);
    expect(installDiagnostics.snapshot()).toContainEqual({
      level: "error",
      code: "locale_hook_install_failed",
      message: expect.any(String),
    });

    sabotage = false;
    const duplicateDiagnostics = createDiagnostics();
    installLocaleHook(runtime, createRegistry(), duplicateDiagnostics);
    expect(duplicateDiagnostics.snapshot()).toContainEqual({
      level: "warning",
      code: "duplicate_locale_hook",
      message: expect.any(String),
    });

    dispose();
    expect(target.translate).toBe(original);
  });

  it("releases ownership after a clean getter-only install failure", () => {
    const original = createTranslator("fallback");
    const runtime = {
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    Object.defineProperty(runtime, "translate", {
      configurable: true,
      enumerable: true,
      get: () => original,
    });

    const firstDiagnostics = createDiagnostics();
    const disposeFirst = installLocaleHook(
      runtime,
      createRegistry(),
      firstDiagnostics,
    );
    expect(firstDiagnostics.snapshot()).toContainEqual({
      level: "error",
      code: "locale_hook_install_failed",
      message: expect.any(String),
    });
    expect(Reflect.get(runtime, "translate")).toBe(original);

    const secondDiagnostics = createDiagnostics();
    installLocaleHook(runtime, createRegistry(), secondDiagnostics);
    expect(secondDiagnostics.snapshot()).toContainEqual({
      level: "error",
      code: "locale_hook_install_failed",
      message: expect.any(String),
    });
    expect(
      secondDiagnostics
        .snapshot()
        .some((entry) => entry.code === "duplicate_locale_hook"),
    ).toBe(false);
    expect(disposeFirst).not.toThrow();
    expect(disposeFirst).not.toThrow();
  });

  it("does not overwrite a foreign translator exposed by a failed assignment", () => {
    const original = createTranslator("original");
    const foreign = createTranslator("foreign");
    const target = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    const runtime = new Proxy(target, {
      set(current, property): boolean {
        if (property === "translate") {
          current.translate = foreign;
          return false;
        }
        return false;
      },
    });
    const diagnostics = createDiagnostics();

    installLocaleHook(runtime, createRegistry(), diagnostics);

    expect(target.translate).toBe(foreign);
    expect(diagnostics.snapshot()).toContainEqual({
      level: "error",
      code: "locale_hook_install_failed",
      message: expect.any(String),
    });
  });

  it("restores an inherited accessor translator through its setter", () => {
    const original = createTranslator("fallback");
    let backing = original;
    class Runtime {
      get translate() {
        return backing;
      }

      set translate(value: typeof backing) {
        backing = value;
      }

      getSnapshot() {
        return { active: "en" };
      }

      subscribe() {
        return () => undefined;
      }
    }
    const runtime = new Runtime();
    const diagnostics = createDiagnostics();
    const dispose = installLocaleHook(runtime, createRegistry(), diagnostics);
    expect(backing).not.toBe(original);
    expect(Object.hasOwn(runtime, "translate")).toBe(false);

    dispose();

    expect(backing).toBe(original);
    expect(Object.hasOwn(runtime, "translate")).toBe(false);
    expect(
      diagnostics
        .snapshot()
        .some((entry) => entry.code === "locale_hook_restore_failed"),
    ).toBe(false);

    const reinstallDiagnostics = createDiagnostics();
    const disposeReinstall = installLocaleHook(
      runtime,
      createRegistry(),
      reinstallDiagnostics,
    );
    expect(
      reinstallDiagnostics
        .snapshot()
        .some((entry) => entry.code === "duplicate_locale_hook"),
    ).toBe(false);
    disposeReinstall();
    expect(backing).toBe(original);
  });

  it("accepts a foreign inherited translator exposed after deleting our wrapper", () => {
    class Runtime {
      translate(namespace: string, key: string): string {
        return `${namespace}:${key}`;
      }

      getSnapshot() {
        return { active: "en" };
      }

      subscribe() {
        return () => undefined;
      }
    }
    const runtime = new Runtime();
    const foreign = function () {
      return "foreign";
    };
    const diagnostics = createDiagnostics();
    const dispose = installLocaleHook(runtime, createRegistry(), diagnostics);
    Runtime.prototype.translate = foreign;

    dispose();

    expect(runtime.translate).toBe(foreign);
    expect(Object.hasOwn(runtime, "translate")).toBe(false);
    expect(
      diagnostics
        .snapshot()
        .some((entry) => entry.code === "locale_hook_restore_failed"),
    ).toBe(false);

    const reinstallDiagnostics = createDiagnostics();
    installLocaleHook(runtime, createRegistry(), reinstallDiagnostics);
    expect(
      reinstallDiagnostics
        .snapshot()
        .some((entry) => entry.code === "duplicate_locale_hook"),
    ).toBe(false);
  });

  it("reserves ownership before a reentrant installation can stack", () => {
    const original = createTranslator("fallback");
    const target = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    const innerDiagnostics = createDiagnostics();
    let innerDispose: () => void = () => undefined;
    let reentered = false;
    const runtime: typeof target = new Proxy(target, {
      set(current, property, value): boolean {
        if (property === "translate" && !reentered) {
          reentered = true;
          innerDispose = installLocaleHook(
            runtime,
            createRegistry(),
            innerDiagnostics,
          );
        }
        return Reflect.set(current, property, value, current);
      },
    });

    const dispose = installLocaleHook(
      runtime,
      createRegistry(),
      createDiagnostics(),
    );
    const installed = target.translate;

    expect(innerDiagnostics.snapshot()).toContainEqual({
      level: "warning",
      code: "duplicate_locale_hook",
      message: expect.any(String),
    });
    innerDispose();
    expect(target.translate).toBe(installed);

    dispose();
    expect(target.translate).toBe(original);
  });

  it("diagnoses repeated failed disposal once while continuing to retry", () => {
    const original = createTranslator("fallback");
    const target = {
      translate: original,
      getSnapshot: () => ({ active: "en" }),
      subscribe: () => () => undefined,
    };
    let failReads = false;
    let translateReads = 0;
    const runtime = new Proxy(target, {
      get(current, property, receiver): unknown {
        if (property === "translate") {
          translateReads += 1;
          if (failReads) throw new Error("translate unavailable");
        }
        return Reflect.get(current, property, receiver);
      },
    });
    const diagnostics = createDiagnostics();
    const dispose = installLocaleHook(runtime, createRegistry(), diagnostics);

    failReads = true;
    const readsBeforeDispose = translateReads;
    dispose();
    const readsAfterFirstFailure = translateReads;
    dispose();

    expect(readsAfterFirstFailure).toBeGreaterThan(readsBeforeDispose);
    expect(translateReads).toBeGreaterThan(readsAfterFirstFailure);
    expect(
      diagnostics
        .snapshot()
        .filter((entry) => entry.code === "locale_hook_restore_failed"),
    ).toHaveLength(1);

    failReads = false;
    dispose();
    expect(target.translate).toBe(original);
  });
});
