import { describe, expect, it, onTestFinished } from "vitest";
import { QA_IDENTITY_NOTE } from "../../src/prompt-notes.js";
import {
  config,
  harness,
  noteNames,
  owningStore,
} from "./prompt-notes.helpers.js";

function fixture() {
  const { accounts } = owningStore();
  const f = harness({
    accounts,
    config: config(),
    qaSessions: ["session-root"],
  });
  onTestFinished(() => {
    f.notes.dispose();
    accounts.close();
  });
  return { ...f, session: f.createSession("session-root") };
}

describe("retained QA notes", () => {
  it("restores every removed note on the first step after compaction without reloading", async () => {
    const f = fixture();
    const initial = await f.step(f.session);
    expect(initial).toHaveLength(4);
    f.session.surface.nodes.splice(0);
    expect(f.session.events).toHaveLength(4);

    const restored = await f.step(f.session);
    expect(restored.flatMap(noteNames)).toEqual(initial.flatMap(noteNames));
    expect(await f.step(f.session)).toEqual([]);
  });

  it("restores only the note removed from an otherwise retained surface", async () => {
    const f = fixture();
    await f.step(f.session);
    const identity = f.session.surface.nodes.findIndex((seq) =>
      noteNames(f.session.events[seq]!.data).includes(QA_IDENTITY_NOTE),
    );
    f.session.surface.nodes.splice(identity, 1);
    const restored = await f.step(f.session);
    expect(restored.flatMap(noteNames)).toEqual([QA_IDENTITY_NOTE]);
    expect(await f.step(f.session)).toEqual([]);
  });

  it("does not mark an uncommitted proposal as already carried", async () => {
    const f = fixture();
    const abandoned = await f.step(f.session, { commit: false });
    expect(abandoned).toHaveLength(4);
    expect(f.session.surface.nodes).toEqual([]);
    expect((await f.step(f.session)).flatMap(noteNames)).toEqual(
      abandoned.flatMap(noteNames),
    );
    expect(await f.step(f.session)).toEqual([]);
  });

  it("recognizes matching notes already proposed for the current step", async () => {
    const f = fixture();
    const proposed = await f.step(f.session, { commit: false });
    expect(await f.step(f.session, { proposed })).toEqual([]);
    expect(await f.step(f.session)).toEqual([]);
  });

  it("restores removed context after a cold reload and then remains silent", async () => {
    const f = fixture();
    const initial = await f.step(f.session);
    f.notes.dispose();
    f.session.surface.nodes.splice(0);
    const reloaded = f.newNotes();
    try {
      expect((await f.step(f.session)).flatMap(noteNames)).toEqual(
        initial.flatMap(noteNames),
      );
      expect(await f.step(f.session)).toEqual([]);
    } finally {
      reloaded.dispose();
    }
  });
});
