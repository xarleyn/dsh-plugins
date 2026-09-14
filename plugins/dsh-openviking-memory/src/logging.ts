/**
 * File-backed logging for this plugin (`<$DSH_HOME>/logs/dsh-openviking-memory/
 * <YYYY-MM-DD>.log`, NDJSON — see docs/PLUGIN_LOGGING.md). Records keep
 * mirroring to the host context logger, which stays at the repository default
 * `warn` level so routine OpenViking telemetry never spams the console.
 */

import {
  createHostLoggerSink,
  getPluginLogger,
  type HostLoggerLike,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";

/** Plugin id used for the log directory and the runtime consumer registry. */
export const PLUGIN_ID = "dsh-openviking-memory";

/**
 * Build the plugin's logger. The file destination is opened at `debug` so the
 * diagnostic stages of the integration (recall, capture, commit, pending-queue
 * transitions) are recoverable after the fact; the console mirror follows the
 * shared `warn` default.
 */
export function createOpenVikingLogger(host: HostLoggerLike): PluginLogger {
  return getPluginLogger({
    pluginId: PLUGIN_ID,
    level: "debug",
    consoleSink: createHostLoggerSink(host),
  });
}
