import { describe, expect, it, vi } from "vitest";
import { Diagnostics } from "../src/registry/diagnostics.js";
import type {
  DiagnosticEntry,
  DiagnosticLevel,
  DomTranslationAttribute,
  DomTranslationRule,
  TranslationPack,
} from "../src/types.js";

describe("pack contracts", () => {
  it("accepts translation, DOM, metadata, and diagnostic declarations", () => {
    const attribute: DomTranslationAttribute = "aria-label";
    const rule = {
      source: "Enviar",
      target: "Send",
      scope: ".composer",
      mode: "exact",
      attributes: [attribute],
    } as const satisfies DomTranslationRule;
    const pack = {
      id: "example",
      target: { package: "example-plugin", versions: ">=1 <2" },
      en: { example: { submit: "Send" } },
      dom: [rule],
      metadata: {
        sourceLanguage: "es",
        description: "Example translations",
        upstream: "https://example.invalid/plugin",
      },
    } as const satisfies TranslationPack;
    const levels: readonly DiagnosticLevel[] = [
      "info",
      "warning",
      "error",
      "debug",
    ];

    expect(pack.en.example.submit).toBe("Send");
    expect(levels).toEqual(["info", "warning", "error", "debug"]);
  });
});

describe("Diagnostics", () => {
  it("collects info entries and prefixes info output", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const diagnostics = new Diagnostics(logger);

    diagnostics.info("loaded", "pack loaded");

    expect(diagnostics.snapshot()).toEqual([
      { level: "info", code: "loaded", message: "pack loaded" },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      "[dsh-l10n-overrides] pack loaded",
    );
  });

  it("maps warning entries to warn output", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const diagnostics = new Diagnostics(logger);

    diagnostics.warning("global_scope", "global scope used");

    expect(diagnostics.snapshot()).toEqual([
      { level: "warning", code: "global_scope", message: "global scope used" },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      "[dsh-l10n-overrides] global scope used",
    );
  });

  it("maps error entries to error output", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const diagnostics = new Diagnostics(logger);

    diagnostics.error("incompatible", "runtime incompatible");

    expect(diagnostics.snapshot()).toEqual([
      { level: "error", code: "incompatible", message: "runtime incompatible" },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      "[dsh-l10n-overrides] runtime incompatible",
    );
  });

  it("ignores debug diagnostics when debug mode is disabled", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const diagnostics = new Diagnostics(logger);

    diagnostics.debug("lookup", "translation hit");

    expect(diagnostics.snapshot()).toEqual([]);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("collects and outputs debug diagnostics when debug mode is enabled", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const diagnostics = new Diagnostics(logger, { debug: true });

    diagnostics.debug("lookup", "translation hit");

    expect(diagnostics.snapshot()).toEqual([
      { level: "debug", code: "lookup", message: "translation hit" },
    ]);
    expect(logger.debug).toHaveBeenCalledWith(
      "[dsh-l10n-overrides] translation hit",
    );
  });

  it("does not enable debug when the caller later mutates its options object", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const options: { debug?: boolean } = { debug: false };
    const diagnostics = new Diagnostics(logger, options);

    options.debug = true;
    diagnostics.debug("lookup", "translation hit");

    expect(diagnostics.snapshot()).toEqual([]);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("preserves diagnostic call order in snapshots", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const diagnostics = new Diagnostics(logger, { debug: true });

    diagnostics.warning("first", "one");
    diagnostics.info("second", "two");
    diagnostics.debug("third", "three");
    diagnostics.error("fourth", "four");

    expect(diagnostics.snapshot().map(({ code }) => code)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
  });

  it("collects entries without propagating logger failures", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(() => {
        throw new Error("logger unavailable");
      }),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const diagnostics = new Diagnostics(logger);

    expect(() =>
      diagnostics.warning("startup", "degraded startup"),
    ).not.toThrow();
    expect(diagnostics.snapshot()).toEqual([
      { level: "warning", code: "startup", message: "degraded startup" },
    ]);
  });

  it("returns a frozen defensive snapshot", () => {
    const diagnostics = new Diagnostics({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    });
    diagnostics.info("loaded", "original");

    const snapshot = diagnostics.snapshot();
    const extra: DiagnosticEntry = {
      level: "error",
      code: "extra",
      message: "extra",
    };

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(() => (snapshot as DiagnosticEntry[]).push(extra)).toThrow();
    expect(() => {
      (snapshot[0] as { message: string }).message = "changed";
    }).toThrow();
    expect(diagnostics.snapshot()).toEqual([
      { level: "info", code: "loaded", message: "original" },
    ]);
  });

  it("uses the console logger by default", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      new Diagnostics().info("loaded", "default logger");
      expect(info).toHaveBeenCalledWith("[dsh-l10n-overrides] default logger");
    } finally {
      info.mockRestore();
    }
  });
});
