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
  queued: "jev-compaction/queued",
} as const;
