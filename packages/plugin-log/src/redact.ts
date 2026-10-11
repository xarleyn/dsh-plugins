/**
 * Redaction policy of a single logger.
 *
 * The `redact` option is read once, when the logger is built, and the redactor
 * it produces is applied to every record's fields before the sinks branch — so
 * no destination can be handed a value the plugin asked away.
 */

import redact from "@pinojs/redact";

/** What a redacted field is replaced with — the same text pino writes. */
const REDACTION_CENSOR = "[Redacted]";

/**
 * Redacts one record's fields into a copy the logger owns, and throws when a
 * property the walk reaches is a getter that throws. Only the objects along a
 * redaction path are cloned, so a value the paths never address stays shared
 * with the caller.
 */
export type FieldRedactor = (
  fields: Record<string, unknown>,
) => Record<string, unknown>;

/**
 * Build the redactor every sink of one logger reads through.
 *
 * `@pinojs/redact` is the package pino itself redacts the file sink with, so a
 * path addressed inside the fields object cuts the same value here as it cuts
 * there. Paths are prefixed to make the fields object the root: what pino
 * additionally redacts at the root of its own line — its `plugin` and `module`
 * bindings and `msg` (this wrapper's `event`) — is not part of the fields and is
 * therefore cut in the file only. The fields travel under a holder key because,
 * asked for an object rather than a string, the package also writes an
 * enumerable `restore()` onto the object it returns; the holder absorbs that
 * helper and is dropped.
 */
export function buildFieldRedactor(
  paths: readonly string[],
): FieldRedactor | undefined {
  if (paths.length === 0) return undefined;
  const redactor = redact({
    paths: paths.map((path) => `fields.${path}`),
    censor: REDACTION_CENSOR,
    serialize: false,
    strict: false,
  });
  return (fields) => {
    const holder = redactor({ fields }) as {
      fields: Record<string, unknown>;
    };
    return holder.fields;
  };
}
