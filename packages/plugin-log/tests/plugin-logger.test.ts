import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHostLoggerSink,
  createPluginLogger,
  getPluginLogger,
  getRegisteredPluginLoggers,
  isPluginLogFormat,
  isPluginLogLevel,
  resolveDshHome,
  setPluginLogFormat,
  setPluginLogLevel,
  subscribePluginLoggerRegistry,
} from "../src/index.js";
import type { PluginLogger, PluginLogLevel } from "../src/index.js";

async function makeLogDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dsh-plugin-log-"));
}

async function readLogLines(dir: string): Promise<Record<string, unknown>[]> {
  const entries = await readdir(dir);
  const lines: Record<string, unknown>[] = [];
  for (const entry of entries) {
    const text = await readFile(join(dir, entry), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) lines.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return lines;
}

describe("resolveDshHome", () => {
  it("prefers $DSH_HOME when set", () => {
    expect(resolveDshHome({ DSH_HOME: "D:/tmp/dsh-home" })).toMatch(/dsh-home$/);
  });

  it("falls back to ~/.dsh", () => {
    const home = resolveDshHome({});
    expect(home).toContain(".dsh");
    expect(home.endsWith(".dsh")).toBe(true);
  });
});

describe("isPluginLogLevel", () => {
  it("accepts known levels only", () => {
    expect(isPluginLogLevel("warn")).toBe(true);
    expect(isPluginLogLevel("loud")).toBe(false);
    expect(isPluginLogLevel(42)).toBe(false);
  });
});

describe("isPluginLogFormat", () => {
  it("accepts json and text only", () => {
    expect(isPluginLogFormat("json")).toBe(true);
    expect(isPluginLogFormat("text")).toBe(true);
    expect(isPluginLogFormat("pretty")).toBe(false);
  });
});

describe("createHostLoggerSink", () => {
  it("maps plugin severities to the four-level host logger", () => {
    const calls: string[] = [];
    const sink = createHostLoggerSink({
      debug: (message) => calls.push(`debug:${message}`),
      info: (message) => calls.push(`info:${message}`),
      warn: (message) => calls.push(`warn:${message}`),
      error: (message) => calls.push(`error:${message}`),
    });

    sink("trace", "trace message");
    sink("debug", "debug message");
    sink("info", "info message");
    sink("warn", "warn message");
    sink("error", "error message");
    sink("fatal", "fatal message");

    expect(calls).toEqual([
      "debug:trace message",
      "debug:debug message",
      "info:info message",
      "warn:warn message",
      "error:error message",
      "error:fatal message",
    ]);
  });

  it("falls back to info when the host has no debug method", () => {
    const calls: string[] = [];
    const sink = createHostLoggerSink({
      info: (message) => calls.push(message),
      warn() {},
      error() {},
    });

    sink("debug", "debug message");

    expect(calls).toEqual(["debug message"]);
  });
});

describe("createPluginLogger", () => {
  let directories: string[] = [];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      DSH_LOG_DISABLED: process.env.DSH_LOG_DISABLED,
      DSH_LOG_LEVEL: process.env.DSH_LOG_LEVEL,
    };
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const pending = directories;
    directories = [];
    await Promise.all(pending.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function newDir(): Promise<string> {
    const dir = await makeLogDir();
    directories.push(dir);
    return dir;
  }

  it("writes NDJSON records with plugin, level, time, event and fields", async () => {
    const dir = await newDir();
    const logger = createPluginLogger({ pluginId: "dsh-test", dir, level: "info", console: "silent" });
    logger.info("test.event", { a: 1, label: "x" });
    await logger.close();

    const lines = await readLogLines(dir);
    expect(lines).toHaveLength(1);
    const record = lines[0] as Record<string, unknown>;
    expect(record["plugin"]).toBe("dsh-test");
    expect(record["msg"]).toBe("test.event");
    expect(record["a"]).toBe(1);
    expect(record["label"]).toBe("x");
    expect(record["level"]).toBe(30);
    expect(typeof record["time"]).toBe("number");
  });

  it("writes readable text records with scope and fields", async () => {
    const dir = await newDir();
    const now = new Date("2026-08-30T12:34:56.789Z").getTime();
    const logger = createPluginLogger({
      pluginId: "dsh-readable",
      dir,
      level: "info",
      format: "text",
      console: "silent",
      now: () => now,
    });
    logger.child("worker").warn("readable.event", { attempt: 2, label: "hello world" });
    await logger.close();

    const entries = await readdir(dir);
    expect(entries).toHaveLength(1);
    const text = await readFile(join(dir, entries[0]!), "utf8");
    expect(text).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z WARN {2}\[dsh-readable\/worker\] readable\.event attempt=2 label="hello world"\n$/,
    );
  });

  it("drops records below the configured level", async () => {
    const dir = await newDir();
    const logger = createPluginLogger({ pluginId: "dsh-test", dir, level: "error", console: "silent" });
    logger.info("dropped.event");
    expect(await readdir(dir)).toEqual([]);
    logger.error("kept.event");
    await logger.close();

    const lines = await readLogLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.["msg"]).toBe("kept.event");
  });

  it("adds a module field through child()", async () => {
    const dir = await newDir();
    const logger = createPluginLogger({ pluginId: "dsh-test", dir, level: "info", console: "silent" });
    logger.child("coordinator").warn("child.event", { k: 1 });
    await logger.close();

    const lines = await readLogLines(dir);
    expect(lines[0]?.["module"]).toBe("coordinator");
    expect(lines[0]?.["plugin"]).toBe("dsh-test");
    expect(lines[0]?.["msg"]).toBe("child.event");
  });

  it("rolls over to a new file when the day changes", async () => {
    const dir = await newDir();
    let now = new Date(2026, 0, 15, 12, 0, 0).getTime();
    const logger = createPluginLogger({
      pluginId: "dsh-test",
      dir,
      level: "info",
      console: "silent",
      now: () => now,
    });
    logger.info("day.one");
    now += 86_400_000;
    logger.info("day.two");
    await logger.close();

    const entries = await readdir(dir);
    expect(entries).toHaveLength(2);
    const lines = await readLogLines(dir);
    expect(lines.map((line) => line["msg"])).toEqual(["day.one", "day.two"]);
  });

  it("removes daily files older than the retention window on rollover", async () => {
    const dir = await newDir();
    await writeFile(join(dir, "2020-01-01.log"), '{"msg":"ancient"}\n', "utf8");
    await writeFile(join(dir, "2026-01-10.log"), '{"msg":"recent"}\n', "utf8");
    await writeFile(join(dir, "keep.txt"), "untouched\n", "utf8");
    const logger = createPluginLogger({
      pluginId: "dsh-test",
      dir,
      level: "info",
      console: "silent",
      retentionDays: 14,
      now: () => new Date(2026, 0, 15, 12, 0, 0).getTime(),
    });
    logger.info("current.event");
    await logger.close();

    const entries = await readdir(dir);
    expect(entries).not.toContain("2020-01-01.log");
    expect(entries).toContain("2026-01-10.log");
    expect(entries).toContain("keep.txt");
  });

  it("degrades to console-only when the log dir cannot be created", async () => {
    const dir = await newDir();
    const blocker = join(dir, "not-a-dir");
    await writeFile(blocker, "occupied", "utf8");
    const mirrored: string[] = [];
    const logger = createPluginLogger({
      pluginId: "dsh-test",
      dir: blocker,
      level: "info",
      console: "warn",
      consoleSink: (level, message) => mirrored.push(`${level}:${message}`),
    });
    expect(() => logger.info("still.safe")).not.toThrow();
    expect(() => logger.warn("mirrored.too", { k: 1 })).not.toThrow();
    await logger.close();

    expect(mirrored.some((line) => line.startsWith("warn:[dsh-test] mirrored.too k=1"))).toBe(true);
  });

  it("honors the console mirror default of warn without touching info", async () => {
    const dir = await newDir();
    const mirrored: string[] = [];
    const logger = createPluginLogger({
      pluginId: "dsh-mirror",
      dir,
      level: "info",
      consoleSink: (level, message) => mirrored.push(`${level}:${message}`),
    });
    logger.info("quiet.event");
    logger.warn("loud.event");
    await logger.close();

    expect(mirrored).toEqual(["warn:[dsh-mirror] loud.event"]);
  });

  it("disables file output when DSH_LOG_DISABLED=1", async () => {
    const dir = await newDir();
    process.env.DSH_LOG_DISABLED = "1";
    const logger = createPluginLogger({ pluginId: "dsh-test", dir, level: "info", console: "silent" });
    logger.info("no.file");
    await logger.close();
    expect(await readdir(dir)).toEqual([]);
  });

  it("resolves the level from DSH_LOG_LEVEL when no explicit level is given", async () => {
    const dir = await newDir();
    process.env.DSH_LOG_LEVEL = "error";
    const logger = createPluginLogger({ pluginId: "dsh-test", dir, console: "silent" });
    expect(logger.level).toBe("error");
    logger.setLevel("info");
    expect(logger.level).toBe("info");
    await logger.close();
  });

  it("silences everything at the silent level", async () => {
    const dir = await newDir();
    const mirrored: string[] = [];
    const logger = createPluginLogger({
      pluginId: "dsh-test",
      dir,
      level: "silent",
      consoleSink: (level, message) => mirrored.push(`${level}:${message}`),
    });
    logger.error("muted.event");
    await logger.close();
    expect(await readdir(dir)).toEqual([]);
    expect(mirrored).toEqual([]);
  });

  it("rejects plugin ids that would escape the log directory", () => {
    expect(() => createPluginLogger({ pluginId: "../escape", dir: "unused" })).toThrowError(/pluginId/);
  });
});

