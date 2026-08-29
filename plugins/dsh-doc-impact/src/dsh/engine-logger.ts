import { getPluginLogger } from '../logging/index.js';
import type { PluginLogger } from '../logging/index.js';

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
    consoleSink: (level, message) => {
      // Engine and config-source messages already carry a `dsh-doc-impact: `
      // prefix; drop the duplicate behind the scope tag when mirroring.
      const text = message.replace('[dsh-doc-impact] dsh-doc-impact: ', '[dsh-doc-impact] ');
      if (level === 'warn') host.warn(text);
      else if (level === 'error' || level === 'fatal') host.error(text);
      else host.info(text);
    },
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
