import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QaAttestationError } from "../../src/attestation.js";
import { QaPolicyAdmission } from "../../src/secure-session.js";
import { resolveConfig } from "../../src/resolve-config.js";
import type { QaAccountsGate } from "../../src/secure-session.js";
import { store } from "./accounts.helpers.js";

describe("QA accounts store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("enforces ownership before the admission boundary resolves agents", async () => {
    const accounts = store();
    const a = accounts.register("a@b.co", "password-1");
    const b = accounts.register("b@b.co", "password-2");
    accounts.claimSessions(a.token, ["s-owned"]);

    const gate: QaAccountsGate = {
      enforceSessionAccess: (token, sessionId) => {
        return accounts.ensureSessionAccess(token, sessionId);
      },
      userWorkspace: () => "D:/qa-user",
      ownerIdOf: () => undefined,
    };
    const admission = new QaPolicyAdmission(
      // The fake context cannot resolve agents on purpose: the account gate
      // must refuse before the boundary reaches the agent lookup, and a gate
      // that lets a caller through lands on the unresolvable agent.
      {
        on: () => () => undefined,
        agents: { get: () => undefined },
        sessionController: {
          resolveAgent: async () => ({
            error: new Error("no such session"),
          }),
        },
        tools: { guard: () => () => undefined },
      } as never,
      () => resolveConfig(),
      {
        debug() {},
        info() {},
        warn() {},
        error() {},
        close() {},
      } as never,
      gate,
    );

    // A bad token is refused with auth-required, not the later agent error.
    await expect(admission.secureSession("", "anything")).rejects.toThrow(
      QaAttestationError,
    );
    try {
      await admission.secureSession("", "anything");
      expect.unreachable("anonymous calls must be refused");
    } catch (error) {
      expect((error as QaAttestationError).reason).toBe("auth-required");
      expect((error as Error).message).not.toContain("agent");
    }
    // Foreign sessions are refused with the dedicated reason before the
    // agent lookup would answer.
    try {
      await admission.secureSession(b.token, "s-owned");
      expect.unreachable("foreign sessions must be refused");
    } catch (error) {
      expect((error as QaAttestationError).reason).toBe(
        "session-owned-elsewhere",
      );
    }
    // The admin's own token passes the gate (and then hits the fake context's
    // unresolvable agent, proving the gate no longer blocks).
    try {
      await admission.secureSession(a.token, "s-owned");
      expect.unreachable("the fake context has no agents");
    } catch (error) {
      expect((error as QaAttestationError).reason).toBe("agent-unavailable");
    }
  });

  it("refuses to attest or claim a delegated subagent session", async () => {
    const accounts = store();
    const a = accounts.register("a@b.co", "password-1");
    const gate: QaAccountsGate = {
      enforceSessionAccess: (token, sessionId, facts) =>
        accounts.ensureSessionAccess(token, sessionId, facts),
      userWorkspace: () => "D:/qa-user",
      ownerIdOf: () => undefined,
    };
    // The Host registry knows the session is a delegated child; the agent
    // resolves fine, so the refusal must come from the parent check itself.
    const child = {
      session: {
        header: { parentSession: "session-parent", createdAt: Date.now() },
      },
    };
    const admission = new QaPolicyAdmission(
      {
        on: () => () => undefined,
        sessions: { get: () => child.session },
        agents: { get: () => child },
        sessionController: {
          resolveAgent: async () => ({ error: new Error("no such session") }),
        },
        tools: { guard: () => () => undefined },
      } as never,
      () => resolveConfig(),
      {
        debug() {},
        info() {},
        warn() {},
        error() {},
        close() {},
      } as never,
      gate,
    );
    // An unowned child cannot be claimed into existence by the gate...
    try {
      await admission.secureSession(a.token, "session-child");
      expect.unreachable("subagent sessions must not be attestable");
    } catch (error) {
      expect((error as QaAttestationError).reason).toBe(
        "session-owned-elsewhere",
      );
    }
    expect(accounts.ownedSessionIds(a.token)).toEqual([]);
    // ...and a pre-owned child is still refused at the composition check,
    // however the request reached it. The ownership is seeded explicitly:
    // ensureSessionAccess alone defers the claim for an unmaterialized child.
    accounts.claimSessions(a.token, ["session-child"]);
    try {
      await admission.secureSession(a.token, "session-child");
      expect.unreachable("owned subagent sessions must not be attestable");
    } catch (error) {
      expect((error as QaAttestationError).reason).toBe("adoption-refused");
    }
  });

  it("leaves a previous-run delegated child unowned when admission refuses it", async () => {
    const accounts = store();
    const a = accounts.register("a@b.co", "password-1");
    const gate: QaAccountsGate = {
      enforceSessionAccess: (token, sessionId, facts) =>
        accounts.ensureSessionAccess(token, sessionId, facts),
      userWorkspace: () => "D:/qa-user",
      ownerIdOf: () => undefined,
    };
    // The child session comes from a previous Host run: it is not in the
    // registry yet, so the ownership facts are unknown and the claim is
    // deferred — but materializing it for attestation reveals the delegated
    // parent, and the refusal must land before any claim is recorded.
    const child = {
      session: {
        header: { parentSession: "session-parent", createdAt: Date.now() },
      },
    };
    const admission = new QaPolicyAdmission(
      {
        on: () => () => undefined,
        sessions: { get: () => undefined },
        agents: { get: () => child },
        sessionController: {
          resolveAgent: async () => ({ error: new Error("no such session") }),
        },
        tools: { guard: () => () => undefined },
      } as never,
      () => resolveConfig(),
      {
        debug() {},
        info() {},
        warn() {},
        error() {},
        close() {},
      } as never,
      gate,
    );
    try {
      await admission.secureSession(a.token, "session-child");
      expect.unreachable("subagent sessions must not be attestable");
    } catch (error) {
      expect((error as QaAttestationError).reason).toBe("adoption-refused");
    }
    expect(accounts.ownedSessionIds(a.token)).toEqual([]);
  });
});
