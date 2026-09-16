import { describe, expect, it } from "vitest";
import {
  planPreviewTransition,
  previewEntryState,
  readPreviewEntry,
} from "../src/client/role/preview.js";

const ROLE = { id: "analyst", name: "Аналитик" };

describe("administrator preview entry", () => {
  it("carries the role and its display name", () => {
    expect(previewEntryState(ROLE)).toEqual({
      qaPreview: "analyst",
      qaPreviewName: "Аналитик",
    });
  });

  it("reads back the role a history entry asked to preview", () => {
    expect(readPreviewEntry(previewEntryState(ROLE))).toEqual({
      roleId: "analyst",
      name: "Аналитик",
    });
  });

  it("previews under the role id when the entry carries no name", () => {
    // A marker written before names travelled with it, or one written by an
    // older console build: the id is what the banner has to fall back to.
    expect(readPreviewEntry({ qaPreview: "analyst" })).toEqual({
      roleId: "analyst",
      name: "analyst",
    });
  });

  it("ignores ordinary history entries", () => {
    expect(readPreviewEntry(null)).toBeUndefined();
    expect(readPreviewEntry(undefined)).toBeUndefined();
    expect(readPreviewEntry({ qaAdmin: "users" })).toBeUndefined();
    expect(readPreviewEntry({ qaPreview: "" })).toBeUndefined();
    expect(readPreviewEntry({ qaPreview: 42 })).toBeUndefined();
  });
});

describe("preview transitions", () => {
  const entry = previewEntryState(ROLE);

  it("enters the preview an administrator's entry asks for", () => {
    expect(
      planPreviewTransition({ state: entry, preview: null, isAdmin: true }),
    ).toEqual({
      kind: "enter",
      preview: { roleId: "analyst", name: "Аналитик" },
    });
  });

  it("keeps the mode while the same entry stays current", () => {
    expect(
      planPreviewTransition({
        state: entry,
        preview: { roleId: "analyst", name: "Аналитик" },
        isAdmin: true,
      }),
    ).toEqual({ kind: "keep" });
  });

  it("leaves the preview when the current entry asks for another role", () => {
    expect(
      planPreviewTransition({
        state: previewEntryState({ id: "developer", name: "Developer" }),
        preview: { roleId: "analyst", name: "Аналитик" },
        isAdmin: true,
      }),
    ).toEqual({
      kind: "enter",
      preview: { roleId: "developer", name: "Developer" },
    });
  });

  it("leaves the preview once the navigation drops the marker", () => {
    // The leak this replaces: the mode was latched on mount, so "← В чат" and
    // the browser's Back button both left the flag set, and every later new
    // chat ran as the previewed profile instead of the account's default.
    expect(
      planPreviewTransition({
        state: null,
        preview: { roleId: "analyst", name: "Аналитик" },
        isAdmin: true,
      }),
    ).toEqual({ kind: "leave" });
  });

  it("leaves a preview left behind by another account", () => {
    // A marker survives in the history entry across a sign-out. Latching it
    // again would hand the next account a chat under a profile it never held.
    expect(
      planPreviewTransition({
        state: entry,
        preview: { roleId: "analyst", name: "Аналитик" },
        isAdmin: false,
      }),
    ).toEqual({ kind: "leave" });
  });

  it("never enters a preview for a non-administrator", () => {
    expect(
      planPreviewTransition({ state: entry, preview: null, isAdmin: false }),
    ).toEqual({ kind: "keep" });
  });

  it("does nothing for an ordinary entry", () => {
    expect(
      planPreviewTransition({ state: null, preview: null, isAdmin: true }),
    ).toEqual({ kind: "keep" });
  });
});
