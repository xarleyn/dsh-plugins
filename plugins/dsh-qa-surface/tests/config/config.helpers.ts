import { ConfigSchema } from "../../src/config.js";
import type { QaSurfaceConfig } from "../../src/types.js";

/** Parse through the Host's config path: schema first, resolver second. */
export function schemaParse(input: unknown): QaSurfaceConfig {
  const result = ConfigSchema["~standard"].validate(input);
  if ("issues" in result && result.issues !== undefined) {
    throw new Error(`schema rejected ${JSON.stringify(input)}`);
  }
  return (result as { value: QaSurfaceConfig }).value;
}
