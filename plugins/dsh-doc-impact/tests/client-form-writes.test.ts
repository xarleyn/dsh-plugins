// What the card does with the settings document once it is seated: staging edits
// without writing, the dirty-gated save, the field-granular writes and the resets,
// the invalid drafts and the vocabulary a field cannot hold. Registration itself is
// `client-bundle.test.ts`; the stubs both files read stand in `helpers/client-seat.ts`.
import { describe, expect, it } from "vitest";
import {
  faceOf,
  fakeForm,
  fakeReact,
  loadBundle,
  makeCtx,
  PATHS,
  renderEntry,
} from "./helpers/client-seat.js";

describe("client bundle form writes", () => {
  it("stages edits without writing; save is dirty-gated and commits field-granular writes", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: {
        configFile: ".dsh/doc-impact.yml",
        defaults: { mode: "remind" },
      },
      base: {},
      user: {},
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);

    const face = faceOf(ctx);
    const snapshot = () => face.hooks.docImpactCard.getSnapshot();

    // Clean state: save must stay disabled.
    expect(snapshot().available).toBe(true);
    expect(snapshot().dirty).toBe(false);

    // Editing stages locally: dirty, overridden preview, nothing on the wire.
    face.edit("configFile", ".dsh/other.yml");
    expect(snapshot().dirty).toBe(true);
    expect(snapshot().fields.configFile.overridden).toBe(true);
    expect(form.writes).toHaveLength(0);

    // Discard drops the draft.
    face.discard();
    expect(snapshot().dirty).toBe(false);

    // Value staging through the select.
    face.choose("mode", "require-review");
    expect(snapshot().dirty).toBe(true);
    expect(snapshot().fields.mode.value).toBe("require-review");

    await face.save();
    // The write carries the fence read at the moment of writing, and addresses
    // the field where the entry config really keeps it.
    expect(form.writes).toEqual([
      { op: "set", path: PATHS.mode, value: "require-review", revision: 1 },
    ]);
    expect(snapshot().dirty).toBe(false);
  });

  it("reset only plans a write when the field is actually overridden", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: { defaults: { mode: "require-resolution" } },
      base: { defaults: { mode: "remind" } },
      user: { defaults: { mode: "require-resolution" } },
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);
    const face = faceOf(ctx);

    expect(face.hooks.docImpactCard.getSnapshot().fields.mode.overridden).toBe(
      true,
    );
    face.resetField("mode");
    const snapshot = face.hooks.docImpactCard.getSnapshot();
    expect(snapshot.dirty).toBe(true);
    expect(snapshot.fields.mode.overridden).toBe(false);
    expect(snapshot.fields.mode.value).toBe("remind"); // composition base preview

    await face.save();
    expect(form.writes).toEqual([
      { op: "unset", path: PATHS.mode, revision: 1 },
    ]);
    expect(face.hooks.docImpactCard.getSnapshot().dirty).toBe(false);
  });

  it("resets every field kind by dropping the user layer, not by copying the base into it", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: {
        configFile: ".dsh/from-user.yml",
        defaults: { mode: "require-review" },
        changeDetection: { maxSnapshotFiles: 300 },
        debug: true,
        reminderTemplate: "Custom: {body}",
      },
      base: {
        configFile: ".dsh/from-base.yml",
        defaults: { mode: "remind" },
        changeDetection: { maxSnapshotFiles: 100 },
        debug: false,
      },
      user: {
        configFile: ".dsh/from-user.yml",
        defaults: { mode: "require-review" },
        changeDetection: { maxSnapshotFiles: 300 },
        debug: true,
        reminderTemplate: "Custom: {body}",
      },
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);
    const face = faceOf(ctx);
    const snapshot = () => face.hooks.docImpactCard.getSnapshot();

    for (const field of [
      "configFile", // text
      "mode", // choice
      "maxSnapshotFiles", // number
      "debug", // bool
      "reminderTemplate", // multiline text
    ]) {
      face.resetField(field);
      const state = snapshot().fields[field];
      expect(state.overridden, field).toBe(false);
      expect(state.invalid, field).toBe(false);
    }
    // The draft previews the base it would fall back to, without claiming an override.
    expect(snapshot().fields.maxSnapshotFiles.text).toBe("100");
    expect(snapshot().fields.configFile.text).toBe(".dsh/from-base.yml");

    await face.save();
    expect(form.writes.map((write) => write.path.join(".")).sort()).toEqual(
      [
        "configFile",
        "debug",
        "changeDetection.maxSnapshotFiles",
        "defaults.mode",
        "reminderTemplate",
      ].sort(),
    );
    expect(snapshot().dirty).toBe(false);

    // A reset field keeps following the base afterwards: moving it to 200 is
    // visible, which a base copied into the user layer would have frozen.
    form.setBase(PATHS.maxSnapshotFiles, 200);
    expect(snapshot().fields.maxSnapshotFiles.value).toBe(200);
    expect(snapshot().fields.maxSnapshotFiles.overridden).toBe(false);
  });

  it("names a field the card does not edit, the way the built bundle has to", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: {},
      base: {},
      user: {},
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);
    const face = faceOf(ctx);

    // The field name is only checked by the type in the source, and the bundle
    // carries no types: the guard has to survive the build, otherwise a name the
    // card does not edit surfaces as a `TypeError` on the snapshot read.
    // The inherited keys matter as much as the unknown one — the specs are a
    // plain object literal, so `SPECS["toString"]` answers the native function,
    // whose `path` is undefined, and the same `TypeError` comes back through it.
    for (const name of [
      "reminders",
      "toString",
      "constructor",
      "prototype",
      "__proto__",
      "hasOwnProperty",
    ]) {
      face.resetField(name);
      expect(() => face.hooks.docImpactCard.getSnapshot(), name).toThrow(
        `doc-impact card has no field ${name}`,
      );
      face.discard();
    }
  });

  it("blocks saving an invalid number and reports the invalid draft", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: {},
      base: {},
      user: {},
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);
    const face = faceOf(ctx);

    face.edit("maxReminderRounds", "not-a-number");
    const snapshot = face.hooks.docImpactCard.getSnapshot();
    expect(snapshot.invalid).toBe(true);
    expect(snapshot.fields.maxReminderRounds.invalid).toBe(true);

    await face.save();
    expect(form.writes).toHaveLength(0);
    expect(snapshot.dirty).toBe(true); // drafts kept for correction
  });

  it("gates the reminder template on its payload placeholder and resets by unset", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: { reminderTemplate: "Custom: {body}" },
      base: {},
      user: { reminderTemplate: "Custom: {body}" },
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);
    const face = faceOf(ctx);
    const snapshot = () => face.hooks.docImpactCard.getSnapshot();

    // An unset multiline field previews the default template for editing.
    face.edit("limitTemplate", "Limit after {rounds}:\n{impacts}");
    await face.save();
    expect(form.writes).toEqual([
      {
        op: "set",
        path: PATHS.limitTemplate,
        value: "Limit after {rounds}:\n{impacts}",
        revision: 1,
      },
    ]);

    // Dropping the {body} placeholder blocks the save.
    face.edit("reminderTemplate", "no payload");
    expect(snapshot().invalid).toBe(true);
    expect(snapshot().fields.reminderTemplate.invalid).toBe(true);
    await face.save();
    expect(form.writes).toHaveLength(1); // nothing new landed

    // Reset stages a clear: the user layer drops back to the default text.
    face.discard();
    face.resetField("reminderTemplate");
    expect(snapshot().fields.reminderTemplate.invalid).toBe(false);
    await face.save();
    expect(form.writes).toHaveLength(2);
    expect(form.writes[1]).toEqual({
      op: "unset",
      path: PATHS.reminderTemplate,
      revision: 2,
    });
  });

  it("answers a namespace the Host has not resolved with a sentence", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({ status: "loading", writable: false });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);
    const face = faceOf(ctx);
    expect(face.hooks.docImpactCard.getSnapshot().available).toBe(false);

    const entry = ctx.registered[0]!.component as (
      props: Record<string, unknown>,
    ) => any;
    const page = renderEntry(entry, {
      view: "page",
      t: (key: string) => key,
      useDocImpactCard: () => face.hooks.docImpactCard.getSnapshot(),
    });
    // The frame is the page's, so a view that renders nothing would leave the reader
    // inside an opened row with no section and no reason: the body owes a sentence.
    expect(page.type).toBe("p");
    expect(page.props.role).toBe("status");
    expect(page.children.flat()).toContain("unavailable");
  });
});
