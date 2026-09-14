/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
/**
 * Shared structured debug logger for OpenViking memory plugin hook scripts.
 *
 * Harness-specific wrappers load config and pass {debug, debugLogPath}. This
 * module stays path-agnostic so it can be vendored into each plugin snapshot.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function ensureDir(filePath: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    /* best effort */
  }
}

function writeLine(filePath: string, obj: unknown): void {
  try {
    appendFileSync(filePath, JSON.stringify(obj) + "\n");
  } catch {
    /* best effort */
  }
}

function localISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const sign = off <= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const local = new Date(d.getTime() - off * 60000);
  return local
    .toISOString()
    .replace(
      "Z",
      `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`,
    );
}

const noop = (): void => {};

export function createLogger(
  hookName: string,
  overrideCfg?: {
    readonly debug?: boolean;
    readonly debugLogPath?: string;
  } | null,
): {
  log(stage: string, data?: unknown): void;
  logError(stage: string, err: unknown): void;
} {
  const c: { readonly debug?: boolean; readonly debugLogPath?: string } =
    overrideCfg || {};
  if (!c.debug) return { log: noop, logError: noop };

  // `?? ""` rather than a truthiness test on the optional value: the closures
  // below need a plain `string`, and an empty path is equally "no file".
  const logPath = c.debugLogPath ?? "";
  if (!logPath) return { log: noop, logError: noop };
  ensureDir(logPath);

  function log(stage: string, data?: unknown): void {
    writeLine(logPath, { ts: localISO(), hook: hookName, stage, data });
  }

  function logError(stage: string, err: unknown): void {
    const error =
      err instanceof Error
        ? { message: err.message, stack: err.stack }
        : String(err);
    writeLine(logPath, { ts: localISO(), hook: hookName, stage, error });
  }

  return { log, logError };
}
