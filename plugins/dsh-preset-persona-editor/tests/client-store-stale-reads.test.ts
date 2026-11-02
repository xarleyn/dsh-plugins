import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { describe, expect, it, vi } from "vitest";

import "../src/host/errors.js";
import {
  PersonaPageController,
  type PersonaFace,
} from "../src/client/store.js";
import { documentOf, faceOf } from "./client-store.helpers.js";

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
