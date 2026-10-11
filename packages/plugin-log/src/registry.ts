/**
 * The process-wide registry of live plugin loggers.
 *
 * The state hangs off a `Symbol.for` slot on `globalThis` on purpose: several
 * copies of this package can be loaded in one process (a host plugin and a
 * workspace package each resolve their own), and they must still agree on one
 * list, or the settings surface would show a partial view of the process. The
 * registry therefore speaks to loggers through the structural
 * {@link RegistryLoggerCore} contract rather than through a class identity.
 */

import {
  isPluginLogFormat,
  isPluginLogLevel,
  type PluginLogFormat,
  type PluginLogLevel,
} from "./levels.js";
import type { PluginLogger } from "./plugin-logger.js";

/** Runtime metadata exposed to logging-settings and diagnostics consumers. */
export interface RegisteredPluginLogger {
  /** Process-local identity of this root logger instance. */
  readonly registrationId: number;
  readonly pluginId: string;
  readonly dir: string;
  readonly level: PluginLogLevel;
  readonly format: PluginLogFormat;
}

/** Receives a complete snapshot whenever the process-wide registry changes. */
export type PluginLoggerRegistryListener = (
  loggers: readonly RegisteredPluginLogger[],
) => void;

/** Internal structural contract shared safely across duplicate package loads. */
export interface RegistryLoggerCore {
  readonly pluginId: string;
  readonly dir: string;
  readonly registrationId: number | undefined;
  isClosed(): boolean;
  key(): string;
  setLevel(level: PluginLogLevel): void;
  setFormat(format: PluginLogFormat): void;
  get level(): PluginLogLevel;
  get format(): PluginLogFormat;
}

export interface RegistryEntry {
  core: RegistryLoggerCore;
  root: PluginLogger;
}

export interface GlobalRegistryState {
  readonly version: 1;
  nextRegistrationId: number;
  readonly cache: Map<string, RegistryEntry>;
  readonly active: Map<number, RegistryLoggerCore>;
  readonly listeners: Set<PluginLoggerRegistryListener>;
}

const REGISTRY_SYMBOL = Symbol.for("@yadsh/dsh-plugin-log/registry/v1");

export function registryState(): GlobalRegistryState {
  const globalObject = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = globalObject[REGISTRY_SYMBOL] as
    GlobalRegistryState | undefined;
  if (existing?.version === 1) return existing;
  const created: GlobalRegistryState = {
    version: 1,
    nextRegistrationId: 1,
    cache: new Map(),
    active: new Map(),
    listeners: new Set(),
  };
  globalObject[REGISTRY_SYMBOL] = created;
  return created;
}

/** Snapshot of every active root logger, sorted for deterministic UI output. */
export function getRegisteredPluginLoggers(): readonly RegisteredPluginLogger[] {
  const snapshots: RegisteredPluginLogger[] = [];
  for (const [registrationId, core] of registryState().active) {
    if (core.isClosed()) continue;
    snapshots.push(
      Object.freeze({
        registrationId,
        pluginId: core.pluginId,
        dir: core.dir,
        level: core.level,
        format: core.format,
      }),
    );
  }
  return Object.freeze(
    snapshots.sort(
      (left, right) =>
        left.pluginId.localeCompare(right.pluginId) ||
        left.dir.localeCompare(right.dir) ||
        left.registrationId - right.registrationId,
    ),
  );
}

export function notifyRegistryListeners(): void {
  const state = registryState();
  const snapshot = getRegisteredPluginLoggers();
  for (const listener of state.listeners) {
    try {
      listener(snapshot);
    } catch {
      // Registry observers must never affect logging or plugin execution.
    }
  }
}

/**
 * Subscribe to registry snapshots. The listener is called immediately and
 * after registration, close, or a level change. Returns an idempotent cleanup.
 */
export function subscribePluginLoggerRegistry(
  listener: PluginLoggerRegistryListener,
): () => void {
  const listeners = registryState().listeners;
  listeners.add(listener);
  try {
    listener(getRegisteredPluginLoggers());
  } catch {
    // Keep the registry fail-open just like the logger itself.
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Change the level of every active logger owned by `pluginId`. */
export function setPluginLogLevel(
  pluginId: string,
  level: PluginLogLevel,
): number {
  if (!isPluginLogLevel(level)) {
    throw new TypeError(`unknown plugin log level: ${JSON.stringify(level)}`);
  }
  let updated = 0;
  for (const core of registryState().active.values()) {
    if (!core.isClosed() && core.pluginId === pluginId) {
      core.setLevel(level);
      updated += 1;
    }
  }
  return updated;
}

/** Change the format of every active plugin logger. */
export function setPluginLogFormat(format: PluginLogFormat): number {
  if (!isPluginLogFormat(format)) {
    throw new TypeError(`unknown plugin log format: ${JSON.stringify(format)}`);
  }
  let updated = 0;
  for (const core of registryState().active.values()) {
    if (!core.isClosed()) {
      core.setFormat(format);
      updated += 1;
    }
  }
  return updated;
}
