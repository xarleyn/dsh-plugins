import type {
  ConfigForm,
  ConfigFormSnapshot,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import { describe, expect, it, vi } from "vitest";
import {
  SleevSettingsController,
  type SleevSettings,
} from "../src/client/settings-controller.js";

vi.mock("@deepseek-ai/dsh-client-store", async () => {
  const { createSnapshotStore } = await import("./helpers/snapshot-store.js");
  return { createSnapshotStore };
});

/** Structural stand-in for the wire `SettingsPathOpView` union. */
type FormPathOp =
  | { op: "set"; path: string[]; value: unknown }
  | { op: "unset"; path: string[] };

class FakeForm implements ConfigForm<SleevSettings> {
  readonly listeners = new Set<() => void>();
  readonly writes: Array<["set" | "unset", string, unknown?]> = [];
  rejectWrites = false;
  snapshot: ConfigFormSnapshot<SleevSettings> = {
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

  getSnapshot(): ConfigFormSnapshot<SleevSettings> {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(field: string, value: unknown): Promise<boolean> {
    return this.mutate([{ op: "set", path: [field], value }]);
  }

  unset(field: string): Promise<boolean> {
    return this.mutate([{ op: "unset", path: [field] }]);
  }

  async mutate(ops: readonly FormPathOp[]): Promise<boolean> {
    for (const op of ops) {
      const field = op.path[0];
      if (field !== undefined) {
        this.writes.push(
          op.op === "set" ? ["set", field, op.value] : ["unset", field],
        );
      }
    }
    if (this.rejectWrites) return false;
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
    return true;
  }
}

describe("Sleev settings card controller", () => {
  it("stages validation and discards without writing", () => {
    const form = new FakeForm();
    const controller = new SleevSettingsController(form);
    const face = controller.inject();

    expect(face.hooks.sleevSettings.getSnapshot()).toMatchObject({
      status: "ready",
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
    expect(form.writes).toEqual([]);
    controller.dispose();
  });

  it("writes normalized values and can reset user overrides", async () => {
    const form = new FakeForm();
    const controller = new SleevSettingsController(form);
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
    expect(form.writes).toContainEqual([
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
    expect(form.writes).toContainEqual(["unset", "routes"]);
    expect(form.writes).toContainEqual(["unset", "logLevel"]);
    controller.dispose();
  });

  it("keeps drafts when the Host does not accept a write", async () => {
    const form = new FakeForm();
    form.rejectWrites = true;
    const controller = new SleevSettingsController(form);
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
    const form = new FakeForm();
    const controller = new SleevSettingsController(form);
    const face = controller.inject();

    face.edit("routePrefixes", " sleev- \nsleev-");
    expect(face.hooks.sleevSettings.getSnapshot()).toMatchObject({
      dirty: false,
      invalid: false,
      routePrefixes: { text: "sleev-", overridden: false },
    });
    expect(form.writes).toEqual([]);
    controller.dispose();
  });

  it("passes the namespace's sync state through instead of one boolean", () => {
    /*
     * The card draws a different line for each state, so the projection may not
     * collapse `loading` and `unavailable` into "not ready": that is how a row
     * whose namespace was still being served claimed there was nothing to edit,
     * one frame before the form it was about to show.
     */
    const form = new FakeForm();
    const controller = new SleevSettingsController(form);
    const face = controller.inject();

    for (const status of ["loading", "unavailable", "ready"] as const) {
      form.snapshot = {
        ...form.snapshot,
        status,
        writable: status === "ready",
      };
      for (const listener of form.listeners) listener();
      expect(face.hooks.sleevSettings.getSnapshot()).toMatchObject({ status });
    }
    controller.dispose();
  });
});
