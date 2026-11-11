import { afterEach, describe, expect, it, vi } from "vitest";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import type { QaFormApi } from "../../src/client/forms.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { harness } from "../helpers/session-fakes.js";
import { until } from "../helpers/settle.js";

const controllers: QaSessionController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});
const ready: Awaited<ReturnType<QaFormApi["list"]>> = {
  ok: true,
  value: { ok: true, value: [] },
};
function setup(enabled = true) {
  const world = harness(["other"]);
  const list = vi.fn<QaFormApi["list"]>().mockResolvedValue(ready);
  const controller = new QaSessionController({
    ...world,
    config: resolveConfig({ forms: { enabled } }),
    formApi: { list },
  });
  controllers.push(controller);
  return { world, list, controller };
}

describe("QA form readiness before a prompt", () => {
  it("waits for the first owner poll before sending into a newly created chat", async () => {
    const { world, list, controller } = setup();
    await controller.ensureSession();
    let release!: (value: Awaited<ReturnType<QaFormApi["list"]>>) => void;
    list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const sending = controller.send("Открой форму");
    await until(() => list.mock.calls.length > 0);
    const id = controller.getSnapshot().sessionId!;
    expect(list).toHaveBeenCalledWith("", id);
    expect(world.faces.get(id)?.prompt).not.toHaveBeenCalled();
    release(ready);
    expect(await sending).toBe(true);
    expect(world.faces.get(id)?.prompt).toHaveBeenCalledOnce();
  });

  it.each(["domain", "transport", "exception"])(
    "keeps the prompt unsent on a %s failure and permits retry",
    async (failure) => {
      const { world, list, controller } = setup();
      await controller.ensureSession();
      if (failure === "exception")
        list.mockRejectedValueOnce(new Error("offline"));
      else if (failure === "transport")
        list.mockResolvedValueOnce({
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "offline" },
        });
      else
        list.mockResolvedValueOnce({
          ok: true,
          value: {
            ok: false,
            error: { code: "ACCESS_DENIED", message: "Unavailable" },
          },
        });
      expect(await controller.send("Открой форму")).toBe(false);
      const id = controller.getSnapshot().sessionId!;
      expect(world.faces.get(id)?.prompt).not.toHaveBeenCalled();
      expect(controller.getSnapshot().error).toMatch(/форм/u);
      expect(await controller.send("Открой форму")).toBe(true);
      expect(world.faces.get(id)?.prompt).toHaveBeenCalledOnce();
    },
  );

  it.each([true, false])(
    "does not send or report an old poll after a chat switch (success=%s)",
    async (success) => {
      const { world, list, controller } = setup();
      await controller.ensureSession();
      let release!: (value: Awaited<ReturnType<QaFormApi["list"]>>) => void;
      list.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const sending = controller.send("Открой форму");
      await until(() => list.mock.calls.length > 0);
      const oldId = controller.getSnapshot().sessionId!;
      await controller.switchTo("other");
      release(
        success
          ? ready
          : {
              ok: true,
              value: {
                ok: false,
                error: { code: "ACCESS_DENIED", message: "Unavailable" },
              },
            },
      );
      expect(await sending).toBe(false);
      expect(controller.getSnapshot()).toMatchObject({
        sessionId: "other",
        error: null,
      });
      expect(world.faces.get(oldId)?.prompt).not.toHaveBeenCalled();
      expect(world.faces.get("other")?.prompt).not.toHaveBeenCalled();
    },
  );

  it("does not add a forms dependency while the feature is disabled", async () => {
    const { list, controller } = setup(false);
    await controller.ensureSession();
    expect(await controller.send("Обычный вопрос")).toBe(true);
    expect(list).not.toHaveBeenCalled();
  });
});
