/**
 * The page controller: what the roster and the editor do on every transition,
 * including the ones the user only ever sees as a sentence.
 *
 * The Remote face is a stub, so a failure is delivered exactly as the gateway
 * would deliver it: an `{ ok: false, error }` result, never a rejection.
 */

import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { describe, expect, it, vi } from "vitest";

// Pulls the editor's own Remote failure codes into this test program.
import "../src/host/errors.js";

import { strings } from "../src/client/locale.js";
import { isDirty, PersonaPageController } from "../src/client/store.js";
import { DRAFT, documentOf, faceOf } from "./client-store.helpers.js";

describe("PersonaPageController", () => {
  it("loads the roster", async () => {
    const controller = new PersonaPageController(faceOf());
    expect(controller.snapshot().status).toBe("loading");
    await controller.load();
    const state = controller.snapshot();
    expect(state.status).toBe("ready");
    expect(state.authorable).toBe(true);
    expect(state.presets).toHaveLength(1);
  });

  it("reports a roster failure instead of an empty list", async () => {
    const controller = new PersonaPageController(
      faceOf({
        list: vi.fn(async () => ({
          ok: false as const,
          error: new RemoteError("gateway/internal", "boom", {}),
        })),
      }),
    );
    await controller.load();
    expect(controller.snapshot().status).toBe("failed");
    expect(controller.snapshot().error).toBe("boom");
  });

  it("opens a preset and seeds the draft", async () => {
    const controller = new PersonaPageController(faceOf());
    await controller.open("demo");
    const open = controller.snapshot().open;
    expect(open?.status).toBe("ready");
    expect(open?.draft).toEqual({
      persona: documentOf().persona,
      sections: [],
    });
    expect(isDirty(open)).toBe(false);
  });

  it("closes the editor and refreshes when the preset is gone", async () => {
    const read = vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError("preset-persona/not-found", "gone", {
        agentPreset: "ghost",
      }),
    }));
    const controller = new PersonaPageController(faceOf({ read }));
    await controller.open("ghost");
    expect(controller.snapshot().open).toBeNull();
    expect(controller.snapshot().notice?.text).toBe(strings.gone);
  });

  it("keeps an unreadable preset open with its reason", async () => {
    const read = vi.fn(async () => ({
      ok: true as const,
      value: documentOf({
        editable: false,
        readError: "the composition is not valid YAML",
      }),
    }));
    const controller = new PersonaPageController(faceOf({ read }));
    await controller.open("demo");
    expect(controller.snapshot().open?.status).toBe("ready");
    expect(controller.snapshot().open?.document?.readError).toContain(
      "not valid YAML",
    );
  });

  it("tracks edits and reverts them", async () => {
    const controller = new PersonaPageController(faceOf());
    await controller.open("demo");
    controller.edit({ prefix: "Changed." });
    expect(isDirty(controller.snapshot().open)).toBe(true);
    expect(controller.snapshot().open?.draft?.persona.prefix).toBe("Changed.");
    controller.revert();
    expect(isDirty(controller.snapshot().open)).toBe(false);
  });

  it("saves with the revision it read, then re-reads the preset", async () => {
    const face = faceOf();
    const controller = new PersonaPageController(face);
    await controller.load();
    await controller.open("demo");
    controller.edit({ prefix: DRAFT.prefix });
    await controller.save();
    expect(face.save).toHaveBeenCalledWith(
      "demo",
      {
        persona: { ...documentOf().persona, prefix: DRAFT.prefix },
        sections: [],
      },
      "rev-1",
    );
    expect(controller.snapshot().notice?.text).toBe(strings.saved);
    // The refresh re-read both the roster and the open preset.
    expect(vi.mocked(face.list).mock.calls.length).toBe(2);
    expect(vi.mocked(face.read).mock.calls.length).toBe(2);
  });

  it("says so when there is nothing to save, without calling the host", async () => {
    const face = faceOf();
    const controller = new PersonaPageController(face);
    await controller.open("demo");
    await controller.save();
    expect(face.save).not.toHaveBeenCalled();
    expect(controller.snapshot().notice?.text).toBe(strings.nothingToSave);
  });

  it("keeps the draft and marks the conflict when the file moved", async () => {
    const save = vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError("preset-persona/conflict", "stale", {
        agentPreset: "demo",
        expectedRevision: "rev-1",
        actualRevision: "rev-9",
      }),
    }));
    const controller = new PersonaPageController(faceOf({ save }));
    await controller.open("demo");
    controller.edit({ prefix: "Mine." });
    await controller.save();
    const open = controller.snapshot().open;
    expect(open?.conflict).toBe(true);
    expect(open?.draft?.persona.prefix).toBe("Mine.");
    expect(controller.snapshot().notice?.text).toBe(strings.conflict);
  });

  it("closes the editor when the preset disappears mid-save", async () => {
    const save = vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError("preset-persona/not-found", "gone", {
        agentPreset: "demo",
      }),
    }));
    const controller = new PersonaPageController(faceOf({ save }));
    await controller.open("demo");
    controller.edit({ prefix: "Mine." });
    await controller.save();
    expect(controller.snapshot().open).toBeNull();
    expect(controller.snapshot().notice?.text).toBe(strings.gone);
  });

  it("arms the reset before it performs it", async () => {
    const face = faceOf();
    const controller = new PersonaPageController(face);
    await controller.open("demo");
    await controller.reset();
    expect(face.reset).not.toHaveBeenCalled();
    expect(controller.snapshot().open?.pendingReset).toBe(true);
    await controller.reset();
    expect(face.reset).toHaveBeenCalledWith("demo", "rev-1");
    expect(controller.snapshot().open?.document?.hasRow).toBe(true);
  });

  it("copies a preset, refreshes the roster, and opens the copy", async () => {
    const copy = vi.fn(async () => ({
      ok: true as const,
      value: documentOf({ id: "demo-copy", trust: "user", persona: DRAFT }),
    }));
    const face = faceOf({ copy });
    const controller = new PersonaPageController(face);
    await controller.open("demo");
    controller.beginCopy();
    expect(controller.snapshot().copyDraft?.id).toBe("demo-copy");
    controller.editCopy({ name: "My copy" });
    await controller.copy();
    expect(copy).toHaveBeenCalledWith("demo", "demo-copy", "My copy");
    expect(controller.snapshot().copyDraft).toBeNull();
    expect(controller.snapshot().open?.id).toBe("demo-copy");
  });

  it("reports a refused copy on the form without closing it", async () => {
    const copy = vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError("preset-persona/invalid", "taken", {
        agentPreset: "demo-copy",
        reason: 'preset "demo-copy" already exists',
      }),
    }));
    const controller = new PersonaPageController(faceOf({ copy }));
    await controller.open("demo");
    controller.beginCopy();
    await controller.copy();
    expect(controller.snapshot().copyDraft?.error).toContain("already exists");
    expect(controller.snapshot().open?.id).toBe("demo");
  });

  it("drafts sections: add, edit, remove, and clear", async () => {
    const controller = new PersonaPageController(faceOf());
    await controller.open("demo");
    expect(isDirty(controller.snapshot().open)).toBe(false);

    controller.addSection();
    expect(controller.snapshot().open?.draft?.sections).toEqual([
      { name: "", order: 5000, text: "", enabled: true },
    ]);
    expect(isDirty(controller.snapshot().open)).toBe(true);

    controller.editSection(0, {
      name: "team:style",
      order: 2500,
      text: "Answer briefly.",
    });
    expect(controller.snapshot().open?.draft?.sections).toEqual([
      {
        name: "team:style",
        order: 2500,
        text: "Answer briefly.",
        enabled: true,
      },
    ]);

    controller.addSection();
    controller.editSection(1, { name: "harness:notes", enabled: false });
    controller.removeSection(0);
    expect(controller.snapshot().open?.draft?.sections).toEqual([
      { name: "harness:notes", order: 5000, text: "", enabled: false },
    ]);

    controller.clearSections();
    expect(controller.snapshot().open?.draft?.sections).toEqual([]);
    expect(isDirty(controller.snapshot().open)).toBe(false);
  });

  it("sends the sections with the persona in one save", async () => {
    const face = faceOf();
    const controller = new PersonaPageController(face);
    await controller.load();
    await controller.open("demo");
    controller.addSection();
    controller.editSection(0, {
      name: "team:style",
      order: 2500,
      text: "Answer briefly.",
    });
    await controller.save();
    expect(face.save).toHaveBeenCalledWith(
      "demo",
      {
        persona: documentOf().persona,
        sections: [
          {
            name: "team:style",
            order: 2500,
            text: "Answer briefly.",
            enabled: true,
          },
        ],
      },
      "rev-1",
    );
    expect(controller.snapshot().notice?.text).toBe(strings.saved);
  });

  it("replaces the snapshot only when a fact changed", async () => {
    const controller = new PersonaPageController(faceOf());
    const before = controller.snapshot();
    await controller.load();
    const loaded = controller.snapshot();
    expect(loaded).not.toBe(before);
    expect(controller.snapshot()).toBe(loaded);
  });
});
