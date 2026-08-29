export type LocaleTranslateArguments = [
  namespace: string,
  key: string,
  params?: Record<string, unknown>,
];

export type LocaleTranslate = (...args: LocaleTranslateArguments) => unknown;

export type AdapterResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false };

export type LocaleInstallResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly runtimeMayBePatched: boolean };

export interface DshLocaleRuntimeAdapter {
  readonly runtime: object;
  getActiveLocale(): AdapterResult<string>;
  callOriginal(args: LocaleTranslateArguments): unknown;
  install(wrapper: LocaleTranslate): LocaleInstallResult;
  restoreOriginalIfCurrent(
    wrapper: LocaleTranslate,
  ): AdapterResult<"restored" | "replaced">;
}

function failure<T>(): AdapterResult<T> {
  return { ok: false };
}

export function adaptDshLocaleRuntime(
  value: unknown,
): DshLocaleRuntimeAdapter | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  let translate: unknown;
  let getSnapshot: unknown;
  let subscribe: unknown;
  let originalTranslateDescriptor: PropertyDescriptor | undefined;
  try {
    translate = Reflect.get(value, "translate");
    getSnapshot = Reflect.get(value, "getSnapshot");
    subscribe = Reflect.get(value, "subscribe");
    originalTranslateDescriptor = Reflect.getOwnPropertyDescriptor(
      value,
      "translate",
    );
  } catch {
    return undefined;
  }
  if (
    typeof translate !== "function" ||
    typeof getSnapshot !== "function" ||
    typeof subscribe !== "function"
  ) {
    return undefined;
  }

  const runtime = value;
  const originalTranslate = translate;
  const capturedGetSnapshot = getSnapshot;

  function inspectRestoration(
    wrapper: LocaleTranslate,
  ): "restored" | "replaced" | "failed" {
    try {
      const current = Reflect.get(runtime, "translate");
      if (current === originalTranslate) return "restored";
      if (current === wrapper) return "failed";
      return "replaced";
    } catch {
      return "failed";
    }
  }

  function restoreOriginalTranslate(
    wrapper: LocaleTranslate,
  ): "restored" | "replaced" | "failed" {
    try {
      if (originalTranslateDescriptor === undefined) {
        const installedDescriptor = Reflect.getOwnPropertyDescriptor(
          runtime,
          "translate",
        );
        if (installedDescriptor === undefined) {
          if (!Reflect.set(runtime, "translate", originalTranslate)) {
            return inspectRestoration(wrapper);
          }
        } else if (!Reflect.deleteProperty(runtime, "translate")) {
          return inspectRestoration(wrapper);
        }
      } else if ("value" in originalTranslateDescriptor) {
        if (
          !Reflect.defineProperty(
            runtime,
            "translate",
            originalTranslateDescriptor,
          )
        ) {
          return inspectRestoration(wrapper);
        }
      } else {
        if (!Reflect.set(runtime, "translate", originalTranslate)) {
          return inspectRestoration(wrapper);
        }
        if (
          !Reflect.defineProperty(
            runtime,
            "translate",
            originalTranslateDescriptor,
          )
        ) {
          return inspectRestoration(wrapper);
        }
      }
      return inspectRestoration(wrapper);
    } catch {
      return inspectRestoration(wrapper);
    }
  }

  return {
    runtime,
    getActiveLocale(): AdapterResult<string> {
      try {
        const snapshot = Reflect.apply(capturedGetSnapshot, runtime, []);
        if (typeof snapshot !== "object" || snapshot === null) return failure();
        const active = Reflect.get(snapshot, "active");
        return typeof active === "string"
          ? { ok: true, value: active }
          : failure();
      } catch {
        return failure();
      }
    },
    callOriginal(args): unknown {
      return Reflect.apply(originalTranslate, runtime, args);
    },
    install(wrapper): LocaleInstallResult {
      const inspectCurrent = ():
        "wrapper" | "original" | "foreign" | "unknown" => {
        try {
          const current = Reflect.get(runtime, "translate");
          if (current === wrapper) return "wrapper";
          if (current === originalTranslate) return "original";
          return "foreign";
        } catch {
          return "unknown";
        }
      };
      const failedInstall = (): LocaleInstallResult => {
        const beforeRollback = inspectCurrent();
        if (beforeRollback === "wrapper") {
          const restoration = restoreOriginalTranslate(wrapper);
          return {
            ok: false,
            runtimeMayBePatched: restoration === "failed",
          };
        }
        return {
          ok: false,
          runtimeMayBePatched: beforeRollback === "unknown",
        };
      };
      try {
        if (!Reflect.set(runtime, "translate", wrapper)) {
          return failedInstall();
        }
        if (Reflect.get(runtime, "translate") !== wrapper) {
          return failedInstall();
        }
        return { ok: true };
      } catch {
        return failedInstall();
      }
    },
    restoreOriginalIfCurrent(wrapper): AdapterResult<"restored" | "replaced"> {
      try {
        if (Reflect.get(runtime, "translate") !== wrapper) {
          return { ok: true, value: "replaced" };
        }
        const restoration = restoreOriginalTranslate(wrapper);
        return restoration === "failed"
          ? failure()
          : { ok: true, value: restoration };
      } catch {
        return failure();
      }
    },
  };
}
