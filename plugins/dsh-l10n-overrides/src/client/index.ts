import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import { adaptDshLocaleRuntime } from "../adapters/dsh-locale-runtime.js";
import { translationPacks } from "../packs/index.js";
import { Diagnostics } from "../registry/diagnostics.js";
import { TranslationPackRegistry } from "../registry/translation-registry.js";
import { DomTranslator } from "../runtime/dom-translator.js";
import { installLocaleHook } from "../runtime/locale-hook.js";

export type {
  DomTranslationAttribute,
  DomTranslationRule,
  TranslationPack,
} from "../types.js";

export interface ClientLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface ClientOptions {
  readonly debug?: boolean;
  readonly document?: Document | null;
  readonly logger?: ClientLogger;
}

export const inject = ["locale"];

type CleanupState = "idle" | "running" | "done";

interface CleanupResource {
  state: CleanupState;
  run: () => boolean;
  diagnosed: boolean;
  readonly code: string;
  readonly message: string;
}

interface SharedInstallation {
  refs: number;
  readonly runtimeKey: object | undefined;
  readonly diagnostics: Diagnostics;
  readonly domCleanup: CleanupResource;
  readonly listenerCleanup: CleanupResource;
  readonly localeCleanup: CleanupResource;
}

const sharedInstallations = new WeakMap<object, SharedInstallation>();
const terminalCleanup = (): boolean => true;

function createCleanupResource(code: string, message: string): CleanupResource {
  return {
    state: "done",
    run: terminalCleanup,
    diagnosed: false,
    code,
    message,
  };
}

function armCleanup(resource: CleanupResource, run: () => boolean): void {
  resource.state = "idle";
  resource.run = run;
}

function attemptCleanup(
  installation: SharedInstallation,
  resource: CleanupResource,
): void {
  if (resource.state !== "idle") return;
  resource.state = "running";
  try {
    if (resource.run() === false) {
      resource.state = "idle";
      return;
    }
    resource.state = "done";
    resource.run = terminalCleanup;
  } catch {
    resource.state = "idle";
    if (resource.diagnosed) return;
    resource.diagnosed = true;
    installation.diagnostics.error(resource.code, resource.message);
  }
}

function cleanupInstallation(installation: SharedInstallation): boolean {
  attemptCleanup(installation, installation.domCleanup);
  attemptCleanup(installation, installation.listenerCleanup);
  attemptCleanup(installation, installation.localeCleanup);
  const complete =
    installation.domCleanup.state === "done" &&
    installation.listenerCleanup.state === "done" &&
    installation.localeCleanup.state === "done";
  if (!complete) return false;

  const { runtimeKey } = installation;
  if (
    runtimeKey !== undefined &&
    sharedInstallations.get(runtimeKey) === installation
  ) {
    sharedInstallations.delete(runtimeKey);
  }
  return true;
}

function createLease(installation: SharedInstallation): () => void {
  let released = false;
  let terminal = false;
  return () => {
    if (terminal) return;
    if (!released) {
      released = true;
      installation.refs -= 1;
      if (installation.refs > 0) {
        terminal = true;
        return;
      }
    }
    if (cleanupInstallation(installation)) terminal = true;
  };
}

function selectDocument(options: ClientOptions): Document | undefined {
  if (options.document !== undefined) return options.document ?? undefined;
  return typeof document === "undefined" ? undefined : document;
}

