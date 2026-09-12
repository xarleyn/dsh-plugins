import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaSessionController } from "../src/client/QaSessionController.js";
import { harness } from "./helpers/session-fakes.js";

describe("attestation diagnostics", () => {
  it("reports the Host reason code once without a wrapper stack trace", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    world.secureSession.mockResolvedValueOnce({
      ok: false as const,
      error: {
        code: "internal",
        message:
          "Assistant configuration is unavailable. (reason: unknown-tools)",
        details: {},
      },
    });
    await controller.ensureSession();
    const texts = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(
      texts.filter((text) => text.includes("policy attestation failed")),
    ).toEqual([
      "dsh-qa-surface: policy attestation failed (reason: unknown-tools). A lockdown.toolPolicy name is not mounted in this session's tool catalog — check the deployment agent preset and the tool's server availability.",
    ]);
    expect(
      texts.filter((text) => text.includes("session operation failed")),
    ).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      error: "Настройки помощника недоступны.",
    });
    errorSpy.mockRestore();
    controller.dispose();
  });

  it("marks a well-formed proof that does not match the client config", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    world.secureSession.mockResolvedValueOnce({
      ok: true as const,
      value: {
        sessionId: "created-1",
        enabled: true,
        agentPresetMatches: true,
        workspaceMatches: true,
        modelMatches: true,
        sandboxIsReadOnly: true,
        approvalIsNever: true,
        permissionPreset: "some-other-preset",
        toolPolicyLoaded: true,
        toolAllowList: [],
      },
    });
    await controller.ensureSession();
    const texts = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(
      texts.some((text) => text.includes("(reason: proof-mismatch)")),
    ).toBe(true);
    errorSpy.mockRestore();
    controller.dispose();
  });
});

it("forgets a non-active chat without touching sessions", async () => {
  const world = harness(["saved"]);
  world.stored.set(
    "dsh-qa-surface.session:v1:/qa:chats",
    JSON.stringify(["saved", "other"]),
  );
  const controller = new QaSessionController({
    ...world,
    config: resolveConfig(),
  });
  await controller.ensureSession();
  await controller.deleteChat("saved");
  expect(world.create).toHaveBeenCalledTimes(1);
  expect(controller.chatIds()).toEqual(["created-2", "other"]);
  expect(controller.getSnapshot().sessionId).toBe("created-2");
  controller.dispose();
});

it("deleting the active chat falls back to a draft without creating a session", async () => {
  const world = harness();
  const controller = new QaSessionController({
    ...world,
    config: resolveConfig({ lockdown: { allowSessionReset: true } }),
  });
  await controller.ensureSession();
  await controller.deleteChat("created-1");
  expect(world.create).toHaveBeenCalledOnce();
  expect(controller.getSnapshot()).toMatchObject({
    phase: "idle",
    sessionId: null,
    canSend: true,
  });
  expect(controller.chatIds()).toEqual([]);
  expect(world.stored.has("dsh-qa-surface.session:v1:/qa:session")).toBe(false);
  controller.dispose();
});
