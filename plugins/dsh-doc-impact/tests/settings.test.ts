import { describe, expect, it } from "vitest";
import {
  ConfigSchema,
  SETTINGS_DEFAULTS,
  plainEntryConfig,
  readLiveConfig,
  resolvePluginConfig,
} from "../src/dsh/plugin-config.js";
import { RESOLUTION_MODES } from "../src/config/types.js";
import {
  FIELDS,
  MODE_OPTIONS,
  ON_LIMIT_OPTIONS,
} from "../src/client/settings-form.js";

/** One live reference, as the Host hands a `.volatile()` node to `apply()`. */
function ref<T>(value: T) {
  return { get: () => value };
}

/** The schema node one config path addresses. */
function nodeAt(path: readonly string[]): any {
  let node: any = ConfigSchema;
  for (const key of path) {
    node = node?.dict?.[key];
    if (node === undefined) return undefined;
  }
  return node;
}

/** The literal values one schema union node accepts. */
function vocabularyOf(node: any): unknown[] {
  return (node?.list ?? []).map((literal: any) => literal.value);
}

describe("entry config schema", () => {
  // The card addresses flat field names while the namespace document keeps the
  // nested profile shape, and a field the Host does not hand as a live
  // reference silently stops being editable. This is the pairing that breaks
  // without either half noticing, so it is pinned here rather than trusted.
  it("addresses every card field by exactly one live schema node", () => {
    for (const spec of FIELDS) {
      const path: readonly string[] = spec.path;
      let lived = 0;
      for (let depth = 1; depth <= path.length; depth++) {
        const node = nodeAt(path.slice(0, depth));
        expect(
          node,
          `config schema has no ${path.slice(0, depth).join(".")}`,
        ).toBeDefined();
        if (node.meta?.volatile === true) lived += 1;
      }
      expect(lived, `${path.join(".")} is not a live field`).toBe(1);
    }
  });

  // The card repeats the defaults and the vocabularies because the browser
  // bundle may not import this schema, and `clearedValue` shows that repeat to
  // the operator as the field's default right after a reset. Drift here is
  // visible on screen, so it is pinned against the schema node instead.
  it("falls back to the default the schema declares", () => {
    for (const spec of FIELDS) {
      const node = nodeAt(spec.path);
      expect(node.meta.default, `${spec.field} schema default`).toBe(
        SETTINGS_DEFAULTS[spec.field],
      );
      expect(spec.fallback, `${spec.field} card fallback`).toBe(
        SETTINGS_DEFAULTS[spec.field],
      );
    }
  });

  it("offers exactly the values the schema accepts", () => {
    let choices = 0;
    for (const spec of FIELDS) {
      if (spec.kind !== "choice") continue;
      choices += 1;
      expect(vocabularyOf(nodeAt(spec.path)), spec.field).toEqual([
        ...spec.options,
      ]);
    }
    expect(choices).toBe(2);
  });

  it("keeps the card vocabularies equal to the schema's", () => {
    expect([...MODE_OPTIONS]).toEqual([...RESOLUTION_MODES]);
    expect(vocabularyOf(nodeAt(["defaults", "mode"]))).toEqual([
      ...MODE_OPTIONS,
    ]);
    expect(vocabularyOf(nodeAt(["safety", "onLimit"]))).toEqual([
      ...ON_LIMIT_OPTIONS,
    ]);
  });
});

