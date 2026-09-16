/**
 * The QA panel authorizes against QA Surface's admission boundary, which is
 * deliberately NOT a declared dependency of this plugin: the runtime also loads
 * on Hosts that never mount QA Surface. These cases drive the real plugin inside
 * a Cordis fiber, which is where reading that service as a plain property used
 * to fail every panel poll with
 * `cannot get property "qaSurface" without inject`.
 */

import { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";

import QaBrowser from "../src/index.js";
import type { QaBrowserService } from "../src/host/service.js";

const REFUSAL = /^QA Browser panel authorization is unavailable\.$/u;

interface Surface {
  readonly ctx: Context;
  readonly service: QaBrowserService;
}

let surface: Surface | undefined;

afterEach(async () => {
  await surface?.service.dispose();
  surface = undefined;
});

/** Load the plugin the way the Host does: one fiber, four provided services. */
async function loadPlugin(): Promise<Surface> {
  const ctx = new Context();
  // `enabled: false` keeps the tool set out of this harness, so the four
  // services the plugin declares are the whole dependency surface.
  ctx.provide("agents", { get: () => undefined });
  ctx.provide("attachments", {});
  ctx.provide("tools", { register: () => () => undefined });
  ctx.provide("webServer", { port: 0, host: "127.0.0.1" });
  await ctx.plugin(QaBrowser, { enabled: false });
  surface = { ctx, service: ctx.qaBrowser };
  return surface;
}

describe("QA Browser panel authorization", () => {
  it("refuses panel requests while QA Surface is unmounted", async () => {
    const { service } = await loadPlugin();

    await expect(service.panelState("qa-token", "session-x")).rejects.toThrow(
      REFUSAL,
    );
    await expect(
      service.panelTakeControl("qa-token", "session-x", "client-1"),
    ).rejects.toThrow(REFUSAL);
    await expect(
      service.panelFrame("qa-token", "session-x", "tab-1"),
    ).rejects.toThrow(REFUSAL);
  });

  it("authorizes the panel through the mounted QA Surface", async () => {
    const { ctx, service } = await loadPlugin();
    const secureSession = vi.fn(async () => ({}));
    ctx.provide("qaSurface", { secureSession });

    await expect(service.panelState("qa-token", "session-x")).resolves.toEqual({
      session: null,
      tabs: [],
      humanControlEnabled: true,
      humanControlLeaseSeconds: 30,
      autoRevealOnAgentActivity: true,
      focusOnAutoReveal: false,
      coordinateInputEnabled: true,
    });
    expect(secureSession).toHaveBeenCalledWith("qa-token", "session-x");
  });

  it("authorizes every chrome mutation before it touches the browser", async () => {
    const { ctx, service } = await loadPlugin();

    // Each of the panel's own controls refuses without the boundary, so a
    // mounted-under-a-different-host panel cannot drive a browser at all.
    await expect(
      service.panelNewTab("qa-token", "session-x", "client-1"),
    ).rejects.toThrow(REFUSAL);
    await expect(
      service.panelHistory(
        "qa-token",
        "session-x",
        "tab-1",
        "client-1",
        "back",
      ),
    ).rejects.toThrow(REFUSAL);
    await expect(
      service.panelViewport(
        "qa-token",
        "session-x",
        "tab-1",
        "client-1",
        800,
        600,
      ),
    ).rejects.toThrow(REFUSAL);
    await expect(
      service.panelCloseTab("qa-token", "session-x", "tab-1", "client-1"),
    ).rejects.toThrow(REFUSAL);

    const secureSession = vi.fn(async () => ({}));
    ctx.provide("qaSurface", { secureSession });
    // With the boundary mounted the refusal is the browser's own: this chat has
    // no session yet, which is a different failure than an unauthorized caller.
    await expect(
      service.panelCloseTab("qa-token", "session-x", "tab-1", "client-1"),
    ).rejects.toThrow(/Browser session has not been started\./u);
    expect(secureSession).toHaveBeenCalled();
  });

  it("resolves the boundary per request, so a later mount is honored", async () => {
    const { ctx, service } = await loadPlugin();
    await expect(service.panelState("qa-token", "session-x")).rejects.toThrow(
      REFUSAL,
    );

    const secureSession = vi.fn(async () => ({}));
    ctx.provide("qaSurface", { secureSession });

    await expect(service.panelState("qa-token", "session-x")).resolves.toEqual(
      expect.objectContaining({ session: null, tabs: [] }),
    );
    expect(secureSession).toHaveBeenCalledTimes(1);
  });
});
