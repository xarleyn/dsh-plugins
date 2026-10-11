/**
 * The mutable state one plugin logger owns, shared by a root logger and all of
 * its `child()` views.
 *
 * `LoggerCore` holds the threshold, the destination for the current day, the
 * console mirror and the retention sweep; `PluginLoggerImpl` is the per-`module`
 * view of it a caller actually holds. Construction and caching — the two ways a
 * core enters the process-wide registry — stay in `plugin-logger.ts`.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import type { Logger as PinoLogger } from "pino";
import { resolveDshHome } from "./dsh-home.js";
import {
  closeDestination,
  closeQuietly,
  devNull,
  TextDestination,
  type ClosableDestination,
} from "./destination.js";
import { formatConsole } from "./format.js";
import {
  DEFAULT_CONSOLE_LEVEL,
  isPluginLogFormat,
  isPluginLogLevel,
  weightOf,
  type ConsoleLevel,
  type PluginConsoleSink,
  type PluginLogFormat,
  type PluginLogLevel,
} from "./levels.js";
import {
  DEFAULT_LOG_RETENTION_DAYS,
  dayStamp,
  sweepOldLogFiles,
} from "./log-files.js";
import { notifyRegistryListeners, registryState } from "./registry.js";
import { publishPluginLogRecord } from "./record-bus.js";
import { buildFieldRedactor, type FieldRedactor } from "./redact.js";
import type { PluginLogger, PluginLoggerOptions } from "./plugin-logger.js";

function envLevelOverride(pluginId: string): PluginLogLevel | undefined {
  const env = process.env;
  const specific =
    env[`DSH_LOG_LEVEL_${pluginId.replaceAll("-", "_").toUpperCase()}`];
  if (isPluginLogLevel(specific)) return specific;
  return isPluginLogLevel(env.DSH_LOG_LEVEL) ? env.DSH_LOG_LEVEL : undefined;
}

function envFileDisabled(explicitDir: boolean): boolean {
  const flag =
    process.env.DSH_LOG_DISABLED ?? process.env.DSH_PLUGIN_LOG_DISABLED;
  if (flag === "1" || flag === "true") return true;
  // Unit tests must never write into a real DSH home unless a dir is explicit.
  return process.env.NODE_ENV === "test" && !explicitDir;
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
export class LoggerCore {
  readonly pluginId: string;
  readonly dir: string;
  registrationId: number | undefined;

  private levelName: PluginLogLevel;
  private formatName: PluginLogFormat;
  private readonly consoleLevel: PluginLogLevel;
  private readonly sink: PluginConsoleSink;
  private readonly retentionDays: number;
  private readonly redact: readonly string[];
  private readonly redactor: FieldRedactor | undefined;
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
    this.levelName =
      options.level ?? envLevelOverride(options.pluginId) ?? "info";
    this.formatName = options.format ?? "json";
    this.consoleLevel = options.console ?? DEFAULT_CONSOLE_LEVEL;
    this.sink = options.consoleSink ?? defaultSink;
    this.retentionDays = Math.max(
      0,
      Math.floor(options.retentionDays ?? DEFAULT_LOG_RETENTION_DAYS),
    );
    this.redact = options.redact ?? [];
    this.redactor = buildFieldRedactor(this.redact);
    this.clock = options.now ?? Date.now;
    this.fileEnabled =
      (options.file ?? true) && !envFileDisabled(options.dir !== undefined);
  }

  isClosed(): boolean {
    return this.closed;
  }

  activate(): void {
    if (this.closed || this.registrationId !== undefined) return;
    const state = registryState();
    this.registrationId = state.nextRegistrationId;
    state.nextRegistrationId += 1;
    state.active.set(this.registrationId, this);
    notifyRegistryListeners();
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
    if (this.registrationId !== undefined) notifyRegistryListeners();
  }

  get format(): PluginLogFormat {
    return this.formatName;
  }

  setFormat(format: PluginLogFormat): void {
    if (!isPluginLogFormat(format)) {
      throw new TypeError(
        `unknown plugin log format: ${JSON.stringify(format)}`,
      );
    }
    if (format === this.formatName) return;
    this.formatName = format;
    this.destinationDay = "";
    if (this.registrationId !== undefined) notifyRegistryListeners();
  }

  write(
    moduleField: string | undefined,
    level: ConsoleLevel,
    event: string,
    fields?: Record<string, unknown>,
  ): void {
    if (this.closed || this.levelName === "silent") return;
    const suppressed = weightOf(level) < weightOf(this.levelName);
    // A record no sink reads must not touch the caller's object at all: the copy
    // below walks every property, and a getter or a Proxy is free to throw.
    if (suppressed && !this.mirrors(level)) return;
    // Redacted once, so no sink below can be handed a value the plugin asked
    // away: the file (pino's own pass stays as a second boundary), the mirror,
    // and the bus record the log panel renders all read the same copy. Taking
    // that copy runs the caller's own code — a getter or a Proxy can throw — so
    // it is guarded: the logger never surfaces it to the plugin, and the record
    // is dropped rather than its fields coming out unredacted.
    let redacted: Record<string, unknown>;
    try {
      redacted =
        this.redactor === undefined
          ? { ...fields }
          : this.redactor(fields ?? {});
    } catch {
      this.mirror(undefined, "warn", "logging.fields_unreadable");
      return;
    }
    if (suppressed) {
      this.mirror(moduleField, level, event, redacted);
      return;
    }
    publishPluginLogRecord(
      this.pluginId,
      moduleField,
      level,
      this.clock(),
      event,
      redacted,
    );
    this.open();
    const target = this.targetFor(moduleField);
    if (target !== undefined) {
      try {
        target[level](redacted, event);
      } catch {
        // Fail-open: serialization problems must never break the plugin.
      }
    }
    this.mirror(moduleField, level, event, redacted);
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
    const state = registryState();
    const cached = state.cache.get(this.key());
    if (cached?.core === this) state.cache.delete(this.key());
    if (this.registrationId !== undefined) {
      state.active.delete(this.registrationId);
      this.registrationId = undefined;
      notifyRegistryListeners();
    }
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
        const fileDestination = pino.destination({
          dest: join(this.dir, `${stamp}.log`),
          append: true,
          mkdir: true,
          sync: false,
          minLength: 0,
        }) as ClosableDestination;
        next =
          this.formatName === "text"
            ? (new TextDestination(fileDestination) as ClosableDestination)
            : fileDestination;
      } catch (error) {
        // Fail-open: an unusable log directory degrades to console-only.
        this.fileEnabled = false;
        next = undefined;
        this.mirror(undefined, "warn", "logging.file_disabled", {
          reason: errorMessage(error),
        });
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

  /** Whether the console mirror prints a record at `level`. */
  private mirrors(level: ConsoleLevel): boolean {
    return weightOf(level) >= weightOf(this.consoleLevel);
  }

  private mirror(
    moduleField: string | undefined,
    level: ConsoleLevel,
    event: string,
    fields?: Record<string, unknown>,
  ): void {
    if (!this.mirrors(level)) return;
    const scope = moduleField === undefined ? "" : `/${moduleField}`;
    try {
      this.sink(
        level,
        `[${this.pluginId}${scope}] ${formatConsole(event, fields)}`,
      );
    } catch {
      // Fail-open.
    }
  }

  private scheduleRetentionSweep(): void {
    if (this.retentionDays <= 0) return;
    // Chained, not skipped: a sweep still running must not cost every later
    // rollover its own pass, while a rollover never overlaps the pass before
    // it. The tail is what `close()` waits for.
    this.retention = (this.retention ?? Promise.resolve())
      .then(() => sweepOldLogFiles(this.dir, this.retentionDays, this.clock()))
      .then(
        () => undefined,
        () => undefined,
      );
  }
}

export class PluginLoggerImpl implements PluginLogger {
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

  get format(): PluginLogFormat {
    return this.core.format;
  }

  setFormat(format: PluginLogFormat): void {
    this.core.setFormat(format);
  }

  flush(): void {
    this.core.flush();
  }

  close(): Promise<void> {
    return this.core.close();
  }
}
