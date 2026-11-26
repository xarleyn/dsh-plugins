import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { describe, expect, it, vi } from "vitest";

import "../src/host/errors.js";
import {
  PersonaPageController,
  type PersonaFace,
} from "../src/client/store.js";
import { catalogOf, documentOf, faceOf } from "./client-store.helpers.js";

type ReadResult = Awaited<ReturnType<PersonaFace["read"]>>;

function pendingRead() {
  let resolve!: (result: ReadResult) => void;
  const promise = new Promise<ReadResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const staleResults: ReadResult[] = [
  {
    ok: false,
    error: new RemoteError("preset-persona/not-found", "gone", {
      agentPreset: "demo-a",
    }),
  },
  { ok: false, error: new RemoteError("gateway/internal", "old failure", {}) },
  { ok: true, value: documentOf({ name: "Old document" }) },
];

describe("persona read generations", () => {
  it.each(["success", "failure"])(
    "keeps the latest roster when an older %s arrives",
    async (kind) => {
      let resolve!: (value: Awaited<ReturnType<PersonaFace["list"]>>) => void;
      const slow = new Promise<Awaited<ReturnType<PersonaFace["list"]>>>(
        (done) => {
          resolve = done;
        },
      );
      const face = faceOf({
        list: vi
          .fn()
          .mockReturnValueOnce(slow)
          .mockResolvedValue({ ok: true, value: catalogOf() }),
      });
      const controller = new PersonaPageController(face);
      const pending = controller.load();
      await controller.refresh();
      const current = controller.snapshot();
      resolve(
        kind === "success"
          ? { ok: true, value: { presets: [] } }
          : {
              ok: false,
              error: new RemoteError(
                "gateway/internal",
                "older request failed",
                {},
              ),
            },
      );
      await pending;
      expect(controller.snapshot()).toBe(current);
    },
  );

  for (const nextId of ["demo-a", "demo-b"]) {
    it.each(staleResults)(
      `ignores obsolete success and failure after opening ${nextId}: %j`,
      async (stale) => {
        const pending = pendingRead();
        const face = faceOf({
          read: vi
            .fn()
            .mockReturnValueOnce(pending.promise)
            .mockResolvedValue({
              ok: true,
              value: documentOf({ id: nextId, name: "Current document" }),
            }),
        });
        const controller = new PersonaPageController(face);
        const first = controller.open("demo-a");
        await controller.open(nextId);
        const current = controller.snapshot();
        pending.resolve(stale);
        await first;
        expect(controller.snapshot()).toBe(current);
        expect(controller.snapshot().open?.document?.name).toBe(
          "Current document",
        );
        expect(face.list).not.toHaveBeenCalled();
      },
    );
  }

  it.each(staleResults)(
    "ignores a read completed after closing: %j",
    async (stale) => {
      const pending = pendingRead();
      const face = faceOf({ read: () => pending.promise });
      const controller = new PersonaPageController(face);
      const reading = controller.open("demo-a");
      controller.close();
      const closed = controller.snapshot();
      pending.resolve(stale);
      await reading;
      expect(controller.snapshot()).toBe(closed);
      expect(face.list).not.toHaveBeenCalled();
    },
  );
});
