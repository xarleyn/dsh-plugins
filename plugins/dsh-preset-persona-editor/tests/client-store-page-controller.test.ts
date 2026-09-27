/**
 * The page controller: what the roster and the reader do on every transition,
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
import { PersonaPageController } from "../src/client/store.js";
import { documentOf, faceOf, OK_CATALOG } from "./client-store.helpers.js";

describe("PersonaPageController", () => {
  it("loads the roster", async () => {
    const controller = new PersonaPageController(faceOf());
    expect(controller.snapshot().status).toBe("loading");
    await controller.load();
    const state = controller.snapshot();
    expect(state.status).toBe("ready");
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

  it("keeps the roster on screen when a refresh fails, and says so", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(OK_CATALOG)
      .mockResolvedValue({
        ok: false as const,
        error: new RemoteError("gateway/internal", "boom", {}),
      });
    const controller = new PersonaPageController(faceOf({ list }));
    await controller.load();
    await controller.load();
    const state = controller.snapshot();
    expect(state.status).toBe("ready");
    expect(state.presets).toHaveLength(1);
    // The refusal is the fact this transition adds, and only the notice slot
    // reaches the screen a ready roster renders: `error` belongs to the failed
    // screen, which does not render here, so writing it would hide the message.
    expect(state.error).toBe("");
    expect(state.notice).toEqual({
      kind: "error",
      text: `${strings.loadFailed} boom`,
    });
  });

  it("opens a preset and keeps the document it read", async () => {
    const controller = new PersonaPageController(faceOf());
    await controller.open("demo");
    const open = controller.snapshot().open;
    expect(open?.status).toBe("ready");
    expect(open?.document).toEqual(documentOf());
  });

  it("closes the reader", async () => {
    const controller = new PersonaPageController(faceOf());
    await controller.open("demo");
    controller.close();
    expect(controller.snapshot().open).toBeNull();
  });

  it("refreshes the roster when the preset is gone", async () => {
    const read = vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError("preset-persona/not-found", "gone", {
        agentPreset: "ghost",
      }),
    }));
    const face = faceOf({ read });
    const controller = new PersonaPageController(face);
    await controller.open("ghost");
    expect(controller.snapshot().open).toBeNull();
    expect(controller.snapshot().notice?.text).toBe(strings.gone);
    expect(vi.mocked(face.list)).toHaveBeenCalledOnce();
  });

  it("keeps an unreadable preset open with its reason", async () => {
    const read = vi.fn(async () => ({
      ok: true as const,
      value: documentOf({
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

  it("keeps a failed read on screen with the host's message", async () => {
    const read = vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError("gateway/internal", "boom", {}),
    }));
    const controller = new PersonaPageController(faceOf({ read }));
    await controller.open("demo");
    expect(controller.snapshot().open?.status).toBe("failed");
    expect(controller.snapshot().open?.error).toBe("boom");
  });

  it("re-reads the open preset on demand", async () => {
    const face = faceOf();
    const controller = new PersonaPageController(face);
    await controller.open("demo");
    await controller.reload();
    expect(vi.mocked(face.read)).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().open?.status).toBe("ready");
  });

  it("drops a notice the user has read", async () => {
    const read = vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError("preset-persona/not-found", "gone", {
        agentPreset: "ghost",
      }),
    }));
    const controller = new PersonaPageController(faceOf({ read }));
    await controller.open("ghost");
    controller.dismissNotice();
    expect(controller.snapshot().notice).toBeNull();
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
