import { describe, expect, it } from "vitest";
import { QA_REPORT_SOURCES_TOOL } from "../src/provenance/host-store.js";
import {
  QA_DELEGATION_NOTE,
  QA_DOCUMENTS_NOTE,
  QA_IDENTITY_NOTE,
  QA_SOURCE_PRIORITY_NOTE,
  QA_SOURCES_NOTE,
} from "../src/prompt-notes.js";
import { resolveConfig } from "../src/resolve-config.js";
import {
  config,
  harness,
  noteNames,
  noteText,
  owningStore,
} from "./prompt-notes.helpers.js";

describe("source provenance note", () => {
  it("reaches an attested session and names the fallback tool", async () => {
    const { createSession, step } = harness({
      config: config(),
      qaSessions: ["session-root"],
    });
    const session = createSession("session-root");
    const appended = await step(session);
    // One note per concern: provenance, delegation naming, document routing,
    // source priority. Identity needs an owning account, so it is absent here.
    expect(appended.flatMap(noteNames).sort()).toEqual(
      [
        QA_SOURCES_NOTE,
        QA_DELEGATION_NOTE,
        QA_DOCUMENTS_NOTE,
        QA_SOURCE_PRIORITY_NOTE,
      ].sort(),
    );
    expect(noteText(appended[0])).toMatch(/manual Sources\/Источники/u);
    expect(noteText(appended[0])).toContain(QA_REPORT_SOURCES_TOOL);
    expect(await step(session)).toEqual([]);
  });

  it("stays out of chats the QA surface never attested", async () => {
    const { createSession, step } = harness({ config: config() });
    expect(await step(createSession("session-operator"))).toEqual([]);
  });

  it("follows the sources switches", async () => {
    const noSources = harness({
      config: resolveConfig({ sources: { enabled: false } }),
      qaSessions: ["session-root"],
    });
    const silenced = await noSources.step(
      noSources.createSession("session-root"),
    );
    // Sources fall silent with the switch; the delegation, documents and
    // source-priority notes do not depend on them and still reach an attested
    // chat.
    expect(silenced.map(noteNames)).toEqual([
      [QA_DELEGATION_NOTE],
      [QA_DOCUMENTS_NOTE],
      [QA_SOURCE_PRIORITY_NOTE],
    ]);

    const noFallback = harness({
      config: resolveConfig({
        sources: { subagents: { enableReportToolFallback: false } },
      }),
      qaSessions: ["session-root"],
    });
    const appended = await noFallback.step(
      noFallback.createSession("session-root"),
    );
    expect(noteText(appended[0])).toMatch(/manual Sources\/Источники/u);
    expect(noteText(appended[0])).not.toContain(QA_REPORT_SOURCES_TOOL);
  });

  it("reaches a delegated child through its root session", async () => {
    const { createSession, step } = harness({
      config: config(),
      qaSessions: ["session-root"],
    });
    createSession("session-root");
    const child = createSession("session-child", "session-root");
    expect(noteNames((await step(child))[0])).toEqual([QA_SOURCES_NOTE]);
  });

  it("carries every note in one step for an owned QA chat", async () => {
    const { accounts } = owningStore();
    const { createSession, step } = harness({
      accounts,
      config: config(),
      qaSessions: ["session-root"],
    });
    const session = createSession("session-root");
    const appended = await step(session);
    expect([...appended.flatMap(noteNames)].sort()).toEqual(
      [
        QA_SOURCES_NOTE,
        QA_IDENTITY_NOTE,
        QA_DELEGATION_NOTE,
        QA_DOCUMENTS_NOTE,
        QA_SOURCE_PRIORITY_NOTE,
      ].sort(),
    );
    expect(await step(session)).toEqual([]);
  });
});
