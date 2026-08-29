// @vitest-environment jsdom

import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply } from "../src/client/index.js";
import example from "../src/packs/example.js";
import { translationPacks } from "../src/packs/index.js";

type LocaleId = "en" | "zh";
type LocaleChangeListener = (snapshot: {
  active: LocaleId;
  locales: readonly { id: LocaleId; label: string }[];
  revision: number;
}) => void;

class FakeLocaleRuntime {
  active: LocaleId;
  revision = 0;

  constructor(active: LocaleId) {
    this.active = active;
  }

  translate(namespace: string, key: string): string {
    return `original:${this.active}:${namespace}:${key}`;
  }

  getSnapshot() {
    return {
      active: this.active,
      locales: [
        { id: "zh" as const, label: "Chinese" },
        { id: "en" as const, label: "English" },
      ],
      revision: this.revision,
    };
  }

  subscribe(): () => void {
    return () => undefined;
  }

  bind(namespace: string): (key: string) => string {
    return (key) => this.translate(namespace, key);
  }
}

interface ContextOptions {
  readonly onThrows?: boolean;
  readonly unsubscribeThrowsBeforeRemoveOnce?: boolean;
  readonly onUnsubscribe?: () => void;
}

function createContext(
  locale: FakeLocaleRuntime | unknown,
  options: ContextOptions = {},
) {
  const listeners = new Set<LocaleChangeListener>();
  let registrations = 0;
  let unsubscribeAttempts = 0;
  const ctx = {
    locale,
    on(event: string, next: LocaleChangeListener): () => boolean {
      expect(event).toBe("locale/change");
      registrations += 1;
      if (options.onThrows === true) throw new Error("listener unavailable");
      listeners.add(next);
      let shouldThrowBeforeRemove =
        options.unsubscribeThrowsBeforeRemoveOnce === true;
      return () => {
        unsubscribeAttempts += 1;
        options.onUnsubscribe?.();
        if (shouldThrowBeforeRemove) {
          shouldThrowBeforeRemove = false;
          throw new Error("unsubscribe unavailable");
        }
        return listeners.delete(next);
      };
    },
  };

  return {
    ctx: ctx as unknown as Context,
    emit(active: LocaleId): void {
      if (locale instanceof FakeLocaleRuntime) {
        locale.active = active;
        locale.revision += 1;
        for (const listener of listeners) listener(locale.getSnapshot());
      }
    },
    get registrations(): number {
      return registrations;
    },
    get listenerCount(): number {
      return listeners.size;
    },
    get unsubscribeAttempts(): number {
      return unsubscribeAttempts;
    },
  };
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("client composition", () => {
  it("activates English locale and existing DOM overrides", () => {
    document.body.innerHTML =
      '<section data-plugin="example-plugin"><button>设置</button></section>';
    const locale = new FakeLocaleRuntime("en");
    const bound = locale.bind("example.settings");
    const original = locale.translate;
    const boundary = createContext(locale);

    const dispose = apply(boundary.ctx, {
      document,
      logger: createLogger(),
    });

    expect(bound("title")).toBe("Settings");
    expect(bound("missing")).toBe("original:en:example.settings:missing");
    expect(document.querySelector("button")?.textContent).toBe("Settings");

    dispose();
    expect(locale.translate).toBe(original);
  });

  it.each(["first", "second"] as const)(
    "shares one installation when the %s lease is released first",
    async (releasedFirst) => {
      const NativeMutationObserver = window.MutationObserver;
      let observerConstructions = 0;
      class CountingMutationObserver extends NativeMutationObserver {
        constructor(callback: MutationCallback) {
          observerConstructions += 1;
          super(callback);
        }
      }
      vi.stubGlobal("MutationObserver", CountingMutationObserver);
      document.body.innerHTML =
        '<section data-plugin="example-plugin"><button>设置</button></section>';
      const locale = new FakeLocaleRuntime("en");
      const original = locale.translate;
      const boundary = createContext(locale);
      const firstLogger = createLogger();
      const secondLogger = createLogger();

      const first = apply(boundary.ctx, { document, logger: firstLogger });
      const installed = locale.translate;
      const second = apply(boundary.ctx, { document, logger: secondLogger });

      expect(locale.translate).toBe(installed);
      expect(boundary.registrations).toBe(1);
      expect(boundary.listenerCount).toBe(1);
      expect(observerConstructions).toBe(1);
      expect(firstLogger.info).toHaveBeenCalledTimes(1);
      expect(secondLogger.info).not.toHaveBeenCalled();

      const early = releasedFirst === "first" ? first : second;
      const last = releasedFirst === "first" ? second : first;
      early();

      expect(locale.translate("example.settings", "title")).toBe("Settings");
      expect(boundary.listenerCount).toBe(1);
      const added = document.createElement("span");
      added.textContent = "设置";
      document.querySelector("section")?.append(added);
      await flushMutations();
      expect(added.textContent).toBe("Settings");

      last();
      expect(locale.translate).toBe(original);
      expect(boundary.listenerCount).toBe(0);
      expect(document.querySelector("button")?.textContent).toBe("设置");
      expect(added.textContent).toBe("设置");

      const fresh = apply(boundary.ctx, {
        document,
        logger: createLogger(),
      });
      expect(locale.translate).not.toBe(original);
      expect(boundary.registrations).toBe(2);
      expect(boundary.listenerCount).toBe(1);
      expect(observerConstructions).toBe(2);
      fresh();
    },
  );

  it("retries a listener disposer that throws before removing its listener", () => {
    document.body.innerHTML =
      '<section data-plugin="example-plugin"><button>设置</button></section>';
    const locale = new FakeLocaleRuntime("en");
    const original = locale.translate;
    const boundary = createContext(locale, {
      unsubscribeThrowsBeforeRemoveOnce: true,
    });
    const logger = createLogger();
    const dispose = apply(boundary.ctx, { document, logger });

    dispose();
    expect(boundary.unsubscribeAttempts).toBe(1);
    expect(boundary.listenerCount).toBe(1);
    expect(locale.translate).toBe(original);
    expect(document.querySelector("button")?.textContent).toBe("设置");

    dispose();
    expect(boundary.unsubscribeAttempts).toBe(2);
    expect(boundary.listenerCount).toBe(0);
    expect(locale.translate).toBe(original);
    expect(document.querySelector("button")?.textContent).toBe("设置");
    dispose();
    expect(boundary.unsubscribeAttempts).toBe(2);
    expect(logger.error).toHaveBeenCalledTimes(1);

    const fresh = apply(boundary.ctx, { document, logger: createLogger() });
    expect(boundary.registrations).toBe(2);
    expect(boundary.listenerCount).toBe(1);
    expect(locale.translate("example.settings", "title")).toBe("Settings");
    fresh();
    fresh();
    expect(boundary.listenerCount).toBe(0);
  });

  it("contains a reentrant lease disposal during listener cleanup", () => {
    const locale = new FakeLocaleRuntime("en");
    let reenter = (): void => undefined;
    const boundary = createContext(locale, {
      onUnsubscribe: () => reenter(),
    });
    const first = apply(boundary.ctx, {
      document,
      logger: createLogger(),
    });
    const second = apply(boundary.ctx, {
      document,
      logger: createLogger(),
    });

    first();
    expect(boundary.unsubscribeAttempts).toBe(0);
    expect(boundary.listenerCount).toBe(1);
    reenter = second;
    second();

    expect(boundary.registrations).toBe(1);
    expect(boundary.unsubscribeAttempts).toBe(1);
    expect(boundary.listenerCount).toBe(0);
    expect(locale.translate("example.settings", "title")).toBe(
      "original:en:example.settings:title",
    );
    second();
    expect(boundary.unsubscribeAttempts).toBe(1);
  });

  it("follows the public locale/change snapshot and restores Chinese DOM", () => {
    document.body.innerHTML =
      '<section data-plugin="example-plugin"><button>设置</button></section>';
    const locale = new FakeLocaleRuntime("zh");
    const boundary = createContext(locale);
    const dispose = apply(boundary.ctx, {
      document,
      logger: createLogger(),
    });

    expect(locale.translate("example.settings", "title")).toBe(
      "original:zh:example.settings:title",
    );
    expect(document.querySelector("button")?.textContent).toBe("设置");

    boundary.emit("en");
    expect(locale.getSnapshot().active).toBe("en");
    expect(locale.translate("example.settings", "title")).toBe("Settings");
    expect(document.querySelector("button")?.textContent).toBe("Settings");

    boundary.emit("zh");
    expect(locale.getSnapshot().active).toBe("zh");
    expect(locale.translate("example.settings", "title")).toBe(
      "original:zh:example.settings:title",
    );
    expect(document.querySelector("button")?.textContent).toBe("设置");

    dispose();
  });

  it("translates dynamic DOM and fully stops after disposal", async () => {
    document.body.innerHTML =
      '<section data-plugin="example-plugin"></section>';
    const locale = new FakeLocaleRuntime("en");
    const original = locale.translate;
    const boundary = createContext(locale);
    const dispose = apply(boundary.ctx, {
      document,
      logger: createLogger(),
    });
    const button = document.createElement("button");
    button.textContent = "设置";
    document.querySelector("section")?.append(button);
    await flushMutations();
    expect(button.textContent).toBe("Settings");

    dispose();
    expect(button.textContent).toBe("设置");
    expect(boundary.unsubscribeAttempts).toBe(1);
    expect(boundary.listenerCount).toBe(0);
    expect(locale.translate).toBe(original);

    boundary.emit("en");
    const later = document.createElement("span");
    later.textContent = "设置";
    document.querySelector("section")?.append(later);
    await flushMutations();
    expect(later.textContent).toBe("设置");
    expect(locale.translate("example.settings", "title")).toBe(
      "original:en:example.settings:title",
    );

    expect(() => dispose()).not.toThrow();
    expect(boundary.unsubscribeAttempts).toBe(1);
  });

  it("retries a transient locale-hook restoration failure", () => {
    const target = new FakeLocaleRuntime("en");
    const original = target.translate;
    let failTranslateReads = false;
    const locale = new Proxy(target, {
      get(current, property, receiver): unknown {
        if (property === "translate" && failTranslateReads) {
          throw new Error("translate unavailable");
        }
        return Reflect.get(current, property, receiver);
      },
    });
    const boundary = createContext(locale);
    const logger = createLogger();
    const dispose = apply(boundary.ctx, { document, logger });
    const installed = target.translate;
    expect(installed).not.toBe(original);

    failTranslateReads = true;
    dispose();
    expect(target.translate).toBe(installed);
    expect(boundary.unsubscribeAttempts).toBe(1);

    failTranslateReads = false;
    dispose();
    expect(target.translate).toBe(original);
    expect(boundary.unsubscribeAttempts).toBe(1);
  });

  it("fails open for an incompatible locale runtime", () => {
    document.body.innerHTML =
      '<section data-plugin="example-plugin"><button>设置</button></section>';
    const incompatible = {
      translate: vi.fn(() => "original"),
    };
    const original = incompatible.translate;
    const boundary = createContext(incompatible);
    const logger = createLogger();

    const dispose = apply(boundary.ctx, { document, logger });

    expect(incompatible.translate).toBe(original);
    expect(document.querySelector("button")?.textContent).toBe("设置");
    expect(boundary.registrations).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("locale runtime is incompatible"),
    );
    expect(dispose).not.toThrow();
  });

  it("keeps locale overrides when DOM is unavailable", () => {
    const locale = new FakeLocaleRuntime("en");
    const boundary = createContext(locale);
    const logger = createLogger();

    const dispose = apply(boundary.ctx, { document: null, logger });

    expect(locale.translate("example.settings", "title")).toBe("Settings");
    expect(boundary.registrations).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("DOM translation is unavailable"),
    );
    dispose();
    expect(locale.translate("example.settings", "title")).toBe(
      "original:en:example.settings:title",
    );
  });

  it("contains listener registration and unsubscription failures", () => {
    document.body.innerHTML =
      '<section data-plugin="example-plugin"><button>设置</button></section>';
    const registrationLocale = new FakeLocaleRuntime("en");
    const registrationBoundary = createContext(registrationLocale, {
      onThrows: true,
    });
    const registrationLogger = createLogger();
    const disposeRegistration = apply(registrationBoundary.ctx, {
      document,
      logger: registrationLogger,
    });
    expect(registrationLocale.translate("example.settings", "title")).toBe(
      "Settings",
    );
    expect(document.querySelector("button")?.textContent).toBe("Settings");
    expect(registrationLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("locale change listener"),
    );
    expect(disposeRegistration).not.toThrow();
    expect(document.querySelector("button")?.textContent).toBe("设置");

    const unsubscribeLocale = new FakeLocaleRuntime("en");
    const unsubscribeBoundary = createContext(unsubscribeLocale, {
      unsubscribeThrowsBeforeRemoveOnce: true,
    });
    const unsubscribeLogger = createLogger();
    const original = unsubscribeLocale.translate;
    const disposeUnsubscribe = apply(unsubscribeBoundary.ctx, {
      document,
      logger: unsubscribeLogger,
    });
    expect(disposeUnsubscribe).not.toThrow();
    expect(unsubscribeLocale.translate).toBe(original);
    expect(document.querySelector("button")?.textContent).toBe("设置");
    expect(unsubscribeLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("locale change listener could not be removed"),
    );
    disposeUnsubscribe();
    expect(unsubscribeBoundary.listenerCount).toBe(0);
  });

  it("logs one startup summary and gates override-hit diagnostics on debug", () => {
    const quietLocale = new FakeLocaleRuntime("en");
    const quietLogger = createLogger();
    const quietDispose = apply(createContext(quietLocale).ctx, {
      document: null,
      logger: quietLogger,
    });
    quietLocale.translate("example.settings", "title");
    expect(quietLogger.info).toHaveBeenCalledTimes(1);
    expect(quietLogger.info).toHaveBeenCalledWith(
      "[dsh-l10n-overrides] Loaded 1 pack, 4 locale overrides, and 1 DOM rule.",
    );
    expect(quietLogger.debug).not.toHaveBeenCalled();
    quietDispose();

    const debugLocale = new FakeLocaleRuntime("en");
    const debugLogger = createLogger();
    const debugDispose = apply(createContext(debugLocale).ctx, {
      debug: true,
      document: null,
      logger: debugLogger,
    });
    debugLocale.translate("example.settings", "title");
    expect(debugLogger.debug).toHaveBeenCalledTimes(1);
    expect(debugLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Locale override hit"),
    );
    debugDispose();
  });
});

describe("built-in translation packs", () => {
  it("exports the exact frozen example pack", () => {
    expect(translationPacks).toEqual([example]);
    expect(example).toEqual({
      id: "example-plugin-en",
      target: {
        package: "dsh-example-plugin",
        versions: ">=0.4.0 <1.0.0",
      },
      en: {
        "example.settings": {
          title: "Settings",
          enabled: "Enabled",
          server: "Server address",
          save: "Save",
        },
      },
      dom: [
        {
          scope: '[data-plugin="example-plugin"]',
          source: "设置",
          target: "Settings",
        },
      ],
      metadata: {
        sourceLanguage: "zh",
        description: "Example English translation pack",
      },
    });
    for (const value of [
      translationPacks,
      example,
      example.target,
      example.en,
      example.en["example.settings"],
      example.dom,
      example.dom[0],
      example.metadata,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
