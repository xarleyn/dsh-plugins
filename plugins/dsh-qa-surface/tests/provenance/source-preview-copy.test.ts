import { describe, expect, it } from "vitest";
import { sourcePreviewFailureCopy } from "../../src/client/source-preview.js";

/** The wire failure carrier folds a Host error into an object with a message. */
function refusal(reason: string) {
  return {
    message: `QA source preview refused the request (reason: ${reason})`,
  };
}

describe("source preview failure copy", () => {
  it("names the readable directories for a path outside the roots", () => {
    expect(sourcePreviewFailureCopy(refusal("outside-roots"))).toMatch(
      /вне каталогов, доступных/u,
    );
  });

  it("says when the source left the chat's evidence", () => {
    expect(sourcePreviewFailureCopy(refusal("not-evidence"))).toMatch(
      /не входит в доказательства/u,
    );
  });

  it("keeps the moved-file sentence for anything else", () => {
    const moved = /был перемещён/u;
    expect(sourcePreviewFailureCopy(refusal("unavailable"))).toMatch(moved);
    expect(sourcePreviewFailureCopy(new Error("boom"))).toMatch(moved);
    expect(sourcePreviewFailureCopy(undefined)).toMatch(moved);
  });
});
