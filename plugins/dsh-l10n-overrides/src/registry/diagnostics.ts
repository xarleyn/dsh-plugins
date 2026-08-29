import type { DiagnosticEntry, DiagnosticLevel } from "../types.js";

type DiagnosticLogger = Pick<Console, "info" | "warn" | "error" | "debug">;

const PREFIX = "[dsh-l10n-overrides]";

export class Diagnostics {
  readonly #debugEnabled: boolean;
  readonly #entries: DiagnosticEntry[] = [];

  constructor(
    private readonly logger: DiagnosticLogger = console,
    options: { readonly debug?: boolean } = {},
  ) {
    this.#debugEnabled = options.debug === true;
  }

  info(code: string, message: string): void {
    this.#record("info", "info", code, message);
  }

  warning(code: string, message: string): void {
    this.#record("warning", "warn", code, message);
  }

  error(code: string, message: string): void {
    this.#record("error", "error", code, message);
  }

  debug(code: string, message: string): void {
    if (!this.#debugEnabled) return;

    this.#record("debug", "debug", code, message);
  }

  snapshot(): readonly DiagnosticEntry[] {
    return Object.freeze(this.#entries.slice());
  }

  #record(
    level: DiagnosticLevel,
    loggerMethod: keyof DiagnosticLogger,
    code: string,
    message: string,
  ): void {
    this.#entries.push(Object.freeze({ level, code, message }));
    try {
      this.logger[loggerMethod](`${PREFIX} ${message}`);
    } catch {}
  }
}
