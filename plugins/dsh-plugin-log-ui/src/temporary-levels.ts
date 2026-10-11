/**
 * The levels the operator is holding for a moment, without saving them.
 *
 * A saved override is a Config write, and a Config write is durable: an operator
 * who turns DEBUG on to answer one question leaves it on for the stand, and needs a
 * second trip to the same card to undo it. A temporary level is the call those
 * settings end in — `setPluginLogLevel` on the live loggers — held for a window or
 * until it is revoked, with nothing written behind it. So two things follow, and
 * both live here rather than in the service: the window has to close on a timer,
 * because the card that opened it can be closed and nobody would be left to poll,
 * and it has to be checked on read, because a Host that was paused through the
 * window owes the plugin its settings level the moment someone asks again.
 */

import { MANAGED_LOG_LEVELS, PLUGIN_ID_PATTERN } from "./config.js";
import type {
  ManagedPluginLogLevel,
  PluginLogTemporaryLevel,
  PluginLogTemporaryScope,
} from "./types.js";

/** The longest window one call can ask for, in minutes: a shift, not a policy. */
export const MAX_TEMPORARY_LEVEL_MINUTES = 240;

const MINUTES_IN_MS = 60_000;

/**
 * Start a callback `delayMs` from now and return its cancellation. A seam so a
 * test can fire the window instead of waiting for wall-clock minutes.
 */
export type TemporaryLevelScheduler = (
  callback: () => void,
  delayMs: number,
) => () => void;

/**
 * `| undefined` on every field, not just `?`: the service forwards the options it
 * was handed, and under `exactOptionalPropertyTypes` a possibly-undefined value
 * may not be written to an optional property.
 */
export interface TemporaryLevelsOptions {
  readonly now?: (() => number) | undefined;
  readonly schedule?: TemporaryLevelScheduler | undefined;
  /** Re-run the policy when a window closes on its own, so the level goes back. */
  readonly onLapse?: (() => void) | undefined;
}

interface TemporaryEntry {
  readonly level: ManagedPluginLogLevel;
  /** Epoch ms the window closes at; `undefined` is the level that holds until revoked. */
  readonly expiresAt: number | undefined;
  readonly cancel: () => void;
}

const defaultScheduler: TemporaryLevelScheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  // A held window must not keep the process alive: the operator who set it for
  // an hour may shut the Host down long before it closes.
  timer.unref();
  return () => clearTimeout(timer);
};

function assertPluginId(pluginId: string): void {
  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new TypeError(
      `plugin log level id is invalid: ${JSON.stringify(pluginId)}`,
    );
  }
}

function assertLevel(level: ManagedPluginLogLevel): void {
  if (!MANAGED_LOG_LEVELS.includes(level)) {
    throw new TypeError(
      `plugin log level is invalid: ${JSON.stringify(level)}`,
    );
  }
}

function assertMinutes(minutes: number | undefined): void {
  if (minutes === undefined) return;
  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > MAX_TEMPORARY_LEVEL_MINUTES
  ) {
    throw new TypeError(
      `temporary plugin log window must be a whole number of minutes from 1 to ${MAX_TEMPORARY_LEVEL_MINUTES}, got ${JSON.stringify(minutes)}`,
    );
  }
}

/** The temporary levels of one Host process, keyed by plugin id. */
export class TemporaryLevels {
  private readonly entries = new Map<string, TemporaryEntry>();
  private readonly now: () => number;
  private readonly schedule: TemporaryLevelScheduler;
  private readonly onLapse: () => void;

  constructor(options: TemporaryLevelsOptions = {}) {
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? defaultScheduler;
    this.onLapse = options.onLapse ?? (() => undefined);
  }

  /**
   * Hold `level` for `pluginId`, replacing whatever it was held at.
   * @param minutes - the window; omitted holds the level until it is revoked.
   */
  set(pluginId: string, level: ManagedPluginLogLevel, minutes?: number): void {
    assertPluginId(pluginId);
    assertLevel(level);
    assertMinutes(minutes);
    this.release(pluginId);
    if (minutes === undefined) {
      this.entries.set(pluginId, {
        level,
        expiresAt: undefined,
        cancel: () => undefined,
      });
      return;
    }
    const delayMs = minutes * MINUTES_IN_MS;
    let cancel: () => void = () => undefined;
    const entry: TemporaryEntry = {
      level,
      expiresAt: this.now() + delayMs,
      cancel: () => cancel(),
    };
    cancel = this.schedule(() => {
      // Only the window that scheduled this callback may close through it: a
      // later `set` for the same plugin replaced the entry and its timer.
      if (this.entries.get(pluginId) !== entry) return;
      this.entries.delete(pluginId);
      this.onLapse();
    }, delayMs);
    this.entries.set(pluginId, entry);
  }

  /** Give up a held level. The caller re-applies its policy; this only drops state. */
  clear(pluginId: string): void {
    assertPluginId(pluginId);
    this.release(pluginId);
  }

  /**
   * The level `pluginId` is held at, or `undefined` when it is on its settings.
   * A window that closed while nobody asked is dropped here rather than returned.
   */
  levelOf(pluginId: string): ManagedPluginLogLevel | undefined {
    const entry = this.entries.get(pluginId);
    if (entry === undefined) return undefined;
    if (!this.lapsed(entry)) return entry.level;
    this.release(pluginId);
    return undefined;
  }

  /** Every held level still open, soonest to lapse first, for the card to mark. */
  list(): readonly PluginLogTemporaryLevel[] {
    for (const [pluginId, entry] of [...this.entries]) {
      if (this.lapsed(entry)) this.release(pluginId);
    }
    return Object.freeze(
      [...this.entries]
        .sort(
          (left, right) =>
            (left[1].expiresAt ?? Number.POSITIVE_INFINITY) -
              (right[1].expiresAt ?? Number.POSITIVE_INFINITY) ||
            left[0].localeCompare(right[0]),
        )
        .map(([pluginId, entry]) =>
          Object.freeze(
            entry.expiresAt === undefined
              ? {
                  pluginId,
                  level: entry.level,
                  scope: "session" satisfies PluginLogTemporaryScope,
                }
              : {
                  pluginId,
                  level: entry.level,
                  scope: "timed" satisfies PluginLogTemporaryScope,
                  remainingMs: Math.max(0, entry.expiresAt - this.now()),
                },
          ),
        ),
    );
  }

  /** Cancel every window; the levels themselves are the Host's to forget with it. */
  dispose(): void {
    for (const pluginId of [...this.entries.keys()]) this.release(pluginId);
  }

  private lapsed(entry: TemporaryEntry): boolean {
    return entry.expiresAt !== undefined && this.now() >= entry.expiresAt;
  }

  private release(pluginId: string): void {
    const entry = this.entries.get(pluginId);
    if (entry === undefined) return;
    entry.cancel();
    this.entries.delete(pluginId);
  }
}
