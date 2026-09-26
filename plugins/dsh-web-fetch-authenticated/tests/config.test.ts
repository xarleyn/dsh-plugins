/**
 * The live-config contract (SPEC §7/§23 against Host `0.1.7`).
 *
 * Which schema nodes carry `.volatile()` is a runtime contract the compiler
 * cannot check: drop one and the Host silently refuses the card's write to that
 * path, and mark one inside an array item, a dictionary value or a union member
 * and the profile is rejected while it resolves. These tests pin the set.
 */

import { describe, expect, test } from "vitest";
import type Schema from "@deepseek-ai/schemastery";
import { ConfigSchema } from "../src/config.js";

/** Every child node of `schema`, whatever kind of container it is. */
function children(schema: Schema): Schema[] {
  return [
    ...Object.values(schema.dict ?? {}),
    ...Object.values(schema.refs ?? {}),
    ...(schema.list ?? []),
    ...(schema.inner ? [schema.inner] : []),
  ];
}

function liveNodes(schema: Schema): number {
  return (
    (schema.meta?.volatile === true ? 1 : 0) +
    children(schema).reduce((total, child) => total + liveNodes(child), 0)
  );
}

describe("live configuration surface", () => {
  test("exactly the fields the card edits are live", () => {
    expect(
      Object.entries(ConfigSchema.dict ?? {})
        .filter(([, field]) => field.meta?.volatile === true)
        .map(([key]) => key),
    ).toEqual([
      "enabled",
      "rules",
      "defaultPolicy",
      "limits",
      "documents",
      "audit",
    ]);
  });

  test("nothing nested is live, because the Host rejects an enclosed volatile node", () => {
    expect(liveNodes(ConfigSchema)).toBe(6);
  });
});
