import { ConfigSchema, readConfigRefs } from "../../src/config.js";
import type { QaSurfaceConfigRefs } from "../../src/config.js";
import type { QaSurfaceConfig } from "../../src/types.js";

/** Run an entry through the Host's config path and answer with its references. */
export function schemaRefs(input: unknown): Partial<QaSurfaceConfigRefs> {
  const result = ConfigSchema["~standard"].validate(input);
  if ("issues" in result && result.issues !== undefined) {
    throw new Error(`schema rejected ${JSON.stringify(input)}`);
  }
  return (result as { value: Partial<QaSurfaceConfigRefs> }).value;
}

/**
 * Parse an entry the way the Host does and hand the caller the plain data the
 * resolvers read: the schema mints a volatile reference for every field it
 * declares volatile, and a case asserts on values, not on references.
 */
export function schemaParse(input: unknown): QaSurfaceConfig {
  return readConfigRefs(schemaRefs(input));
}
