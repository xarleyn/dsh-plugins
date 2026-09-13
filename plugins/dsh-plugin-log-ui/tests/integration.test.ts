import { Context } from "@deepseek-ai/cordis";
import SettingsProvider, { type SettingsNamespace } from "@deepseek-ai/dsh-settings";
import {
  createPluginLogger,
  getRegisteredPluginLoggers,
} from "@yadsh/dsh-plugin-log";
import { afterEach, describe, expect, it, vi } from "vitest";
import PluginLogUi, { PLUGIN_LOG_SETTINGS_NAMESPACE } from "../src/index.js";

class MemorySettings extends SettingsProvider {
  private readonly storageDocument: Record<string, unknown>;
  override readonly writable = true;

  constructor(ctx: Context, document: Record<string, unknown> = {}) {
    super(ctx);
    this.storageDocument = structuredClone(document);
  }

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.storageDocument));
  }

  protected override persist(
    ns: SettingsNamespace,
    section: Record<string, unknown>,
  ): Promise<void> {
    this.storageDocument[ns] = structuredClone(section);
    return Promise.resolve();
  }
}

const loggers: Array<ReturnType<typeof createPluginLogger>> = [];
const fibers: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(loggers.splice(0).map((logger) => logger.close()));
  await Promise.all(fibers.splice(0).reverse().map((fiber) => fiber.dispose()));
});

async function configuredContext(document: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context();
  const settingsFiber = ctx.plugin(MemorySettings, document);
  fibers.push(settingsFiber);
  await settingsFiber;
  const uiFiber = ctx.plugin(PluginLogUi);
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
  it("registers a live settings namespace", async () => {
    const ctx = await configuredContext();
    expect(ctx.settings.describe().find(
      (item) => item.ns === PLUGIN_LOG_SETTINGS_NAMESPACE,
    )).toMatchObject({
      ns: "plugin-log",
      applies: "live",
      revision: 0,
    });
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

  it("applies configured overrides and updates them live", async () => {    const ctx = await configuredContext({
      "plugin-log": {
        defaultLevel: "warn",
        format: "json",
        levels: { "dsh-special": "debug" },
      },
    });
    const special = logger("dsh-special");
    const regular = logger("dsh-regular");

    expect(special.level).toBe("debug");
    expect(regular.level).toBe("warn");
    expect(special.format).toBe("json");

    await ctx.settings.update(PLUGIN_LOG_SETTINGS_NAMESPACE, {
      defaultLevel: "error",
      format: "text",
      levels: { "dsh-special": "trace" },
    });

    await vi.waitFor(() => {
      expect(special.level).toBe("trace");
      expect(regular.level).toBe("error");
      expect(getRegisteredPluginLoggers().every((entry) => entry.format === "text")).toBe(true);
    });
  });

  it("serves the live record stream the panel reads", async () => {
    const ctx = await configuredContext({ "plugin-log": { defaultLevel: "trace" } });
    const created = logger("dsh-stream");
    // The stream carries every logger in the process, this plugin's own
    // diagnostics included, so a reader narrows it by plugin.
    const mine = (cursor: number) =>
      ctx.pluginLogUi.tail(cursor, 10).records.filter((record) => record.pluginId === "dsh-stream");

    created.info("stream.first", { attempt: 1 });
    created.child("worker").warn("stream.second");

    const read = ctx.pluginLogUi.tail(0, 10);
    expect(mine(0).map((record) => [record.level, record.module, record.event])).toEqual([
      ["info", "", "stream.first"],
      ["warn", "worker", "stream.second"],
    ]);
    expect(mine(0)[0]?.fields).toEqual([{ key: "attempt", value: "1" }]);

    // The cursor is what makes the panel's poll incremental.
    expect(mine(read.cursor)).toEqual([]);
    created.info("stream.third");
    expect(mine(read.cursor).map((record) => record.event)).toEqual(["stream.third"]);
  });

  it("renders arbitrary field values instead of shipping them across the Remote", async () => {
    const ctx = await configuredContext({ "plugin-log": { defaultLevel: "trace" } });
    const created = logger("dsh-fields");
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;

    created.info("stream.fields", { cyclic, failure: new Error("boom"), list: [1, 2] });

    const [record] = ctx.pluginLogUi.tail(0, 10).records
      .filter((entry) => entry.pluginId === "dsh-fields");
    expect(record?.fields).toEqual([
      // A self-referencing object terminates at the depth limit instead of
      // cycling: the panel draws a string, and the wire carries one.
      { key: "cyclic", value: "{name: loop, self: {name: loop, self: {name: loop, self: {…}}}}" },
      { key: "failure", value: "Error: boom" },
      { key: "list", value: "[1, 2]" },
    ]);
  });
});
