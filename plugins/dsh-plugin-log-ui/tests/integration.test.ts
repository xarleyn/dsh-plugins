import { Context } from "@deepseek-ai/cordis";
import { readFileSync } from "node:fs";
import { createPluginLogger } from "@yadsh/dsh-plugin-log";
import { afterEach, describe, expect, it } from "vitest";
import PluginLogUi, { PLUGIN_LOG_ENTRY_ID } from "../src/index.js";
import { ConfigSchema } from "../src/config.js";
import type {
  ManagedPluginLogLevel,
  PluginLogUiConfig,
  VolatilePluginLogUiConfig,
} from "../src/types.js";

const loggers: Array<ReturnType<typeof createPluginLogger>> = [];
const fibers: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(loggers.splice(0).map((logger) => logger.close()));
  await Promise.all(
    fibers
      .splice(0)
      .reverse()
      .map((fiber) => fiber.dispose()),
  );
});

/**
 * Boot the plugin with a resolved profile config, the way the Loader does: the
 * `0.1.7` Host hands every field of a volatile Config as a live reference, so
 * what a caller passes here is the plain section and what the service receives
 * is the resolved one.
 */
async function configuredContext(
  config: PluginLogUiConfig = {},
): Promise<Context> {
  const ctx = new Context();
  const uiFiber = ctx.plugin(PluginLogUi, config);
  fibers.push(uiFiber);
  await uiFiber;
  return ctx;
}

function logger(pluginId: string) {
  const created = createPluginLogger({
    pluginId,
    file: false,
    console: "silent",
    level: "trace",
    format: "json",
  });
  loggers.push(created);
  return created;
}

describe("plugin log UI integration", () => {
  it("publishes every Config field as a live form field", () => {
    // `0.1.7` has no namespace registration left to assert: a field is
    // browser-editable exactly when its schema node carries `.volatile()`, and
    // resolving the schema is what turns that mark into a reference. Without the
    // marks these reads would be plain values and `.get()` would not be there.
    const resolved = ConfigSchema({ defaultLevel: "warn" });
    expect(resolved.defaultLevel.get()).toBe("warn");
    expect(resolved.format.get()).toBe("text");
    expect(resolved.levels.get()).toEqual({});
  });

  it("files its live Config under the profile entry id the card looks up", () => {
    // The settings namespace is now the Loader entry id, so the string the
    // browser resolves its form by has to stay the row this bundle declares.
    const patch = readFileSync(
      new URL("../cordis.patch.yml", import.meta.url),
      "utf8",
    );
    expect(patch).toContain(`id: ${PLUGIN_LOG_ENTRY_ID}`);
  });

  it("applies defaults to loggers registered later and discovers them", async () => {
    const ctx = await configuredContext();
    const created = logger("dsh-late-logger");

    expect(created.level).toBe("info");
    expect(created.format).toBe("text");
    expect(ctx.pluginLogUi.inspect()).toEqual({
      consumers: [
        {
          pluginId: "dsh-late-logger",
          level: "info",
          format: "text",
          instances: 1,
        },
        {
          pluginId: "dsh-plugin-log-ui",
          level: "info",
          format: "text",
          instances: 1,
        },
      ],
    });
  });

  it("applies configured overrides to registered loggers", async () => {
    await configuredContext({
      defaultLevel: "warn",
      format: "json",
      levels: { "dsh-special": "debug" },
    });
    const special = logger("dsh-special");
    const regular = logger("dsh-regular");

    expect(special.level).toBe("debug");
    expect(regular.level).toBe("warn");
    expect(special.format).toBe("json");
  });

  it("re-reads each live reference per operation, so a later edit applies", async () => {
    // The Host edits a volatile field by moving the reference under it, never by
    // rebuilding the service. This is the same shape, so a config captured once
    // at construction — the mistake the old `setSource` callback papered over —
    // would leave the second assertion reading `info`.
    let defaultLevel: ManagedPluginLogLevel = "info";
    const ctx = new Context();
    const ui = new PluginLogUi(ctx, {
      defaultLevel: { get: () => defaultLevel },
      format: { get: () => "text" },
      levels: { get: () => ({}) },
    } satisfies VolatilePluginLogUiConfig);
    const created = logger("dsh-live-logger");
    expect(created.level).toBe("info");

    defaultLevel = "error";
    // The card's poll is what carries the change: `inspect` applies the policy
    // it reads at that moment.
    ui.inspect();
    expect(created.level).toBe("error");
    expect(ui.getConfig().defaultLevel).toBe("error");
  });

  it("serves the live record stream the panel reads", async () => {
    const ctx = await configuredContext({ defaultLevel: "trace" });
    const created = logger("dsh-stream");
    // The stream carries every logger in the process, this plugin's own
    // diagnostics included, so a reader narrows it by plugin.
    const mine = (cursor: number) =>
      ctx.pluginLogUi
        .tail(cursor, 10)
        .records.filter((record) => record.pluginId === "dsh-stream");

    created.info("stream.first", { attempt: 1 });
    created.child("worker").warn("stream.second");

    const read = ctx.pluginLogUi.tail(0, 10);
    expect(
      mine(0).map((record) => [record.level, record.module, record.event]),
    ).toEqual([
      ["info", "", "stream.first"],
      ["warn", "worker", "stream.second"],
    ]);
    expect(mine(0)[0]?.fields).toEqual([{ key: "attempt", value: "1" }]);

    // The cursor is what makes the panel's poll incremental.
    expect(mine(read.cursor)).toEqual([]);
    created.info("stream.third");
    expect(mine(read.cursor).map((record) => record.event)).toEqual([
      "stream.third",
    ]);
  });

  it("renders arbitrary field values instead of shipping them across the Remote", async () => {
    const ctx = await configuredContext({ defaultLevel: "trace" });
    const created = logger("dsh-fields");
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;

    created.info("stream.fields", {
      cyclic,
      failure: new Error("boom"),
      list: [1, 2],
    });

    const [record] = ctx.pluginLogUi
      .tail(0, 10)
      .records.filter((entry) => entry.pluginId === "dsh-fields");
    expect(record?.fields).toEqual([
      // A self-referencing object terminates at the depth limit instead of
      // cycling: the panel draws a string, and the wire carries one.
      {
        key: "cyclic",
        value:
          "{name: loop, self: {name: loop, self: {name: loop, self: {…}}}}",
      },
      { key: "failure", value: "Error: boom" },
      { key: "list", value: "[1, 2]" },
    ]);
  });

  it("keeps a redacted field out of the panel view the bus feeds", async () => {
    const ctx = await configuredContext({ defaultLevel: "trace" });
    const created = createPluginLogger({
      pluginId: "dsh-redacted",
      file: false,
      console: "silent",
      level: "trace",
      redact: ["apiKey", "headers.*"],
    });
    loggers.push(created);

    created.info("stream.secret", {
      apiKey: "sk-synthetic-secret",
      headers: { authorization: "sk-synthetic-secret" },
      kept: "visible",
    });

    // The bus hands the panel what the logger recorded, redaction included, so
    // a secret the plugin configured away is never rendered and never shipped.
    const [record] = ctx.pluginLogUi
      .tail(0, 10)
      .records.filter((entry) => entry.pluginId === "dsh-redacted");
    expect(record?.fields).toEqual([
      { key: "apiKey", value: "[Redacted]" },
      { key: "headers", value: "{authorization: [Redacted]}" },
      { key: "kept", value: "visible" },
    ]);
  });
});
