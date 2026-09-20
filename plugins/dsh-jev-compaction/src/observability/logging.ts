/**
 * Structured plugin events (SPEC §27). The plugin logger from
 * `@yadsh/dsh-plugin-log` stays fail-open and never logs API keys, raw Jev
 * state or full tool outputs.
 */

import { getPluginLogger, type PluginLogger } from "@yadsh/dsh-plugin-log";

export const jevLogger: PluginLogger = getPluginLogger({
  pluginId: "dsh-jev-compaction",
});

/** Structured event names emitted by this plugin. */
export const JEV_EVENTS = {
  check: "jev-compaction/check",
  skip: "jev-compaction/skip",
  request: "jev-compaction/request",
  plan: "jev-compaction/plan",
  applied: "jev-compaction/applied",
  fallback: "jev-compaction/fallback",
  error: "jev-compaction/error",
  /**
   * The configured backend names an API key variable that is not set. Logged
   * once per backend at startup and on every settings change: the environment
   * is not part of the config, so the resolver cannot catch it — without this
   * line the first sign is a refused prune minutes later.
   */
  credentialMissing: "jev-compaction/credential-missing",
  queued: "jev-compaction/queued",
  /** Immediate result shaping at `tools/post-execute`. */
  shapingSkip: "jev-compaction/result-shaping-skip",
  shapingApplied: "jev-compaction/result-shaping-applied",
  shapingArchiveRoot: "jev-compaction/result-shaping-archive-root",
  shapingArchiveGc: "jev-compaction/result-shaping-archive-gc",
} as const;
