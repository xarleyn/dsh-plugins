import { describe, expect, it } from "vitest";

import { resolvePostExecuteContent } from "../src/post-execute.js";

describe("effective post-execute content", () => {
  const original = [{ type: "text", text: "original" }];

  it("uses the original content when no downstream replacement exists", () => {
    expect(resolvePostExecuteContent({ kind: "accept" }, original)).toEqual({
      kind: "content",
      decision: { kind: "accept" },
      content: original,
      replaced: false,
    });
  });

  it.each([{ content: [{ type: "text", text: "reviewed" }] }, { content: [] }])(
    "uses an accepted projection including an empty one: %j",
    ({ content }) => {
      const resolved = resolvePostExecuteContent(
        { kind: "accept", content },
        original,
      );
      expect(resolved).toEqual({
        kind: "content",
        decision: { kind: "accept", content },
        content,
        replaced: true,
      });
      if (resolved.kind === "content") expect(resolved.content).toBe(content);
    },
  );

  it.each([null, false, 0, "", { reviewed: true }])(
    "leaves value %j to the Host renderer",
    (value) => {
      expect(
        resolvePostExecuteContent(
          { kind: "accept", value, content: original },
          original,
        ),
      ).toEqual({ kind: "value-replacement" });
    },
  );

  it("does not process a blocked decision", () => {
    expect(resolvePostExecuteContent({ kind: "block" }, original)).toEqual({
      kind: "blocked",
    });
  });
});
