// The staged contract of the doc-impact settings form: which draft one field may
// carry, in which order the drafts commit, and what a save that did not land
// leaves behind. The type assertions here are part of the contract — an
// `@ts-expect-error` line stops the build once the draft types loosen again.
import { describe, expect, it } from "vitest";
import { DEFAULT_REMINDER_TEMPLATE } from "../src/engine/reminder.js";
import {
  SettingsForm,
  type NamespaceForm,
  type NamespaceOp,
  type NamespaceSnapshot,
} from "../src/client/settings-form.js";

/** A host form over one document, keeping the ops the Save pass commits. */
function stubForm(
  writes: NamespaceOp[],
  snapshot: NamespaceSnapshot,
  landed = true,
): NamespaceForm {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    mutate: async (ops: readonly NamespaceOp[]) => {
      writes.push(...ops);
      return landed;
    },
  };
}

/** The document every field of the card stands on, with a user layer to reset from. */
const OVERRIDDEN: NamespaceSnapshot = {
  status: "ready",
  value: {
    configFile: ".dsh/from-user.yml",
    defaults: { mode: "require-review" },
    changeDetection: { maxSnapshotFiles: 300 },
    debug: true,
  },
  base: {
    configFile: ".dsh/from-base.yml",
    defaults: { mode: "remind" },
    changeDetection: { maxSnapshotFiles: 100 },
  },
  user: {
    configFile: ".dsh/from-user.yml",
    defaults: { mode: "require-review" },
    changeDetection: { maxSnapshotFiles: 300 },
    debug: true,
  },
  writable: true,
  revision: 1,
};

/** A host form that answers every write by throwing, the way a moved-on revision fence does. */
function rejectingForm(snapshot: NamespaceSnapshot): NamespaceForm {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    mutate: async () => {
      throw new Error("revision fence moved on");
    },
  };
}

function paths(writes: readonly NamespaceOp[]): string[] {
  return writes.map((write) => `${write.op}:${write.path.join(".")}`);
}

