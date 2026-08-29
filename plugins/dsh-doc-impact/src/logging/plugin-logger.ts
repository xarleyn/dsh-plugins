/**
 * Plugin file logger — the seed of the future `@yadsh/dsh-plugin-log` package.
 *
 * Every plugin currently carries its own verbatim copy of `src/logging/`
 * (guidelines §5.2); the exported API below is frozen so that switching to
 * the extracted package later is a one-line import change. The wrapper:
 *
 * - wraps `pino` for severity levels and NDJSON serialization;
 * - writes daily files `<dir>/<YYYY-MM-DD>.log`, by default under
 *   `<$DSH_HOME>/logs/<pluginId>`;
 * - mirrors selected records to an injectable console sink (default level
 *   `warn`) so operators still see problems live;
 * - never throws at runtime: file-system failures degrade to console-only
 *   logging (fail-open), and closed loggers silently drop records;
 * - disables file output when `DSH_LOG_DISABLED=1`, and under `NODE_ENV=test`
 *   unless `dir` is set explicitly (unit tests never touch a real home).
 *
 * Record shape (one JSON object per line): pino's `level` (numeric),
 * `time` (epoch ms) and `msg` (= the event code), plus `plugin` and the
 * caller's fields; `child(module)` adds `module`. Reserved pino keys
 * (`level`, `time`, `msg`, `plugin`, `module`) must not be used as field
 * names.
 */

import { mkdirSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import pino from "pino";
import type { DestinationStream, Logger as PinoLogger } from "pino";
import { resolveDshHome } from "./dsh-home.js";

/** Ordered severity levels; `silent` disables the logger entirely. */
export const PLUGIN_LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
] as const;

export type PluginLogLevel = (typeof PLUGIN_LOG_LEVELS)[number];

/** Every level except `silent` (which also disables the console mirror). */
export type ConsoleLevel = Exclude<PluginLogLevel, "silent">;

/**
 * Receives console-mirrored records. Must not throw; the wrapper guards every
 * call regardless.
 */
export type PluginConsoleSink = (level: ConsoleLevel, message: string) => void;

/** Default console mirror threshold. */
export const DEFAULT_CONSOLE_LEVEL: PluginLogLevel = "warn";

/** Daily log files kept per plugin by default (0 = keep forever). */
export const DEFAULT_LOG_RETENTION_DAYS = 14;

const LEVEL_WEIGHT: Record<ConsoleLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const DAY_MS = 86_400_000;

const LOG_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.log$/;

function weightOf(level: PluginLogLevel): number {
  return level === "silent" ? Number.POSITIVE_INFINITY : LEVEL_WEIGHT[level];
}

/** Type guard for level strings (config parsing, env overrides). */
export function isPluginLogLevel(value: unknown): value is PluginLogLevel {
  return typeof value === "string" && (PLUGIN_LOG_LEVELS as readonly string[]).includes(value);
}

/** Logger configuration; every field except `pluginId` is optional. */
export interface PluginLoggerOptions {
  /**
   * Plugin id: directory name, `plugin` record field and env-prefix source
   * (`DSH_LOG_LEVEL_<ID>`). Must match `[A-Za-z0-9][A-Za-z0-9._-]*`.
   */
  readonly pluginId: string;
  /** Severity threshold. Default: `DSH_LOG_LEVEL_<ID>` / `DSH_LOG_LEVEL` env, else `info`. */
  readonly level?: PluginLogLevel;
  /** Absolute log directory. Default: `<$DSH_HOME>/logs/<pluginId>`. */
  readonly dir?: string;
  /** Overrides the DSH home used to build the default `dir` (tests). */
  readonly dshHome?: string;
  /** Console mirror threshold; `silent` disables mirroring. Default: `warn`. */
  readonly console?: PluginLogLevel;
  /** Mirror target. Default: the global `console`. */
  readonly consoleSink?: PluginConsoleSink;
  /** Daily files older than this are deleted on rollover. Default: 14; 0 disables. */
  readonly retentionDays?: number;
  /** Master switch for file output. Default: auto (see the module docs). */
  readonly file?: boolean;
  /** Record fields to redact (pino `redact` paths), e.g. `["apiKey"]`. */
  readonly redact?: readonly string[];
  /** Clock for file naming, rollover and retention (tests). */
  readonly now?: () => number;
}

