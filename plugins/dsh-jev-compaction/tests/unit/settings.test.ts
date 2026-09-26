/**
 * Host-side settings surface (result-shaping SPEC §34, §56).
 *
 * Since 0.1.7 the plugin's own configuration *is* the settings namespace, so
 * what this file pins is the two things the plugin still owns: declining the
 * page the Host would generate for it, and re-resolving when the loader has
 * moved a volatile reference.
 */

import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";

import {
  plainJevCompactionConfig,
  resolveJevCompactionConfig,
} from "../../src/config.js";
import type {
  JevCompactionConfig,
  JevCompactionLiveConfig,
} from "../../src/config.js";
import { JevCompactionService } from "../../src/service.js";
import { installJevCompactionSettings } from "../../src/settings/install.js";
import { JEV_COMPACTION_SETTINGS_NAMESPACE } from "../../src/shared/settings.js";

interface ConfigureCall {
  readonly presentation: { auto?: boolean };
  readonly owner: unknown;
}

/** Minimal host context: `inject` runs its callback with a settings service. */
function fakeHost(options: { withSettings: boolean }): {
  owner: Context;
  fiber: unknown;
  calls: ConfigureCall[];
} {
  const calls: ConfigureCall[] = [];
  const fiber = { name: "test-fiber" };
  const owner = {
    fiber,
    inject(
      services: readonly string[],
      callback: (ctx: unknown) => void,
    ): void {
      // An optional service that is not provided never reaches the callback,
      // which is what the real `ctx.inject` does with `settings`.
      if (!options.withSettings || !services.includes("settings")) return;
      callback({
        settings: {
          configure(presentation: { auto?: boolean }, owner: unknown): void {
            calls.push({ presentation, owner });
          },
        },
        effect: (run: () => void) => run(),
      });
    },
  };
  return { owner: owner as unknown as Context, fiber, calls };
}

/** One loader reference the test can move. */
function reference<T>(value: T): { get(): T; set(next: T): void } {
  let current = value;
  return {
    get: () => current,
    set: (next: T) => {
      current = next;
    },
  };
}

describe("installJevCompactionSettings", () => {
  it("declines the automatically generated page for this entry", () => {
    const host = fakeHost({ withSettings: true });
    installJevCompactionSettings(host.owner);
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]!.presentation).toEqual({ auto: false });
    // The opt-out is per fiber, and it is the plugin's own fiber that owns the
    // namespace — a child fiber's would be released with the child.
    expect(host.calls[0]!.owner).toBe(host.fiber);
  });

  it("stays inert when the host exposes no settings service", () => {
    const host = fakeHost({ withSettings: false });
    expect(() => installJevCompactionSettings(host.owner)).not.toThrow();
    expect(host.calls).toHaveLength(0);
  });

  it("addresses the section by the profile entry id", () => {
    // 0.1.7 derives the namespace from the entry, so the one string the Host,
    // the card and `cordis.patch.yml` agree on is the whole join.
    expect(JEV_COMPACTION_SETTINGS_NAMESPACE).toBe("dsh-jev-compaction");
  });
});

describe("live configuration", () => {
  it("detaches every volatile reference into one plain snapshot", () => {
    const live = {
      enabled: reference(true),
      decisions: { fullThreshold: reference(0.7) },
      resultShaping: { includeTools: reference(["bash"]) },
      archive: { retentionDays: 14 },
    } as unknown as JevCompactionLiveConfig;
    expect(plainJevCompactionConfig(live)).toEqual({
      enabled: true,
      decisions: { fullThreshold: 0.7 },
      resultShaping: { includeTools: ["bash"] },
      archive: { retentionDays: 14 },
    });
  });

  it("adopts a committed settings change without a restart", () => {
    const ctx = new Context();
    (
      ctx as unknown as {
        reflect: { provide(name: string, value: unknown): void };
      }
    ).reflect.provide("tokenMeter", {
      measure: () => ({ nodes: [] }),
      estimateMessage: () => 0,
    });
    const enabled = reference(true);
    const service = new JevCompactionService(ctx, {
      enabled,
      trigger: { contextRatio: 0.7 },
    } as unknown as JevCompactionConfig);

    expect(service.config.enabled).toBe(true);
    enabled.set(false);
    (ctx as unknown as { emit(name: string, ...args: unknown[]): void }).emit(
      "loader/volatile-update",
      [["enabled"]],
    );
    expect(service.config.enabled).toBe(false);
    service.dispose();
  });

  it("keeps running on the previous configuration when a commit is unresolvable", () => {
    // The Host validates a write against the schema bounds only; a value that
    // passes them and still cannot be resolved (a threshold pair the old
    // `validate` hook used to refuse) must not reach the planner.
    const base = resolveJevCompactionConfig({
      decisions: { fullThreshold: 0.7, truncateThreshold: 0.45 },
    });
    expect(base.decisions.fullThreshold).toBe(0.7);
    expect(() =>
      resolveJevCompactionConfig({
        decisions: { fullThreshold: 0.2, truncateThreshold: 0.9 },
      }),
    ).toThrow(/truncateThreshold/u);
    expect(() =>
      resolveJevCompactionConfig({ trigger: { contextRatio: 2 } }),
    ).toThrow(/contextRatio/u);
  });
});
