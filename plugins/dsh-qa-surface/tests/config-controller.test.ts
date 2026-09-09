import type { SettingsScope } from "@deepseek-ai/dsh-client-runtime/client";
import { describe, expect, it, vi } from "vitest";
import { QaConfigController } from "../src/client/QaConfigController.js";
import {
  DEFAULT_QA_SURFACE_CONFIG,
  resolveConfig,
} from "../src/resolve-config.js";
import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../src/types.js";

interface ScopeState {
  status: "loading" | "ready" | "unavailable";
  value?: QaSurfaceConfig;
}

class FakeScope {
  private readonly listeners = new Set<() => void>();
  constructor(private state: ScopeState) {}
  getSnapshot = (): ScopeState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(state: ScopeState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  asScope(): SettingsScope<QaSurfaceConfig> {
    return this as unknown as SettingsScope<QaSurfaceConfig>;
  }
}

/** Settle helper: the fallback continuation and the notification both run on microtasks. */
const settled = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("qa config controller", () => {
  it("keeps the settings namespace authoritative while it is readable", () => {
    const describe = vi.fn();
    const scope = new FakeScope({
      status: "ready",
      value: { branding: { title: "DeepSeek QA" } },
    });
    const controller = new QaConfigController(scope.asScope(), describe);
    expect(controller.getSnapshot().status).toBe("ready");
    expect(controller.getSnapshot().config.branding.title).toBe("DeepSeek QA");
    expect(describe).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("defers the fallback while the namespace is still loading", () => {
    const describe = vi.fn();
    const scope = new FakeScope({ status: "loading" });
    const controller = new QaConfigController(scope.asScope(), describe);
    expect(controller.getSnapshot().status).toBe("loading");
    expect(describe).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("stays unavailable with client defaults when no fallback exists", () => {
    const controller = new QaConfigController(
      new FakeScope({ status: "unavailable" }).asScope(),
    );
    expect(controller.getSnapshot()).toEqual({
      status: "unavailable",
      config: DEFAULT_QA_SURFACE_CONFIG,
      error: null,
    });
    controller.dispose();
  });

  it("adopts the Host describe fallback on a LAN browser", async () => {
    let settle: ((config: ResolvedQaSurfaceConfig) => void) | undefined;
    const describe = vi.fn(
      () =>
        new Promise<ResolvedQaSurfaceConfig>((resolve) => {
          settle = resolve;
        }),
    );
    const controller = new QaConfigController(
      new FakeScope({ status: "unavailable" }).asScope(),
      describe,
    );
    expect(describe).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().status).toBe("loading");
    settle?.(
      resolveConfig({
        branding: { title: "DeepSeek QA" },
        session: { agentPreset: "minimal" },
      }),
    );
    await settled();
    expect(controller.getSnapshot().status).toBe("ready");
    expect(controller.getSnapshot().config.branding.title).toBe("DeepSeek QA");
    expect(controller.getSnapshot().config.session.agentPreset).toBe("minimal");
    controller.dispose();
  });

  it("triggers the fallback when the namespace later turns unavailable", async () => {
    const describe = vi.fn(async () =>
      resolveConfig({ branding: { title: "DeepSeek QA" } }),
    );
    const scope = new FakeScope({ status: "ready" });
    const controller = new QaConfigController(scope.asScope(), describe);
    expect(describe).not.toHaveBeenCalled();
    scope.set({ status: "unavailable" });
    expect(controller.getSnapshot().status).toBe("loading");
    expect(describe).toHaveBeenCalledTimes(1);
    await settled();
    expect(controller.getSnapshot().status).toBe("ready");
    expect(controller.getSnapshot().config.branding.title).toBe("DeepSeek QA");
    controller.dispose();
  });

  it("returns to unavailable when the Host fallback rejects", async () => {
    let reject: ((error: Error) => void) | undefined;
    const describe = vi.fn(
      () =>
        new Promise<ResolvedQaSurfaceConfig>((_, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const controller = new QaConfigController(
      new FakeScope({ status: "unavailable" }).asScope(),
      describe,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reject?.(new Error("fence rejected the request"));
    await settled();
    expect(controller.getSnapshot().status).toBe("unavailable");
    expect(controller.getSnapshot().config).toBe(DEFAULT_QA_SURFACE_CONFIG);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    controller.dispose();
  });

  it("fails closed on a fallback payload that violates config invariants", async () => {
    const describe = vi.fn(
      async () => ({ session: { policy: "fixed" } }) as ResolvedQaSurfaceConfig,
    );
    const controller = new QaConfigController(
      new FakeScope({ status: "unavailable" }).asScope(),
      describe,
    );
    await settled();
    expect(controller.getSnapshot().status).toBe("unavailable");
    expect(controller.getSnapshot().config).toBe(DEFAULT_QA_SURFACE_CONFIG);
    controller.dispose();
  });

  it("ignores a fallback settlement after dispose", async () => {
    let settle: ((config: ResolvedQaSurfaceConfig) => void) | undefined;
    const describe = vi.fn(
      () =>
        new Promise<ResolvedQaSurfaceConfig>((resolve) => {
          settle = resolve;
        }),
    );
    const controller = new QaConfigController(
      new FakeScope({ status: "unavailable" }).asScope(),
      describe,
    );
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.dispose();
    settle?.(resolveConfig({ branding: { title: "Late" } }));
    await settled();
    expect(listener).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe("loading");
  });
});
