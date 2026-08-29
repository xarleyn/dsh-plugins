import {
  adaptDshLocaleRuntime,
  type LocaleTranslate,
} from "../adapters/dsh-locale-runtime.js";
import { Diagnostics } from "../registry/diagnostics.js";
import { TranslationPackRegistry } from "../registry/translation-registry.js";
import { interpolate } from "./interpolate.js";

const installedHooks = new WeakMap<object, LocaleTranslate>();

export function installLocaleHook(
  runtime: unknown,
  registry: TranslationPackRegistry,
  diagnostics: Diagnostics,
): () => boolean {
  const adapter = adaptDshLocaleRuntime(runtime);
  if (adapter === undefined) {
    diagnostics.error(
      "incompatible_locale_runtime",
      "The DSH locale runtime is incompatible; locale overrides were not installed.",
    );
    return () => true;
  }
  if (installedHooks.has(adapter.runtime)) {
    diagnostics.warning(
      "duplicate_locale_hook",
      "A locale override hook is already installed on this DSH runtime.",
    );
    return () => true;
  }

  let snapshotFailureDiagnosed = false;
  const wrapper: LocaleTranslate = function (...args): unknown {
    const [namespace, key, params] = args;
    const locale = adapter.getActiveLocale();
    if (!locale.ok && !snapshotFailureDiagnosed) {
      snapshotFailureDiagnosed = true;
      diagnostics.error(
        "locale_snapshot_failed",
        "The active DSH locale could not be read; the original translator will be used.",
      );
    }
    if (locale.ok && locale.value === "en") {
      const entry = registry.resolveEntry(locale.value, namespace, key);
      if (entry !== undefined) {
        diagnostics.debug(
          "locale_override_hit",
          `Locale override hit locale=${locale.value} namespace=${namespace} key=${key} pack=${entry.packId}.`,
        );
        return interpolate(entry.value, params);
      }
    }
    return adapter.callOriginal(args);
  };

  installedHooks.set(adapter.runtime, wrapper);
  const installed = adapter.install(wrapper);
  if (!installed.ok) {
    diagnostics.error(
      "locale_hook_install_failed",
      "The DSH locale translator could not be patched; locale overrides were not installed.",
    );
    if (!installed.runtimeMayBePatched) {
      installedHooks.delete(adapter.runtime);
      return () => true;
    }
  }

  let disposed = false;
  let restoreFailureDiagnosed = false;
  return () => {
    if (disposed) return true;
    const restored = adapter.restoreOriginalIfCurrent(wrapper);
    if (!restored.ok && !restoreFailureDiagnosed) {
      restoreFailureDiagnosed = true;
      diagnostics.error(
        "locale_hook_restore_failed",
        "The DSH locale translator could not be inspected or restored during disposal.",
      );
    }
    if (!restored.ok) {
      return false;
    }
    disposed = true;
    installedHooks.delete(adapter.runtime);
    return true;
  };
}
