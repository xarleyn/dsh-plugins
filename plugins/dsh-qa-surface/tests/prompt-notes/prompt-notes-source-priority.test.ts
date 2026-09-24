import { describe, expect, it } from "vitest";
import {
  QA_SOURCE_PRIORITY_NOTE,
  QA_SOURCE_PRIORITY_NOTE_TEMPLATE,
} from "../../src/prompt-notes.js";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  config,
  harness,
  noteNames,
  noteText,
} from "./prompt-notes.helpers.js";

describe("source-priority note", () => {
  it("tells an attested chat where an answer belongs before memory", async () => {
    const { createSession, step } = harness({
      config: config(),
      qaSessions: ["session-root"],
    });
    const session = createSession("session-root");
    const appended = await step(session);
    const note = appended.find((message) =>
      noteNames(message).includes(QA_SOURCE_PRIORITY_NOTE),
    );
    expect(noteText(note)).toBe(QA_SOURCE_PRIORITY_NOTE_TEMPLATE);
    expect(noteText(note)).toMatch(/product documentation/u);
    expect(noteText(note)).toMatch(/only then look in memory/u);
    expect(await step(session)).toEqual([]);
  });

  it("stays out of chats the QA surface never attested", async () => {
    const { createSession, step } = harness({ config: config() });
    expect(await step(createSession("session-operator"))).toEqual([]);
  });

  it("follows its own switch and template", async () => {
    const muted = harness({
      config: resolveConfig({ notes: { sourcePriority: { enabled: false } } }),
      qaSessions: ["session-root"],
    });
    const silenced = await muted.step(muted.createSession("session-root"));
    expect(silenced.flatMap(noteNames)).not.toContain(QA_SOURCE_PRIORITY_NOTE);

    const reworded = harness({
      config: config({
        notes: {
          sourcePriority: {
            template: "Сначала документация и эксперт, память — потом.",
          },
        },
      }),
      qaSessions: ["session-root"],
    });
    const appended = await reworded.step(
      reworded.createSession("session-root"),
    );
    const note = appended.find((message) =>
      noteNames(message).includes(QA_SOURCE_PRIORITY_NOTE),
    );
    expect(noteText(note)).toBe(
      "Сначала документация и эксперт, память — потом.",
    );
  });
});
