import { describe, expect, it } from "vitest";
import { QA_IDENTITY_NOTE, QA_NOTES_PLUGIN } from "../../src/prompt-notes.js";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  config,
  harness,
  noteNames,
  noteText,
  owningStore,
  store,
} from "./prompt-notes.helpers.js";

describe("identity note", () => {
  it("stays silent while the chat has no owner", async () => {
    const { createSession, step } = harness({ accounts: store() });
    expect(await step(createSession("session-orphan"))).toEqual([]);
  });

  it("adds one note carrying the name, handles and instructions", async () => {
    const { accounts } = owningStore();
    accounts.setProfile("i.ivanov@example.com", {
      fullName: "Иван Иванов",
      identities: { jira: "i.ivanov" },
      instructions: "Отвечай кратко.",
    });
    const { createSession, step } = harness({ accounts, config: config() });
    const session = createSession("session-root");
    const appended = await step(session);
    expect(appended.length).toBe(1);
    const text = noteText(appended[0]);
    expect(text).toContain("Иван Иванов <i.ivanov@example.com>");
    expect(text).toContain("- Jira: i.ivanov");
    expect(text).toContain("Отвечай кратко.");
    expect(noteNames(appended[0])).toEqual([QA_IDENTITY_NOTE]);
    const source = appended[0]?.source as {
      readonly kind: string;
      readonly plugin: string;
      readonly form: string;
    };
    expect(source).toMatchObject({
      kind: "plugin",
      plugin: QA_NOTES_PLUGIN,
      form: "snapshot",
    });
    // The note is written once: the next step finds it in the conversation.
    expect(await step(session)).toEqual([]);
  });

  it("gives a delegated child its own copy", async () => {
    const { accounts } = owningStore();
    const { createSession, step } = harness({ accounts, config: config() });
    createSession("session-root");
    const child = createSession("session-child", "session-root");
    expect(noteText((await step(child))[0])).toContain("i.ivanov@example.com");
  });

  it("writes again only after the profile changed", async () => {
    const { accounts } = owningStore();
    const { createSession, step } = harness({ accounts, config: config() });
    const session = createSession("session-root");
    expect((await step(session)).length).toBe(1);
    accounts.setProfile("i.ivanov@example.com", {
      fullName: "",
      identities: { gitlab: "@iivanov" },
      instructions: "",
    });
    const afterEdit = await step(session);
    expect(afterEdit.length).toBe(1);
    expect(noteText(afterEdit[0])).toContain("- GitLab: @iivanov");
    expect(await step(session)).toEqual([]);
  });

  it("never repeats a note after a cold start", async () => {
    const { accounts } = owningStore();
    const first = harness({ accounts, config: config() });
    const session = first.createSession("session-root");
    expect((await first.step(session)).length).toBe(1);
    // A reloaded plugin holds no memory of the note; the conversation does.
    first.notes.dispose();
    const second = first.newNotes();
    expect(await first.step(session)).toEqual([]);
    second.dispose();
  });

  it("stays silent when the account is disabled or the feature is off", async () => {
    const { accounts } = owningStore();
    accounts.setUserDisabled("i.ivanov@example.com", true);
    const disabled = harness({ accounts, config: config() });
    expect(await disabled.step(disabled.createSession("session-a"))).toEqual(
      [],
    );

    const live = owningStore();
    const off = harness({
      accounts: live.accounts,
      config: resolveConfig({
        accounts: { enabled: true, profile: { inject: false } },
      }),
    });
    expect(await off.step(off.createSession("session-b"))).toEqual([]);
  });

  it("stops injecting once disposed", async () => {
    const { accounts } = owningStore();
    const { notes, createSession, step } = harness({
      accounts,
      config: config(),
    });
    notes.dispose();
    expect(await step(createSession("session-root"))).toEqual([]);
  });
});
