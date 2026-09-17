import { IntegrationError } from "./errors.js";

const MAX_INT = 2_147_483_647;

/**
 * The message a rejected argument carries. `explain` appends what a correct
 * value looks like, so a model can repair the call instead of retrying it.
 */
function invalid(field: string, explain?: string): never {
  throw new IntegrationError(
    "InvalidRequest",
    explain === undefined ? `${field} is invalid` : `${field} is invalid: ${explain}`,
  );
}

/** Model-supplied identifiers are positive integers or the argument is refused. */
export function requiredInteger(
  value: unknown,
  field: string,
  min = 1,
  max = MAX_INT,
): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    invalid(field);
  }
  return Number(value);
}

export function optionalInteger(
  value: unknown,
  field: string,
  min = 1,
  max = MAX_INT,
): number | undefined {
  return value === undefined
    ? undefined
    : requiredInteger(value, field, min, max);
}

export function requiredText(
  value: unknown,
  field: string,
  min: number,
  max: number,
  explain?: string,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length < min || normalized.length > max) {
    invalid(field, explain);
  }
  return normalized;
}

export function optionalText(
  value: unknown,
  field: string,
  min: number,
  max: number,
  explain?: string,
): string | undefined {
  return value === undefined
    ? undefined
    : requiredText(value, field, min, max, explain);
}

export function optionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") invalid(field);
  return value;
}

/** Date-only fields, as most REST APIs declare them. */
export function requiredDate(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) invalid(field);
  if (Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) invalid(field);
  return normalized;
}

export function optionalDate(
  value: unknown,
  field: string,
): string | undefined {
  return value === undefined ? undefined : requiredDate(value, field);
}

function requiredArray(
  value: unknown,
  field: string,
  maxItems: number,
): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    invalid(field);
  }
  return value;
}

export function requiredIntegerList(
  value: unknown,
  field: string,
  maxItems: number,
): number[] {
  return requiredArray(value, field, maxItems).map((item) =>
    requiredInteger(item, field),
  );
}

export function requiredStringList(
  value: unknown,
  field: string,
  maxItems: number,
  maxLength: number,
): string[] {
  return requiredArray(value, field, maxItems).map((item) =>
    requiredText(item, field, 1, maxLength),
  );
}

/**
 * The external account id, resolved server-side from the stored integration. It
 * backs "mine" defaults, so an operation that needs it must fail closed rather
 * than guess when the provider never reported one.
 */
export function externalUserIdFrom(
  externalUserId: string | undefined,
  operation: string,
): number {
  if (externalUserId === undefined || !/^\d+$/u.test(externalUserId)) {
    throw new IntegrationError(
      "InvalidRequest",
      `${operation} needs the connected account id, which is unknown`,
    );
  }
  return Number(externalUserId);
}
