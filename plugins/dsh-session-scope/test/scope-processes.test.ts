import { describe, expect, test, vi } from "vitest";

import {
  SESSION_SCOPE_PROCESS_ACTIVE_MESSAGE,
  SessionScopeProcessActivity,
  type ScopeProcessOwner,
} from "../src/scope-processes.js";

function ownerFixture(): {
  owner: ScopeProcessOwner;
  dispatch: (...args: any[]) => unknown;
} {
  let dispatch: ((...args: any[]) => unknown) | undefined;
  const session = {};
  const owner: ScopeProcessOwner = {
    session,
    ctx: {
      on(event, listener) {
        expect(event).toBe("internal/dispatch");
        dispatch = listener;
      },
    },
  };
  return {
    owner,
    dispatch: (...args) => dispatch?.(...args),
  };
}

describe("session scope process lifecycle", () => {
  test("tracks foreground shell execution until its promise settles", async () => {
    const activity = new SessionScopeProcessActivity();
    const { owner } = ownerFixture();
    let release!: () => void;
    const pending = activity.run(owner, "bash", () => new Promise<void>((resolve) => {
      release = resolve;
    }));

    expect(activity.hasActive(owner)).toBe(true);
    release();
    await pending;
    expect(activity.hasActive(owner)).toBe(false);
  });

  test("recognizes only live shell-backed jobs", () => {
    const activity = new SessionScopeProcessActivity();
    const { owner } = ownerFixture();
    const list = vi.fn()
      .mockReturnValueOnce([{ kind: "bash", status: "running" }])
      .mockReturnValueOnce([{ kind: "pty-send", status: "stopping" }])
      .mockReturnValueOnce([{ kind: "bash", status: "completed" }])
      .mockReturnValueOnce([{ kind: "subagent", status: "running" }]);

    expect(activity.hasActive(owner, { jobs: { list } })).toBe(true);
    expect(activity.hasActive(owner, { jobs: { list } })).toBe(true);
    expect(activity.hasActive(owner, { jobs: { list } })).toBe(false);
    expect(activity.hasActive(owner, { jobs: { list } })).toBe(false);
  });

  test("fails closed if a lifecycle service cannot report its state", () => {
    const activity = new SessionScopeProcessActivity();
    const { owner } = ownerFixture();
    expect(activity.hasActive(owner, {
      jobs: { list: () => { throw new Error("registry unavailable"); } },
    })).toBe(true);
  });

  test("direct session events cannot bypass an active process fence", () => {
    const activity = new SessionScopeProcessActivity();
    const { owner, dispatch } = ownerFixture();
    const jobs = { list: vi.fn(() => [{ kind: "bash", status: "running" }]) };
    activity.ensureFence(owner, { jobs });

    expect(() => dispatch("emit", "session/event", [owner.session, {
      type: "session-scope/set",
    }])).toThrow(SESSION_SCOPE_PROCESS_ACTIVE_MESSAGE);
    expect(() => dispatch("emit", "session/event", [{}, {
      type: "session-scope/set",
    }])).not.toThrow();
  });

  test("a process fence observes service updates without duplicate listeners", () => {
    const activity = new SessionScopeProcessActivity();
    let registrations = 0;
    let dispatch: ((...args: any[]) => unknown) | undefined;
    const owner: ScopeProcessOwner = {
      session: {},
      ctx: { on(_event, listener) { registrations += 1; dispatch = listener; } },
    };
    activity.ensureFence(owner, { jobs: { list: () => [] } });
    activity.ensureFence(owner, { terminals: { hasOwnerActivity: () => true } });

    expect(registrations).toBe(1);
    expect(() => dispatch?.("emit", "session/event", [owner.session, {
      type: "session-scope/set",
    }])).toThrow(SESSION_SCOPE_PROCESS_ACTIVE_MESSAGE);
  });
});