/** Stable logging surface shared by every plugin (future package contract). */
export interface PluginLogger {
  trace(event: string, fields?: Record<string, unknown>): void;
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  fatal(event: string, fields?: Record<string, unknown>): void;
  /** Bound sub-logger that adds a `module` field to every record. */
  child(module: string): PluginLogger;
  /** Current severity threshold. */
  get level(): PluginLogLevel;
  /** Change the severity threshold at runtime. */
  setLevel(level: PluginLogLevel): void;
  /** Best-effort synchronous flush of buffered file output. */
  flush(): void;
  /** Flush and close the destination; idempotent; later writes are dropped. */
  close(): Promise<void>;
}

function formatConsole(event: string, fields?: Record<string, unknown>): string {
  if (fields === undefined) return event;
  const parts = Object.entries(fields).map(([key, value]) => {
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    return `${key}=${rendered}`;
  });
  return parts.length === 0 ? event : `${event} ${parts.join(" ")}`;
}

/** Local-calendar date stamp used in file names (sorts lexically). */
function dayStamp(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function envLevelOverride(pluginId: string): PluginLogLevel | undefined {
  const env = process.env;
  const specific = env[`DSH_LOG_LEVEL_${pluginId.replaceAll("-", "_").toUpperCase()}`];
  if (isPluginLogLevel(specific)) return specific;
  return isPluginLogLevel(env.DSH_LOG_LEVEL) ? env.DSH_LOG_LEVEL : undefined;
}

function envFileDisabled(explicitDir: boolean): boolean {
  const flag = process.env.DSH_LOG_DISABLED ?? process.env.DSH_PLUGIN_LOG_DISABLED;
  if (flag === "1" || flag === "true") return true;
  // Unit tests must never write into a real DSH home unless a dir is explicit.
  return process.env.NODE_ENV === "test" && !explicitDir;
}

async function sweepOldLogFiles(dir: string, retentionDays: number, nowMs: number): Promise<void> {
  if (retentionDays <= 0) return;
  const cutoff = nowMs - retentionDays * DAY_MS;
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    const match = LOG_FILE_PATTERN.exec(entry);
    if (match === null || match[1] === undefined) continue;
    const stampMs = Date.parse(`${match[1]}T00:00:00`);
    if (!Number.isFinite(stampMs) || stampMs >= cutoff) continue;
    await unlink(join(dir, entry)).catch(() => undefined);
  }
}

type ClosableDestination = DestinationStream & {
  destroyed?: boolean;
  once?: (event: string, listener: () => void) => unknown;
  end?: () => unknown;
  flushSync?: () => void;
};

let sharedDevNull: Writable | undefined;
function devNull(): Writable {
  sharedDevNull ??= new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  return sharedDevNull;
}

function closeQuietly(destination: ClosableDestination): void {
  try {
    destination.end?.();
  } catch {
    // Fail-open: closing must never surface.
  }
}

/**
 * SonicBoom's `end()` takes no callback — completion is signaled by the
 * `close` event. A bounded guard keeps a wedged stream from hanging plugin
 * disposal forever.
 */
