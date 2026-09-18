import { expect } from "vitest";

import { LightRagError } from "../src/errors.js";

/** Run a client call and return the thrown LightRagError. */
export async function caught(
  run: () => Promise<unknown>,
): Promise<LightRagError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(LightRagError);
    return error as LightRagError;
  }
  throw new Error("the call was expected to fail");
}
