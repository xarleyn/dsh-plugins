/**
 * The host modules' logging seam.
 *
 * The host modules take this narrow interface rather than a `PluginLogger` so
 * they can be exercised without a log file or a Cordis context, and so the
 * only place that knows `@yadsh/dsh-plugin-log` stays `src/index.ts`.
 */
export interface AuditLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
}

/** Discards everything; the default when no logger was supplied. */
export const AUDIT_LOGGER_NOOP: AuditLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
};

/** Collect records in memory — for tests that assert on diagnostics. */
export function createRecordingLogger(): AuditLogger & {
  readonly records: readonly {
    readonly level: "debug" | "info" | "warn";
    readonly event: string;
    readonly fields: Record<string, unknown>;
  }[];
} {
  const records: {
    level: "debug" | "info" | "warn";
    event: string;
    fields: Record<string, unknown>;
  }[] = [];
  const push =
    (level: "debug" | "info" | "warn") =>
    (event: string, fields: Record<string, unknown> = {}) => {
      records.push({ level, event, fields });
    };
  return {
    records,
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
  };
}
