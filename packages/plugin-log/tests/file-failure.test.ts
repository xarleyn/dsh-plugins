import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginLogger, type PluginLogger } from "../src/index.js";
import { dayStamp } from "../src/log-files.js";

const loggers: PluginLogger[] = [];
const directories: string[] = [];
async function logDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "plugin-log-failure-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(loggers.splice(0).map((logger) => logger.close()));
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("file logging failure isolation", () => {
  it.each(["json", "text"] as const)(
    "keeps %s logging usable after asynchronous destination failure",
    async (format) => {
      const destination = new PassThrough();
      const factory = vi
        .spyOn(pino, "destination")
        .mockReturnValue(
          destination as unknown as ReturnType<typeof pino.destination>,
        );
      const mirror: string[] = [];
      const logger = createPluginLogger({
        pluginId: "dsh-file-failure",
        dir: await logDirectory(),
        format,
        console: "info",
        consoleSink: (_level, message) => mirror.push(message),
        retentionDays: 0,
      });
      loggers.push(logger);
      logger.info("before.failure");
      expect(() =>
        destination.emit("error", new Error("synthetic write failure")),
      ).not.toThrow();
      logger.info("after.failure");
      expect(destination.destroyed).toBe(true);
      expect(
        mirror.filter((line) => line.includes("logging.file_disabled")),
      ).toHaveLength(1);
      expect(mirror.some((line) => line.includes("after.failure"))).toBe(true);
      expect(() =>
        destination.emit("error", new Error("late failure")),
      ).not.toThrow();
      expect(
        mirror.filter((line) => line.includes("logging.file_disabled")),
      ).toHaveLength(1);
      expect(factory).toHaveBeenCalledTimes(1);
    },
  );

  it("does not disable the current destination when a retired one fails", async () => {
    const old = new PassThrough();
    const current = new PassThrough();
    vi.spyOn(pino, "destination")
      .mockReturnValueOnce(
        old as unknown as ReturnType<typeof pino.destination>,
      )
      .mockReturnValueOnce(
        current as unknown as ReturnType<typeof pino.destination>,
      );
    let now = new Date(2026, 0, 1, 12).getTime();
    const logger = createPluginLogger({
      pluginId: "dsh-rollover-failure",
      dir: await logDirectory(),
      now: () => now,
      retentionDays: 0,
      console: "silent",
    });
    loggers.push(logger);
    logger.info("old.day");
    now += 86_400_000;
    logger.info("new.day");
    expect(() => old.emit("error", new Error("retired failure"))).not.toThrow();
    logger.info("still.current");
    expect(current.destroyed).toBe(false);
    expect(current.read()?.toString()).toContain("still.current");
  });

  it("contains errors emitted by the text conversion wrapper", async () => {
    const destination = new PassThrough();
    vi.spyOn(destination, "write").mockImplementation(() => {
      throw new Error("synthetic synchronous write failure");
    });
    vi.spyOn(pino, "destination").mockReturnValue(
      destination as unknown as ReturnType<typeof pino.destination>,
    );
    const mirror: string[] = [];
    const logger = createPluginLogger({
      pluginId: "dsh-text-failure",
      dir: await logDirectory(),
      format: "text",
      console: "info",
      consoleSink: (_level, message) => mirror.push(message),
      retentionDays: 0,
    });
    loggers.push(logger);
    logger.info("text.failure");
    await vi.waitFor(() =>
      expect(
        mirror.some((line) => line.includes("logging.file_disabled")),
      ).toBe(true),
    );
    expect(destination.destroyed).toBe(true);
    logger.info("after.text.failure");
    expect(mirror.some((line) => line.includes("after.text.failure"))).toBe(
      true,
    );
  });

  it.each(["json", "text"] as const)(
    "survives an actual asynchronous open error in %s mode",
    async (format) => {
      const directory = await logDirectory();
      const now = new Date(2026, 0, 1, 12).getTime();
      await mkdir(join(directory, `${dayStamp(now)}.log`));
      const mirror: string[] = [];
      const logger = createPluginLogger({
        pluginId: "dsh-open-failure",
        dir: directory,
        format,
        now: () => now,
        retentionDays: 0,
        console: "info",
        consoleSink: (_level, message) => mirror.push(message),
      });
      loggers.push(logger);
      logger.info("open.failure");
      await vi.waitFor(() =>
        expect(
          mirror.some((line) => line.includes("logging.file_disabled")),
        ).toBe(true),
      );
      logger.warn("after.open.failure");
      await logger.close();
      expect(mirror.some((line) => line.includes("after.open.failure"))).toBe(
        true,
      );
    },
  );
});
