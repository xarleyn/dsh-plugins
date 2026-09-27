/**
 * Rendering of one record for the destinations a human reads: the console
 * mirror line and a `text`-format file line. Both receive fields the logger has
 * already redacted, and neither decides what is recorded — the record shape is
 * pino's, and `format.ts` only turns it into text.
 */

import { LEVEL_WEIGHT } from "./levels.js";

const LEVEL_LABEL = new Map<number, string>(
  Object.entries(LEVEL_WEIGHT).map(([level, weight]) => [
    weight,
    level.toUpperCase(),
  ]),
);

/** One readable `key=value` tail for the console mirror. */
export function formatConsole(
  event: string,
  fields?: Record<string, unknown>,
): string {
  if (fields === undefined) return event;
  const parts = Object.entries(fields).map(([key, value]) => {
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    return `${key}=${rendered}`;
  });
  return parts.length === 0 ? event : `${event} ${parts.join(" ")}`;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  const rendered = JSON.stringify(value);
  return rendered === undefined ? String(value) : rendered;
}

/** Renders one pino NDJSON line as the readable `text` format. */
export function renderTextRecord(line: string): string {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    const time =
      typeof record["time"] === "number"
        ? new Date(record["time"]).toISOString()
        : String(record["time"] ?? "-");
    const numericLevel =
      typeof record["level"] === "number" ? record["level"] : Number.NaN;
    const level = (
      LEVEL_LABEL.get(numericLevel) ?? String(record["level"] ?? "LOG")
    ).padEnd(5);
    const plugin = String(record["plugin"] ?? "unknown");
    const module =
      typeof record["module"] === "string" ? `/${record["module"]}` : "";
    const event = String(record["msg"] ?? "");
    const reserved = new Set(["level", "time", "plugin", "module", "msg"]);
    const fields = Object.entries(record)
      .filter(([key]) => !reserved.has(key))
      .map(([key, value]) => `${key}=${textValue(value)}`);
    return `${time} ${level} [${plugin}${module}] ${event}${fields.length === 0 ? "" : ` ${fields.join(" ")}`}\n`;
  } catch {
    return `${line}\n`;
  }
}
