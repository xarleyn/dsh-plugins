import { describe, expect, it, vi } from "vitest";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { harness } from "../helpers/session-fakes.js";
import type { QaAnswerMode } from "../../src/shared/answer-modes.js";

async function ready() {
  const world = harness(["saved"]);
  world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
  const prepare = vi.fn(async () => ({ ok: true as const, value: true }));
  const controller = new QaSessionController({
    ...world,
    config: resolveConfig({}),
    answerModesApi: { prepare },
  });
  await controller.ensureSession();
  return { ...world, prepare, controller };
}

describe("request-local answer mode submission", () => {
  it("submits modes on a LAN HTTP origin without crypto.randomUUID", async () => {
    const randomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues: randomValues });
    const f = await ready();
    try {
      expect(await f.controller.send("question", [], null, ["rag"])).toBe(true);
      const requestId = vi.mocked(f.faces.get("saved")!.face.prompt).mock
        .calls[0]![3];
      expect(requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
      expect(f.prepare).toHaveBeenCalledWith("", "saved", requestId, ["rag"]);
    } finally {
      f.controller.dispose();
      vi.unstubAllGlobals();
    }
  });
  it("prepares the exact native prompt identity and snapshots selection before awaiting", async () => {
    const f = await ready();
    const modes: QaAnswerMode[] = ["rag", "deep"];
    const sent = f.controller.send("question", [], null, modes);
    modes.splice(0, modes.length, "deep");
    expect(await sent).toBe(true);
    const prompt = vi.mocked(f.faces.get("saved")!.face.prompt);
    const requestId = prompt.mock.calls[0]![3];
    expect(f.prepare).toHaveBeenCalledWith("", "saved", requestId, [
      "deep",
      "rag",
    ]);
    expect(typeof requestId).toBe("string");
    expect(prompt.mock.calls[0]?.[0]).toEqual([
      { type: "text", text: "question" },
    ]);
    f.controller.dispose();
  });

  it("binds regeneration to a fresh identity with the current modes", async () => {
    const f = await ready();
    expect(await f.controller.regenerate(["rag"])).toBe(true);
    const requestId = vi.mocked(f.faces.get("saved")!.face.prompt).mock
      .calls[0]![3];
    expect(f.prepare).toHaveBeenCalledWith("", "saved", requestId, ["rag"]);
    f.controller.dispose();
  });

  it("uses the Host queue echo identity for a queued request", async () => {
    const f = await ready();
    const face = f.faces.get("saved")!;
    face.source.set({ ...face.source.getSnapshot(), running: true });
    expect(await f.controller.send("queued question", [], null, ["rag"])).toBe(
      true,
    );
    const requestId = vi.mocked(face.face.prompt).mock.calls[0]![3];
    expect(f.prepare).toHaveBeenCalledWith("", "saved", requestId, ["rag"]);
    expect(face.beginSubmission).toHaveBeenCalled();
    f.controller.dispose();
  });
});
