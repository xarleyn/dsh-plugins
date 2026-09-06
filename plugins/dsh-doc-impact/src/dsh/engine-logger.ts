import { createHostLoggerSink, getPluginLogger } from '@yadsh/dsh-plugin-log';
import type { PluginLogger } from '@yadsh/dsh-plugin-log';

interface HostLoggerLike {
  info(message: string, ...values: unknown[]): void;
  warn(message: string, ...values: unknown[]): void;
  error(message: string, ...values: unknown[]): void;
}

/**
 * File-backed engine logger (`<$DSH_HOME>/logs/dsh-doc-impact/<YYYY-MM-DD>.log`,
 * NDJSON — see docs/PLUGIN_LOGGING.md). Every message is still mirrored to the
 * host context logger, preserving the pre-file behavior one-to-one; the file
 * simply captures the same records for later inspection. The plugin has no
 * dispose seam, so the destination lives for the host process lifetime;
 * `close()` stays available for tests and future teardown wiring.
 */
export interface EngineFileLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Flush and close the underlying destination (idempotent). */
  close(): Promise<void>;
}

export function createEngineFileLogger(
  host: HostLoggerLike,
  options?: { readonly dir?: string },
): EngineFileLogger {
  const file: PluginLogger = getPluginLogger({
    pluginId: 'dsh-doc-impact',
    ...(options?.dir === undefined ? {} : { dir: options.dir }),
    console: 'trace',
    // Engine and config-source messages carry no plugin-name prefix: the
    // shared sink mirrors every record (file and mirror) with the plugin id,
    // and `verboseToInfo` keeps the pre-file one-to-one host mirror.
    consoleSink: createHostLoggerSink(host, { verboseToInfo: true }),
  });
  return {
    info(message) {
      file.info(message);
    },
    warn(message) {
      file.warn(message);
    },
    error(message) {
      file.error(message);
    },
    close() {
      return file.close();
    },
  };
}
