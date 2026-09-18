import { describe, expect, it } from "vitest";
import { installLocaleHook } from "../src/runtime/locale-hook.js";
import {
  createDiagnostics,
  createRegistry,
  createTranslator,
} from "./locale-hook.helpers.js";

describe("installLocaleHook", () => {
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
});