function describeCount(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function apply(ctx: Context, options: ClientOptions = {}): () => void {
  let localeRuntime: unknown;
  try {
    localeRuntime = ctx.locale;
  } catch {
    localeRuntime = undefined;
  }
  const localeAdapter = adaptDshLocaleRuntime(localeRuntime);
  const runtimeKey = localeAdapter?.runtime;
  if (runtimeKey !== undefined) {
    const existing = sharedInstallations.get(runtimeKey);
    if (existing !== undefined) {
      existing.refs += 1;
      return createLease(existing);
    }
  }

  const diagnostics = new Diagnostics(
    options.logger ?? console,
    options.debug === undefined ? {} : { debug: options.debug },
  );
  const registry = new TranslationPackRegistry(diagnostics);
  const installation: SharedInstallation = {
    refs: 1,
    runtimeKey,
    diagnostics,
    domCleanup: createCleanupResource(
      "dom_dispose_failed",
      "DOM translation could not be fully restored during disposal.",
    ),
    listenerCleanup: createCleanupResource(
      "locale_listener_dispose_failed",
      "The locale change listener could not be removed during disposal.",
    ),
    localeCleanup: createCleanupResource(
      "locale_hook_dispose_failed",
      "The locale override hook could not be restored during disposal.",
    ),
  };
  if (runtimeKey !== undefined) {
    sharedInstallations.set(runtimeKey, installation);
  }

  for (const pack of translationPacks) {
    try {
      registry.register(pack);
    } catch {
      diagnostics.error(
        "pack_registration_failed",
        `Pack "${pack.id}" could not be registered and was ignored.`,
      );
    }
  }

  const stats = registry.getStats();
  diagnostics.info(
    "startup_summary",
    `Loaded ${describeCount(stats.packs, "pack", "packs")}, ${describeCount(stats.localeOverrides, "locale override", "locale overrides")}, and ${describeCount(stats.domRules, "DOM rule", "DOM rules")}.`,
  );

  try {
    armCleanup(
      installation.localeCleanup,
      installLocaleHook(localeRuntime, registry, diagnostics),
    );
  } catch {
    diagnostics.error(
      "locale_hook_startup_failed",
      "The locale override hook could not be started.",
    );
  }

  let candidateDocument: Document | undefined;
  try {
    candidateDocument = selectDocument(options);
  } catch {
    candidateDocument = undefined;
  }

  let domAvailable = false;
  if (candidateDocument !== undefined) {
    try {
      domAvailable =
        candidateDocument.body !== null &&
        candidateDocument.defaultView?.MutationObserver !== undefined;
    } catch {}
  }
  if (!domAvailable) {
    diagnostics.warning(
      "dom_unavailable",
      "DOM translation is unavailable; locale overrides remain active.",
    );
  }

  let domTranslator: DomTranslator | undefined;
  if (domAvailable && candidateDocument !== undefined && localeAdapter) {
    try {
      const translator = new DomTranslator(
        candidateDocument,
        registry.getDomRules("en"),
        diagnostics,
      );
      domTranslator = translator;
      armCleanup(installation.domCleanup, () => {
        translator.dispose();
        return true;
      });
    } catch {
      diagnostics.error(
        "dom_startup_failed",
        "DOM translation could not be started; locale overrides remain active.",
      );
    }
  }

  if (domTranslator !== undefined && localeAdapter !== undefined) {
    const initialLocale = localeAdapter.getActiveLocale();
    if (initialLocale.ok) {
      try {
        domTranslator.setLocale(initialLocale.value);
      } catch {
        diagnostics.error(
          "dom_initial_locale_failed",
          "The initial locale could not be applied to DOM translation.",
        );
      }
    } else {
      diagnostics.error(
        "initial_locale_snapshot_failed",
        "The initial locale could not be read; DOM translation was not activated.",
      );
    }
  }

  if (domTranslator !== undefined) {
    let switchingFailureDiagnosed = false;
    try {
      const unsubscribe = ctx.on("locale/change", (snapshot) => {
        try {
          domTranslator?.setLocale(snapshot.active);
        } catch {
          if (switchingFailureDiagnosed) return;
          switchingFailureDiagnosed = true;
          diagnostics.error(
            "locale_switch_failed",
            "A locale change could not be applied to DOM translation.",
          );
        }
      });
      if (typeof unsubscribe === "function") {
        armCleanup(installation.listenerCleanup, () => {
          unsubscribe();
          return true;
        });
      } else {
        diagnostics.error(
          "locale_listener_failed",
          "The locale change listener could not be registered; DOM language switching is disabled.",
        );
      }
    } catch {
      diagnostics.error(
        "locale_listener_failed",
        "The locale change listener could not be registered; DOM language switching is disabled.",
      );
    }
  }

  return createLease(installation);
}
