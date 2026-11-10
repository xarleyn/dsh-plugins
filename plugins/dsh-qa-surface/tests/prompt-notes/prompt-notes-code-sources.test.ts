import { describe, expect, it } from "vitest";
import { QA_CODE_SOURCES_NOTE } from "../../src/prompt-notes.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { harness, noteNames, noteText } from "./prompt-notes.helpers.js";

describe("code source routing note", () => {
  it("routes attested chats through scoped tools and carries source to delegations", async () => {
    const h = harness({
      config: resolveConfig({
        codeSources: {
          entries: [
            { id: "stable", label: "Release", path: "/code/arbitrary" },
          ],
        },
      }),
      qaSessions: ["session-root"],
    });
    const notes = await h.step(h.createSession("session-root"));
    const text = noteText(
      notes.find((message) =>
        noteNames(message).includes(QA_CODE_SOURCES_NOTE),
      ),
    );
    expect(text).toContain("code_search/code_read");
    expect(text).toContain("repeat it on every call");
    expect(text).toContain("pass it to subagents");
    const other = await h.step(h.createSession("unmanaged"));
    expect(other.flatMap(noteNames)).not.toContain(QA_CODE_SOURCES_NOTE);
  });
});
