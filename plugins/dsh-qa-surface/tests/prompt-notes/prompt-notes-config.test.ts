import { describe, expect, it } from "vitest";
import { QA_REPORT_SOURCES_TOOL } from "../../src/provenance/host-store.js";
import {
  QA_DELEGATION_NOTE,
  QA_IDENTITY_NOTE,
  QA_SOURCES_NOTE,
} from "../../src/prompt-notes.js";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  config,
  harness,
  noteNames,
  noteText,
  owningStore,
} from "./prompt-notes.helpers.js";

describe("notes configuration", () => {
  it("defaults to every note on with the built-in wording", () => {
    const resolved = resolveConfig();
    expect(resolved.notes).toEqual({
      identity: { enabled: true, template: "" },
      sources: { enabled: true, template: "", fallbackTemplate: "" },
      delegation: { enabled: true, template: "" },
      documents: { enabled: true, template: "" },
      sourcePriority: { enabled: true, template: "" },
    });
  });

  it("mutes each note independently", async () => {
    const { accounts } = owningStore();
    const { createSession, step } = harness({
      accounts,
      config: config({
        notes: {
          identity: { enabled: false },
          sources: { enabled: false },
          delegation: { enabled: false },
          documents: { enabled: false },
          sourcePriority: { enabled: false },
        },
      }),
      qaSessions: ["session-root"],
    });
    const appended = await step(createSession("session-root"));
    expect(appended).toEqual([]);
  });

  it("renders the sources note from the configured templates", async () => {
    const custom = harness({
      config: config({
        notes: {
          sources: {
            template: "Источники собирай сам: список строится из твоих тулов.",
            fallbackTemplate:
              "Перед завершением вызови {reportTool}, пожалуйста.",
          },
        },
      }),
      qaSessions: ["session-root"],
    });
    const appended = await custom.step(custom.createSession("session-root"));
    const sources = appended.find((message) =>
      noteNames(message).includes(QA_SOURCES_NOTE),
    );
    expect(noteText(sources)).toBe(
      "Источники собирай сам: список строится из твоих тулов.\nПеред завершением вызови " +
        QA_REPORT_SOURCES_TOOL +
        ", пожалуйста.",
    );

    // A fallback template without the tool placeholder degrades to the
    // built-in sentence: a fallback that names no tool is not actionable.
    const broken = harness({
      config: config({
        notes: {
          sources: { fallbackTemplate: "Отчитайся перед завершением." },
        },
      }),
      qaSessions: ["session-root"],
    });
    const brokenNote = await broken.step(broken.createSession("session-root"));
    expect(noteText(brokenNote[0])).toContain(QA_REPORT_SOURCES_TOOL);
  });

  it("renders the identity note from the configured template", async () => {
    const { accounts } = owningStore();
    const templated = harness({
      accounts,
      config: config({
        notes: {
          identity: {
            template:
              "Автор запроса:\n{identity}\n\nПожелания:\n{instructions}",
          },
        },
      }),
      qaSessions: ["session-root"],
    });
    const appended = await templated.step(
      templated.createSession("session-root"),
    );
    const identity = appended.find((message) =>
      noteNames(message).includes(QA_IDENTITY_NOTE),
    );
    expect(noteText(identity)).toContain("Автор запроса:");
    expect(noteText(identity)).toContain("i.ivanov@example.com");
    // The profile carries no instructions yet, so the section renders empty
    // instead of leaking the placeholder into the prompt.
    expect(noteText(identity)).not.toContain("{instructions}");

    // A template without `{identity}` would inject a note that never says
    // who the user is; it falls back to the built-in composition.
    const broken = harness({
      accounts: owningStore().accounts,
      config: config({ notes: { identity: { template: "Привет, друг!" } } }),
      qaSessions: ["session-root"],
    });
    const brokenNote = await broken.step(broken.createSession("session-root"));
    const fallback = brokenNote.find((message) =>
      noteNames(message).includes(QA_IDENTITY_NOTE),
    );
    expect(noteText(fallback)).toContain("i.ivanov@example.com");
  });

  it("rewords the delegation note and mutes it independently", async () => {
    const { createSession, step } = harness({
      config: config({
        notes: {
          delegation: { template: "Назови субагента человеческим именем." },
        },
      }),
      qaSessions: ["session-root"],
    });
    const appended = await step(createSession("session-root"));
    const delegation = appended.find((message) =>
      noteNames(message).includes(QA_DELEGATION_NOTE),
    );
    expect(noteText(delegation)).toBe("Назови субагента человеческим именем.");

    const muted = harness({
      config: config({ notes: { delegation: { enabled: false } } }),
      qaSessions: ["session-root"],
    });
    const silenced = await muted.step(muted.createSession("session-root"));
    expect(silenced.flatMap(noteNames)).not.toContain(QA_DELEGATION_NOTE);
  });
});