describe("getPluginLogger", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await makeLogDir();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function options(level?: PluginLogLevel) {
    return { pluginId: "dsh-cached", dir: directory, level, console: "silent" as const };
  }

  it("returns the cached instance for the same plugin and dir", async () => {
    const first = getPluginLogger(options("info"));
    const second = getPluginLogger(options("info"));
    expect(second).toBe(first);
    await first.close();
  });

  it("applies an explicit level to the cached instance", async () => {
    const first = getPluginLogger(options("info"));
    const second = getPluginLogger(options("error"));
    expect(second).toBe(first);
    expect(second.level).toBe("error");
    await second.close();
  });

  it("creates a fresh instance after close", async () => {
    const first = getPluginLogger(options("info"));
    await first.close();
    const second = getPluginLogger(options("info"));
    expect(second).not.toBe(first);
    await second.close();
  });
});

describe("plugin logger registry", () => {
  const loggers: PluginLogger[] = [];

  afterEach(async () => {
    const pending = loggers.splice(0);
    await Promise.all(pending.map((logger) => logger.close()));
  });

  function create(pluginId: string, level: PluginLogLevel = "info"): PluginLogger {
    const logger = createPluginLogger({
      pluginId,
      level,
      file: false,
      console: "silent",
    });
    loggers.push(logger);
    return logger;
  }

  it("automatically registers root loggers and removes them on close", async () => {
    const logger = create("dsh-registry-lifecycle");
    const snapshot = getRegisteredPluginLoggers();
    const registered = snapshot.filter(
      (entry) => entry.pluginId === "dsh-registry-lifecycle",
    );

    expect(registered).toHaveLength(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(registered[0])).toBe(true);
    expect(registered[0]).toMatchObject({
      pluginId: "dsh-registry-lifecycle",
      level: "info",
      format: "json",
    });
    expect(registered[0]?.dir).toMatch(/[\\/]logs[\\/]dsh-registry-lifecycle$/);
    expect(Number.isInteger(registered[0]?.registrationId)).toBe(true);
    expect(logger.child("worker")).not.toBe(logger);
    expect(
      getRegisteredPluginLoggers().filter(
        (entry) => entry.pluginId === "dsh-registry-lifecycle",
      ),
    ).toHaveLength(1);

    await logger.close();
    expect(
      getRegisteredPluginLoggers().some(
        (entry) => entry.pluginId === "dsh-registry-lifecycle",
      ),
    ).toBe(false);
  });

  it("publishes snapshots and changes all matching logger levels", () => {
    const snapshots: string[][] = [];
    const unsubscribe = subscribePluginLoggerRegistry((entries) => {
      snapshots.push(
        entries
          .filter((entry) => entry.pluginId.startsWith("dsh-registry-level"))
          .map((entry) => `${entry.pluginId}:${entry.level}`),
      );
    });

    const first = create("dsh-registry-level", "info");
    const second = create("dsh-registry-level", "warn");
    create("dsh-registry-level-other", "error");

    expect(setPluginLogLevel("dsh-registry-level", "debug")).toBe(2);
    expect(first.level).toBe("debug");
    expect(second.level).toBe("debug");
    expect(
      getRegisteredPluginLoggers()
        .filter((entry) => entry.pluginId === "dsh-registry-level")
        .map((entry) => entry.level),
    ).toEqual(["debug", "debug"]);
    expect(snapshots.at(-1)).toEqual([
      "dsh-registry-level:debug",
      "dsh-registry-level:debug",
      "dsh-registry-level-other:error",
    ]);

    unsubscribe();
  });

  it("changes the format of all active loggers", () => {
    const first = create("dsh-registry-format-a");
    const second = create("dsh-registry-format-b");

    expect(setPluginLogFormat("text")).toBeGreaterThanOrEqual(2);
    expect(first.format).toBe("text");
    expect(second.format).toBe("text");
    expect(
      getRegisteredPluginLoggers()
        .filter((entry) => entry.pluginId.startsWith("dsh-registry-format-"))
        .map((entry) => entry.format),
    ).toEqual(["text", "text"]);
  });

  it("isolates logging from registry listener failures", () => {
    const unsubscribe = subscribePluginLoggerRegistry(() => {
      throw new Error("observer failed");
    });
    expect(() => create("dsh-registry-fail-open")).not.toThrow();
    unsubscribe();
  });
});
