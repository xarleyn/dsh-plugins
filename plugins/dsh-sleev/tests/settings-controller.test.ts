import type {
  SettingsScope,
  SettingsScopeSnapshot,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import { describe, expect, it, vi } from "vitest";
import {
  SleevSettingsController,
  type SleevSettings,
} from "../src/client/settings-controller.js";

vi.mock("@deepseek-ai/dsh-client-store", () => ({
  createSnapshotStore: <T>(initial: T) => {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => value,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set: (next: T) => {
        value = next;
        for (const listener of listeners) listener();
      },
      update: () => {},
    };
  },
}));

/** Structural stand-in for the wire `SettingsPathOpView` union. */
type ScopePathOp =
  | { op: "set"; path: readonly string[]; value: unknown }
  | { op: "unset"; path: readonly string[] };

class FakeScope implements SettingsScope<SleevSettings> {
  readonly listeners = new Set<() => void>();
  readonly writes: Array<["set" | "unset", string, unknown?]> = [];
  rejectWrites = false;
  snapshot: SettingsScopeSnapshot<SleevSettings> = {
    status: "ready",
    value: {
      routes: [],
      routePrefixes: ["sleev-"],
      maxRecentCalls: 100,
      logLevel: "info",
    },
    base: {
      routes: [],
      routePrefixes: ["sleev-"],
      maxRecentCalls: 100,
      logLevel: "info",
    },
    user: {},
    revision: 0,
    writable: true,
    mode: "host",
  };

  getSnapshot(): SettingsScopeSnapshot<SleevSettings> {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(field: string, value: unknown): Promise<void> {
    return this.mutate([{ op: "set", path: [field], value }]);
  }

  unset(field: string): Promise<void> {
    return this.mutate([{ op: "unset", path: [field] }]);
  }

  async mutate(ops: readonly ScopePathOp[]): Promise<void> {
    for (const op of ops) {
      const field = op.path[0];
      if (field !== undefined) {
        this.writes.push(
          op.op === "set" ? ["set", field, op.value] : ["unset", field],
        );
      }
    }
    if (this.rejectWrites) return;
    const user = { ...(this.snapshot.user as Record<string, unknown>) };
    const base = this.snapshot.base as Record<string, unknown>;
    const value: Record<string, unknown> = { ...this.snapshot.value };
    for (const op of ops) {
      const field = op.path[0];
      if (field === undefined) continue;
      if (op.op === "set") {
        user[field] = op.value;
        value[field] = op.value;
      } else {
        delete user[field];
        value[field] = base[field];
      }
    }
    this.snapshot = {
      ...this.snapshot,
      value: value as SleevSettings,
      user,
      revision: (this.snapshot.revision ?? 0) + 1,
    };
    for (const listener of this.listeners) listener();
  }
}

describe("Sleev settings card controller", () => {
  it("stages validation and discards without writing", () => {
    const scope = new FakeScope();
    const controller = new SleevSettingsController(scope);
    const face = controller.inject();

    expect(face.hooks.sleevSettings.getSnapshot()).toMatchObject({
      available: true,
      dirty: false,
      routePrefixes: { text: "sleev-", overridden: false, invalid: false },
      maxRecentCalls: { text: "100", overridden: false, invalid: false },
    });

    face.edit("maxRecentCalls", "0");
    expect(face.hooks.sleevSettings.getSnapshot()).toMatchObject({
      dirty: true,
      invalid: true,
    });
    face.discard();
    expect(face.hooks.sleevSettings.getSnapshot()).toMatchObject({
      dirty: false,
      invalid: false,
      maxRecentCalls: { text: "100", overridden: false, invalid: false },
    });
    expect(scope.writes).toEqual([]);
    controller.dispose();
  });

  it("writes normalized values and can reset user overrides", async () => {
    const scope = new FakeScope();
    const controller = new SleevSettingsController(scope);
    const face = controller.inject();

    face.edit("routes", "sleev-a\nsleev-a\n sleev-b ");
    face.edit("logLevel", "debug");
    face.save();

    await vi.waitFor(() => {
      expect(face.hooks.sleevSettings.getSnapshot()).toMatchObject({
        dirty: false,
        routes: {
          text: "sleev-a\nsleev-b",
          overridden: true,
          invalid: false,
        },
        logLevel: { text: "debug", overridden: true, invalid: false },
      });
    });
    expect(scope.writes).toContainEqual([
      "set",
      "routes",
      ["sleev-a", "sleev-b"],
    ]);

    face.resetField("routes");
    face.resetField("logLevel");
    expect(face.hooks.sleevSettings.getSnapshot()).toMatchObject({
      dirty: true,
      routes: { text: "", overridden: false, invalid: false },
      logLevel: { text: "info", overridden: false, invalid: false },
    });
    face.save();
    await vi.waitFor(() => {
      expect(face.hooks.sleevSettings.getSnapshot()).toMatchObject({
        dirty: false,
        routes: { overridden: false },
        logLevel: { overridden: false },
      });
    });
    expect(scope.writes).toContainEqual(["unset", "routes"]);
    expect(scope.writes).toContainEqual(["unset", "logLevel"]);
    controller.dispose();
  });

  it("keeps drafts when the Host does not accept a write", async () => {
    const scope = new FakeScope();
    scope.rejectWrites = true;
    const controller = new SleevSettingsController(scope);
    const face = controller.inject();

    face.edit("logLevel", "debug");
    face.save();
    await vi.waitFor(() => {
      expect(face.hooks.sleevSettings.getSnapshot()).toMatchObject({
        dirty: true,
        failed: true,
        logLevel: { text: "debug", overridden: true },
      });
    });
    controller.dispose();
  });

  it("does not enable saving for an edit equivalent to the current value", () => {
    const scope = new FakeScope();
    const controller = new SleevSettingsController(scope);
    const face = controller.inject();

    face.edit("routePrefixes", " sleev- \nsleev-");
    expect(face.hooks.sleevSettings.getSnapshot()).toMatchObject({
      dirty: false,
      invalid: false,
      routePrefixes: { text: "sleev-", overridden: false },
    });
    expect(scope.writes).toEqual([]);
    controller.dispose();
  });
});
