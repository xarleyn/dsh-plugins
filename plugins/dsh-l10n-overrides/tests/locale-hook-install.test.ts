import { describe, expect, it } from "vitest";
import { adaptDshLocaleRuntime } from "../src/adapters/dsh-locale-runtime.js";
import { installLocaleHook } from "../src/runtime/locale-hook.js";
import {
  createDiagnostics,
  createRegistry,
  createTranslator,
} from "./locale-hook.helpers.js";

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
});
