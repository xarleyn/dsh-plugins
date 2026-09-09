/**
 * Shared argument handling for the `dsh_cas_*` tools (SPEC §20, §25).
 */

import { parseCasRef } from "../cas/hash.js";
import { CasError } from "../cas/errors.js";

export interface RefArgs {
  readonly ref: string;
}

export function readRefArg(args: unknown): string {
  const ref = (args as RefArgs).ref;
  if (typeof ref !== "string") {
    throw new CasError("CAS_INVALID_ARGUMENT", "the \"ref\" argument is required and must be a sha256:... reference");
  }
  return parseCasRef(ref);
}

export function readOptionalInteger(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CasError("CAS_INVALID_ARGUMENT", `argument "${name}" must be an integer`);
  }
  return value;
}

export function readOptionalBoolean(args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new CasError("CAS_INVALID_ARGUMENT", `argument "${name}" must be a boolean`);
  }
  return value;
}

export function readOptionalString<T extends string>(args: Record<string, unknown>, name: string, allowed: readonly T[]): T | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new CasError("CAS_INVALID_ARGUMENT", `argument "${name}" must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

/** User-facing message for objects that GC removed or that never existed (SPEC §24). */
export function missingObjectMessage(ref: string): string {
  return [
    `CAS object ${ref} is no longer available.`,
    "It may have expired or been garbage-collected.",
    "If possible, re-run the original tool call to regenerate the content.",
  ].join(" ");
}
