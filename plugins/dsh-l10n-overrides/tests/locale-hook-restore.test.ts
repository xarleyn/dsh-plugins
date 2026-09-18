import { describe, expect, it } from "vitest";
import { installLocaleHook } from "../src/runtime/locale-hook.js";
import {
  createDiagnostics,
  createRegistry,
  createTranslator,
} from "./locale-hook.helpers.js";

describe("installLocaleHook", () => {
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
