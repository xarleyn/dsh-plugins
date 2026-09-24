import { describe, expect, it } from "vitest";
import { QA_DOCUMENTS_NOTE } from "../../src/prompt-notes.js";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  config,
  harness,
  noteNames,
  noteText,
} from "./prompt-notes.helpers.js";

describe("attached documents note", () => {
  it("sends an attached document to the pipeline in an attested chat", async () => {
    const { createSession, step } = harness({
      config: config(),
      qaSessions: ["session-root"],
    });
    const session = createSession("session-root");
    const appended = await step(session);
    const documents = appended.find((message) =>
      noteNames(message).includes(QA_DOCUMENTS_NOTE),
    );
    const text = noteText(documents);
    // The tools the routing depends on, the plain reader's refusal as the
    // expected answer, and the report to make when the pipeline refuses.
    expect(text).toContain("document_inspect");
    expect(text).toContain("document_to_markdown");
    expect(text).toContain("document_from_url");
    expect(text).toMatch(/binary/u);
    expect(text).toMatch(/refusal is expected/u);
    expect(await step(session)).toEqual([]);
  });

  it("stays out of chats the QA surface never attested", async () => {
    const { createSession, step } = harness({ config: config() });
    expect(await step(createSession("session-operator"))).toEqual([]);
  });

  it("reaches a delegated child through its root session", async () => {
    const { createSession, step } = harness({
      config: config(),
      qaSessions: ["session-root"],
    });
    createSession("session-root");
    const child = createSession("session-child", "session-root");
    expect((await step(child)).flatMap(noteNames)).toContain(QA_DOCUMENTS_NOTE);
  });

  it("is muted and reworded on its own", async () => {
    const muted = harness({
      config: resolveConfig({ notes: { documents: { enabled: false } } }),
      qaSessions: ["session-root"],
    });
    const silenced = await muted.step(muted.createSession("session-root"));
    expect(silenced.flatMap(noteNames)).not.toContain(QA_DOCUMENTS_NOTE);

    const reworded = harness({
      config: resolveConfig({
        notes: {
          documents: { template: "Приложенный документ читай конвейером." },
        },
      }),
      qaSessions: ["session-root"],
    });
    const appended = await reworded.step(
      reworded.createSession("session-root"),
    );
    const documents = appended.find((message) =>
      noteNames(message).includes(QA_DOCUMENTS_NOTE),
    );
    expect(noteText(documents)).toBe("Приложенный документ читай конвейером.");
  });
});
