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
    expect((await step(session)).flatMap(noteNames)).not.toContain(
      QA_DOCUMENTS_NOTE,
    );
    const appended = await step(session, {
      proposed: [{ source: { kind: "user" }, content: [{ type: "file" }] }],
    });
    const documents = appended.find((message) =>
      noteNames(message).includes(QA_DOCUMENTS_NOTE),
    );
    const text = noteText(documents);
    expect(text).toContain("document_inspect");
    expect(text).toContain("spreadsheet skill");
    expect(text).toContain("private workflow first");
    expect(text).toContain("files/<shard>/<sha>/<name>");
    expect(text).toContain("verified filename");
    expect(await step(session)).toEqual([]);
  });

  it("recovers attachment routing behind an active compact checkpoint", async () => {
    const f = harness({ config: config(), qaSessions: ["session-root"] });
    const session = f.createSession("session-root");
    session.events.push({
      type: "user/message",
      data: { source: { kind: "user" }, content: [{ type: "file" }] },
    });
    session.events.push({
      type: "user/message",
      data: { source: { kind: "compact-checkpoint", compactionId: "fixture" } },
    });
    session.surface.nodes.push(1);
    Object.assign(session, {
      snapshotEvents: () => [
        ...session.events,
        {
          type: "compaction/summary",
          data: { compactionId: "fixture", shadowedSeqs: [0] },
        },
      ],
    });
    expect((await f.step(session)).flatMap(noteNames)).toContain(
      QA_DOCUMENTS_NOTE,
    );
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
    expect(
      (
        await step(child, {
          proposed: [
            {
              source: { kind: "user" },
              content: [{ type: "text", text: "Resend the DOCX" }],
            },
          ],
        })
      ).flatMap(noteNames),
    ).toContain(QA_DOCUMENTS_NOTE);
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