describe("live entry config", () => {
  it("reads each reference once into the declared profile shape", () => {
    expect(
      plainEntryConfig({
        enabled: ref(false),
        configFile: ref(".dsh/other.yml"),
        steer: ref(true),
        debug: ref(true),
        reminderTemplate: ref("Check: {body}"),
        limitTemplate: ref("Limit:\n{impacts}"),
        defaults: ref({ mode: "require-review" }),
        safety: ref({ maxReminderRounds: 5, onLimit: "warn" }),
        changeDetection: ref({ maxSnapshotFiles: 500 }),
      }),
    ).toEqual({
      enabled: false,
      configFile: ".dsh/other.yml",
      steer: true,
      debug: true,
      reminderTemplate: "Check: {body}",
      limitTemplate: "Limit:\n{impacts}",
      defaults: { mode: "require-review" },
      safety: { maxReminderRounds: 5, onLimit: "warn" },
      changeDetection: { maxSnapshotFiles: 500 },
    });
  });

  it("keeps an unknown key visible so the strict check can still name it", () => {
    expect(
      resolvePluginConfig.bind(null, plainEntryConfig({ reminders: true })),
    ).toThrow(/unknown key/);
  });

  it("resolves the engine view from live references", () => {
    const config = readLiveConfig({
      enabled: ref(false),
      defaults: ref({ mode: "require-update" }),
      safety: ref({ maxReminderRounds: 4, onLimit: "error" }),
      changeDetection: ref({ maxSnapshotFiles: 7 }),
      debug: ref(true),
    });
    expect(config).toEqual({
      enabled: false,
      configFile: SETTINGS_DEFAULTS.configFile,
      defaultsMode: "require-update",
      safety: { maxReminderRounds: 4, onLimit: "error" },
      maxSnapshotFiles: 7,
      debug: true,
      steer: true,
      reminderTemplate: SETTINGS_DEFAULTS.reminderTemplate,
      limitTemplate: SETTINGS_DEFAULTS.limitTemplate,
    });
  });

  it("carries the steering switch and templates through the live read", () => {
    const config = readLiveConfig({
      steer: ref(false),
      reminderTemplate: ref("Check: {body}"),
      limitTemplate: ref("Limit ({rounds}):\n{impacts}"),
    });
    expect(config.steer).toBe(false);
    expect(config.reminderTemplate).toBe("Check: {body}");
    expect(config.limitTemplate).toBe("Limit ({rounds}):\n{impacts}");
  });

  it("degrades a template without its payload placeholder to the default", () => {
    const degraded = readLiveConfig({
      steer: ref("yes"),
      reminderTemplate: ref("text without payload"),
      limitTemplate: ref(42),
    });
    // Same convention as `enabled`: anything but `true` reads as off.
    expect(degraded.steer).toBe(false);
    expect(degraded.reminderTemplate).toBe(SETTINGS_DEFAULTS.reminderTemplate);
    expect(degraded.limitTemplate).toBe(SETTINGS_DEFAULTS.limitTemplate);
  });

  it("degrades gracefully on missing or malformed nodes", () => {
    expect(readLiveConfig()).toEqual(resolvePluginConfig(undefined));
    const degraded = readLiveConfig({
      configFile: ref(42),
      defaults: ref({ mode: "nonsense" }),
      safety: ref({ maxReminderRounds: -1, onLimit: "maybe" }),
      changeDetection: ref({ maxSnapshotFiles: 1.5 }),
    });
    expect(degraded.configFile).toBe(".dsh/doc-impact.yml");
    expect(degraded.defaultsMode).toBe("remind");
    expect(degraded.safety).toEqual({ maxReminderRounds: 2, onLimit: "allow" });
    expect(degraded.maxSnapshotFiles).toBe(10_000);
  });
});

describe("plugin config validation", () => {
  it("resolves the defaults of an absent config", () => {
    expect(resolvePluginConfig(undefined)).toMatchObject({
      steer: true,
      reminderTemplate: SETTINGS_DEFAULTS.reminderTemplate,
      limitTemplate: SETTINGS_DEFAULTS.limitTemplate,
    });
  });

  it("maps a full profile config into the engine view", () => {
    expect(
      resolvePluginConfig({
        configFile: ".dsh/other.yml",
        defaults: { mode: "require-review" },
        safety: { onLimit: "warn", maxReminderRounds: 5 },
        changeDetection: { maxSnapshotFiles: 500 },
        debug: true,
      }),
    ).toEqual({
      enabled: true,
      configFile: ".dsh/other.yml",
      defaultsMode: "require-review",
      safety: { maxReminderRounds: 5, onLimit: "warn" },
      maxSnapshotFiles: 500,
      debug: true,
      steer: true,
      reminderTemplate: SETTINGS_DEFAULTS.reminderTemplate,
      limitTemplate: SETTINGS_DEFAULTS.limitTemplate,
    });
  });

  it("rejects unknown keys and malformed values loudly", () => {
    expect(() => resolvePluginConfig({ steer: false })).not.toThrow();
    expect(() => resolvePluginConfig({ reminders: true })).toThrow(
      /unknown key/,
    );
    expect(() => resolvePluginConfig({ steer: "off" })).toThrow(
      "steer must be a boolean",
    );
    expect(() => resolvePluginConfig({ reminderTemplate: "   " })).toThrow(
      "reminderTemplate must be a non-empty string",
    );
  });
});
