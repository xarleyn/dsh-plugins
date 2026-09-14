/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
/**
 * Shared OpenViking session-id helpers for memory plugin harnesses.
 */

export function deriveHarnessSessionId(prefix: string, sessionId: string, suffix: string = ""): string {
  if (!prefix || typeof prefix !== "string") {
    throw new Error("deriveHarnessSessionId requires a non-empty prefix");
  }
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("deriveHarnessSessionId requires a non-empty sessionId");
  }
  const base = `${prefix}${sessionId}`;
  if (!suffix) return base;
  const normalized = String(suffix).replace(/:/g, "-").replace(/[^A-Za-z0-9._-]/g, "-");
  return `${base}__${normalized}`;
}
