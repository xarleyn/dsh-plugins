// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { QaAuditController } from "../src/client/audit/controller.js";
import {
  auditMark,
  createQaAuditApi,
  type QaAuditRemote,
} from "../src/client/audit/types.js";
import { remoteOf, summary } from "./qa-audit-integration.helpers.js";

describe("createQaAuditApi", () => {
  it("returns the value of a successful result", async () => {
    const api = createQaAuditApi(remoteOf());

    await expect(api.summary("session-1")).resolves.toMatchObject({
      verdict: "mixed",
    });
  });

  it("turns a failed result into an exception", async () => {
    const failing: QaAuditRemote = {
      summary: async () => ({ ok: false, error: { code: "not-found" } }),
      audit: async () => ({ ok: false, error: { code: "not-found" } }),
    };
    const api = createQaAuditApi(failing);

    await expect(api.summary("session-1")).rejects.toThrow(/not-found/u);
  });
});

describe("auditMark", () => {
  it("reduces a summary to what a row shows", () => {
    expect(auditMark(summary())).toEqual({
      verdict: "mixed",
      critical: 0,
      major: 1,
      minor: 2,
      observation: 0,
      other: 0,
    });
  });

  it("is null when there is no summary or no audit", () => {
    expect(auditMark(undefined)).toBeNull();
    expect(auditMark(summary({ available: false }))).toBeNull();
  });
});

describe("QaAuditController", () => {
  it("starts detached and notifies on attach and detach", () => {
    const controller = new QaAuditController();
    const seen = vi.fn();
    controller.subscribe(seen);

    expect(controller.getSnapshot().api).toBeNull();

    controller.attach(createQaAuditApi(remoteOf()));
    expect(controller.getSnapshot().api).not.toBeNull();

    controller.detach();
    expect(controller.getSnapshot().api).toBeNull();

    controller.dispose();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("does not notify when already detached", () => {
    const controller = new QaAuditController();
    const seen = vi.fn();
    controller.subscribe(seen);

    controller.detach();

    expect(seen).not.toHaveBeenCalled();
  });
});