function closeDestination(destination: ClosableDestination): Promise<void> {
  return new Promise((resolve) => {
    if (destination.destroyed === true) {
      resolve();
      return;
    }
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve();
    };
    const guard = setTimeout(done, 1000);
    guard.unref();
    try {
      destination.once?.("close", done);
      destination.end?.();
    } catch {
      done();
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const defaultSink: PluginConsoleSink = (level, message) => {
  if (level === "warn") console.warn(message);
  else if (level === "error" || level === "fatal") console.error(message);
  else if (level === "trace" || level === "debug") console.log(message);
  else console.info(message);
};

/** Mutable state shared by a root logger and all of its `child()` views. */
class LoggerCore {
  readonly pluginId: string;
  readonly dir: string;

  private levelName: PluginLogLevel;
  private readonly consoleLevel: PluginLogLevel;
  private readonly sink: PluginConsoleSink;
  private readonly retentionDays: number;
  private readonly redact: readonly string[];
  private readonly clock: () => number;
  private fileEnabled: boolean;
  private closed = false;
  private destination: ClosableDestination | undefined;
  private destinationDay = "";
  private root: PinoLogger | undefined;
  private children = new Map<string, PinoLogger>();
  private retention: Promise<void> | undefined;

  constructor(options: PluginLoggerOptions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.pluginId)) {
      throw new TypeError(
        `pluginId must match [A-Za-z0-9][A-Za-z0-9._-]*, got ${JSON.stringify(options.pluginId)}`,
      );
    }
    this.pluginId = options.pluginId;
    const home = options.dshHome ?? resolveDshHome();
    this.dir = options.dir ?? join(home, "logs", options.pluginId);
    this.levelName = options.level ?? envLevelOverride(options.pluginId) ?? "info";
    this.consoleLevel = options.console ?? DEFAULT_CONSOLE_LEVEL;
    this.sink = options.consoleSink ?? defaultSink;
    this.retentionDays = Math.max(0, Math.floor(options.retentionDays ?? DEFAULT_LOG_RETENTION_DAYS));
    this.redact = options.redact ?? [];
    this.clock = options.now ?? Date.now;
    this.fileEnabled = (options.file ?? true) && !envFileDisabled(options.dir !== undefined);
  }

  isClosed(): boolean {
    return this.closed;
  }

  key(): string {
    return `${this.pluginId}\u0000${this.dir}`;
  }

  get level(): PluginLogLevel {
    return this.levelName;
  }

  setLevel(level: PluginLogLevel): void {
    if (!isPluginLogLevel(level)) {
      throw new TypeError(`unknown plugin log level: ${JSON.stringify(level)}`);
    }
    if (level === this.levelName) return;
    this.levelName = level;
    // Rebuild the destination on the next write so the new threshold takes
    // effect without touching the file handle while silent.
    this.destinationDay = "";
  }

  write(
    moduleField: string | undefined,
    level: ConsoleLevel,
    event: string,
    fields?: Record<string, unknown>,
  ): void {
    if (this.closed || this.levelName === "silent") return;
    if (weightOf(level) < weightOf(this.levelName)) {
      this.mirror(moduleField, level, event, fields);
      return;
    }
    this.open();
    const target = this.targetFor(moduleField);
    if (target !== undefined) {
      try {
        target[level](fields ?? {}, event);
      } catch {
        // Fail-open: serialization problems must never break the plugin.
      }
    }
    this.mirror(moduleField, level, event, fields);
  }

  flush(): void {
    try {
      this.destination?.flushSync?.();
    } catch {
      // Fail-open.
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    registry.delete(this.key());
    const destination = this.destination;
    this.destination = undefined;
    this.root = undefined;
    this.children.clear();
    this.destinationDay = "";
    await this.retention;
    if (destination !== undefined) await closeDestination(destination);
  }

  /** Open (or roll over to) the destination file for the current day. */
  private open(): void {
    const stamp = dayStamp(this.clock());
    if (this.root !== undefined && stamp === this.destinationDay) return;
    this.rollover(stamp);
  }

  private rollover(stamp: string): void {
    this.destinationDay = stamp;
    let next: ClosableDestination | undefined;
    if (this.fileEnabled) {
      try {
        mkdirSync(this.dir, { recursive: true });
        next = pino.destination({
          dest: join(this.dir, `${stamp}.log`),
          append: true,
          mkdir: true,
          sync: false,
          minLength: 0,
        }) as ClosableDestination;
      } catch (error) {
        // Fail-open: an unusable log directory degrades to console-only.
        this.fileEnabled = false;
        next = undefined;
        this.mirror(undefined, "warn", "logging.file_disabled", { reason: errorMessage(error) });
      }
    }
    const previous = this.destination;
    this.destination = next;
    this.children.clear();
    this.root = pino(
      {
        level: this.levelName,
        base: { plugin: this.pluginId },
        ...(this.redact.length > 0 ? { redact: [...this.redact] } : {}),
      },
      next ?? devNull(),
    );
    if (previous !== undefined && previous !== next) closeQuietly(previous);
    if (this.fileEnabled) this.scheduleRetentionSweep();
  }

  private targetFor(moduleField: string | undefined): PinoLogger | undefined {
    const root = this.root;
    if (root === undefined) return undefined;
    if (moduleField === undefined) return root;
    const cached = this.children.get(moduleField);
    if (cached !== undefined) return cached;
    const created = root.child({ module: moduleField });
    this.children.set(moduleField, created);
    return created;
  }

  private mirror(
    moduleField: string | undefined,
    level: ConsoleLevel,
    event: string,
    fields?: Record<string, unknown>,
  ): void {
    if (this.consoleLevel === "silent") return;
    if (weightOf(level) < weightOf(this.consoleLevel)) return;
    const scope = moduleField === undefined ? "" : `/${moduleField}`;
    try {
      this.sink(level, `[${this.pluginId}${scope}] ${formatConsole(event, fields)}`);
    } catch {
      // Fail-open.
    }
  }

  private scheduleRetentionSweep(): void {
    if (this.retentionDays <= 0 || this.retention !== undefined) return;
    this.retention = sweepOldLogFiles(this.dir, this.retentionDays, this.clock()).then(
      () => undefined,
      () => undefined,
    );
  }
}

/** Per-process cache so repeated plugin (re)construction reuses one handle set. */
interface RegistryEntry {
  core: LoggerCore;
  root: PluginLoggerImpl;
}

const registry = new Map<string, RegistryEntry>();

class PluginLoggerImpl implements PluginLogger {
  constructor(
    private readonly core: LoggerCore,
    private readonly moduleField?: string,
  ) {}

  trace(event: string, fields?: Record<string, unknown>): void {
    this.core.write(this.moduleField, "trace", event, fields);
  }

  debug(event: string, fields?: Record<string, unknown>): void {
    this.core.write(this.moduleField, "debug", event, fields);
  }

  info(event: string, fields?: Record<string, unknown>): void {
    this.core.write(this.moduleField, "info", event, fields);
  }

  warn(event: string, fields?: Record<string, unknown>): void {
    this.core.write(this.moduleField, "warn", event, fields);
  }

  error(event: string, fields?: Record<string, unknown>): void {
    this.core.write(this.moduleField, "error", event, fields);
  }

  fatal(event: string, fields?: Record<string, unknown>): void {
    this.core.write(this.moduleField, "fatal", event, fields);
  }

  child(module: string): PluginLogger {
    return new PluginLoggerImpl(this.core, module);
  }

  get level(): PluginLogLevel {
    return this.core.level;
  }

  setLevel(level: PluginLogLevel): void {
    this.core.setLevel(level);
  }

  flush(): void {
    this.core.flush();
  }

  close(): Promise<void> {
    return this.core.close();
  }
}

/** Create a standalone logger instance (no caching). */
export function createPluginLogger(options: PluginLoggerOptions): PluginLogger {
  return new PluginLoggerImpl(new LoggerCore(options));
}

/**
 * Create or return the cached logger for `pluginId` + resolved `dir`. A later
 * call with an explicit `level` updates the cached instance's threshold, so
 * plugin config reloads take effect. `close()` evicts the cache entry; the
 * next call creates a fresh instance.
 */
export function getPluginLogger(options: PluginLoggerOptions): PluginLogger {
  const candidate = new LoggerCore(options);
  const key = candidate.key();
  const existing = registry.get(key);
  if (existing === undefined || existing.core.isClosed()) {
    const entry: RegistryEntry = { core: candidate, root: new PluginLoggerImpl(candidate) };
    registry.set(key, entry);
    return entry.root;
  }
  if (options.level !== undefined) existing.core.setLevel(options.level);
  return existing.root;
}