describe("staged settings form", () => {
  it("commits every staged kind in staging order", async () => {
    const writes: NamespaceOp[] = [];
    const form = new SettingsForm(stubForm(writes, OVERRIDDEN));
    const actions = form.actions();

    actions.edit("configFile", ".dsh/other.yml");
    actions.choose("mode", "require-update");
    actions.choose("debug", false);
    actions.resetField("maxSnapshotFiles");
    expect(form.getSnapshot().dirty).toBe(true);

    await actions.save();
    expect(paths(writes)).toEqual([
      "set:configFile",
      "set:defaults.mode",
      "set:debug",
      "unset:changeDetection.maxSnapshotFiles",
    ]);
    expect(form.getSnapshot().dirty).toBe(false);
    expect(form.getSnapshot().failed).toBe(false);
  });

  it("keeps the drafts and reports the failure when a save does not land", async () => {
    const writes: NamespaceOp[] = [];
    const form = new SettingsForm(stubForm(writes, OVERRIDDEN, false));
    const actions = form.actions();

    actions.edit("maxReminderRounds", "4");
    await actions.save();
    expect(form.getSnapshot().failed).toBe(true);
    expect(form.getSnapshot().dirty).toBe(true);
    expect(writes).toHaveLength(1);

    actions.discard();
    expect(form.getSnapshot().dirty).toBe(false);
    expect(form.getSnapshot().failed).toBe(false);
  });

  it("keeps the drafts when the write throws instead of answering", async () => {
    const form = new SettingsForm(rejectingForm(OVERRIDDEN));
    const actions = form.actions();

    actions.choose("onLimit", "error");
    await actions.save();
    expect(form.getSnapshot().failed).toBe(true);
    expect(form.getSnapshot().dirty).toBe(true);

    // A rejected write releases the saving flag, so the card is not stuck in a
    // pass that never ends and the same draft can be committed on a retry.
    expect(form.getSnapshot().saving).toBe(false);
    await actions.save();
    expect(form.getSnapshot().failed).toBe(true);
    expect(form.getSnapshot().dirty).toBe(true);
  });

  it("projects a reset of every kind onto the layer it falls back to", async () => {
    const writes: NamespaceOp[] = [];
    const form = new SettingsForm(stubForm(writes, OVERRIDDEN));
    const actions = form.actions();

    actions.resetField("configFile"); // text
    actions.resetField("mode"); // choice
    actions.resetField("maxSnapshotFiles"); // number
    actions.resetField("debug"); // bool
    actions.resetField("reminderTemplate"); // multiline text, unset throughout

    const fields = form.getSnapshot().fields;
    // The preview of a reset is the composition base the write reveals.
    expect(fields.configFile.value).toBe(".dsh/from-base.yml");
    expect(fields.mode.value).toBe("remind");
    expect(fields.maxSnapshotFiles.value).toBe(100);
    expect(fields.maxSnapshotFiles.text).toBe("100");
    // Where no layer holds the field, the schema default stands — and a
    // multiline template shows that default as the text being returned to.
    expect(fields.debug.value).toBe(false);
    expect(fields.reminderTemplate.value).toBe(DEFAULT_REMINDER_TEMPLATE);
    expect(fields.reminderTemplate.text).toBe(DEFAULT_REMINDER_TEMPLATE);
    for (const field of [
      "configFile",
      "mode",
      "maxSnapshotFiles",
      "debug",
      "reminderTemplate",
    ] as const) {
      expect(fields[field].overridden, field).toBe(false);
      expect(fields[field].invalid, field).toBe(false);
    }

    // A field the user layer never carried has nothing to drop, so the write
    // list stays with the four overrides the document really holds.
    await form.save();
    expect(paths(writes)).toEqual([
      "unset:configFile",
      "unset:defaults.mode",
      "unset:changeDetection.maxSnapshotFiles",
      "unset:debug",
    ]);
  });

  it("reads a document node that is not a scalar as no value", () => {
    const writes: NamespaceOp[] = [];
    const form = new SettingsForm(
      stubForm(writes, {
        ...OVERRIDDEN,
        value: { defaults: { mode: { nested: true } } },
        base: undefined,
      }),
    );
    // The namespace document is the Host's JSON and the specs only describe it:
    // an object where a field promises a scalar stays out of the field's value
    // type instead of being asserted into it.
    expect(form.getSnapshot().fields.mode.value).toBe("remind");
  });

  it("sends a number the schema refuses, because the card knows only integers", async () => {
    const writes: NamespaceOp[] = [];
    const form = new SettingsForm(stubForm(writes, OVERRIDDEN));
    const actions = form.actions();

    // `safety.maxReminderRounds` is `.min(1).step(1)` in the schema and the spec
    // carries no bounds: the draft is a well-formed integer, so Save writes it
    // and the Host is the one that turns the value down.
    actions.edit("maxReminderRounds", "0");
    expect(form.getSnapshot().invalid).toBe(false);
    expect(form.getSnapshot().fields.maxReminderRounds.invalid).toBe(false);

    await actions.save();
    expect(writes).toEqual([
      { op: "set", path: ["safety", "maxReminderRounds"], value: 0 },
    ]);
  });

  it("refuses a draft the field kind or operation cannot carry", () => {
    const writes: NamespaceOp[] = [];
    const form = new SettingsForm(stubForm(writes, OVERRIDDEN));
    const actions = form.actions();

    // @ts-expect-error — a choice field stages a picked value, never a typed text.
    form.stage("mode", { op: "set", text: "require-update" });
    // @ts-expect-error — a bool field stages a boolean, never a mode option.
    form.stage("debug", { op: "set", value: "require-update" });
    // @ts-expect-error — a number field stages the draft text, never a bare number.
    form.stage("maxSnapshotFiles", { op: "set", value: 300 });
    // @ts-expect-error — a text field is not one the card edits by picking.
    actions.choose("configFile", ".dsh/other.yml");
    // @ts-expect-error — a choice field is not one the card edits by typing.
    actions.edit("mode", "require-update");
    // @ts-expect-error — the card has no such field.
    actions.resetField("reminders");

    // The five drafts above are refused by the compiler, which `typecheck` turns
    // into a build failure the moment one of them stops being an error. The names
    // below are the ones the runtime has to catch too, because in the built
    // bundle the type argument that ruled them out is gone — and a key the specs
    // object merely *inherits* is not a field either, which is why the guard
    // asks for an own property rather than for `undefined`.
    expect(() => form.getSnapshot()).toThrow(/has no field reminders/u);
    actions.discard();

    // @ts-expect-error — `"toString"` reaches the specs object through its prototype.
    actions.resetField("toString");
    expect(() => form.getSnapshot()).toThrow(/has no field toString/u);
    actions.discard();

    // @ts-expect-error — neither is the prototype itself a field.
    actions.resetField("__proto__");
    expect(() => form.getSnapshot()).toThrow(/has no field __proto__/u);
  });
});
