/**
 * The approval-seam read (SPEC §17): which policy a session's ask resolves
 * under, and the one case that means nobody can be asked.
 */

import { describe, expect, it } from "vitest";

import {
  askIsAutoRejected,
  effectiveApprovalPolicy,
  type ApprovalFace,
} from "../../src/guards/approval-seam.js";

const session = { id: "s1" };

describe("approval seam (SPEC §17)", () => {
  it("reads the deployment default when the session logged no override", () => {
    expect(
      effectiveApprovalPolicy({ config: { policy: "never" } }, session),
    ).toBe("never");
    expect(
      effectiveApprovalPolicy({ config: { policy: "ask" } }, session),
    ).toBe("ask");
  });

  it("lets the session's logged override win over the deployment default", () => {
    const loosened: ApprovalFace = {
      config: { policy: "never" },
      overrideOf: () => "ask",
    };
    expect(effectiveApprovalPolicy(loosened, session)).toBe("ask");
    expect(askIsAutoRejected(loosened, session)).toBe(false);

    const pinned: ApprovalFace = {
      config: { policy: "ask" },
      overrideOf: () => "never",
    };
    expect(effectiveApprovalPolicy(pinned, session)).toBe("never");
    expect(askIsAutoRejected(pinned, session)).toBe(true);
  });

  it("reports the refusal only for a policy that answers before asking anyone", () => {
    expect(askIsAutoRejected({ config: { policy: "never" } }, session)).toBe(
      true,
    );
    expect(askIsAutoRejected({ config: { policy: "ask" } }, session)).toBe(
      false,
    );
  });

  it("stays unknown rather than guessing when the seam cannot be read", () => {
    expect(effectiveApprovalPolicy(undefined, session)).toBeUndefined();
    expect(askIsAutoRejected(undefined, session)).toBe(false);
    // A host that composes an approval service without a readable default.
    expect(askIsAutoRejected({}, session)).toBe(false);
    expect(effectiveApprovalPolicy({ config: {} }, session)).toBeUndefined();
    // A value outside the published vocabulary is not a policy.
    expect(
      effectiveApprovalPolicy(
        { config: { policy: "sometimes" as never } },
        session,
      ),
    ).toBeUndefined();
    // No session to read an override from: the default still stands on its own.
    expect(
      effectiveApprovalPolicy({ config: { policy: "never" } }, undefined),
    ).toBe("never");
    expect(
      effectiveApprovalPolicy({ overrideOf: () => "never" }, undefined),
    ).toBeUndefined();
  });

  it("refuses nothing on the strength of a read that failed", () => {
    const broken: ApprovalFace = {
      config: { policy: "never" },
      overrideOf: () => {
        throw new Error("session record is gone");
      },
    };
    expect(effectiveApprovalPolicy(broken, session)).toBeUndefined();
    expect(askIsAutoRejected(broken, session)).toBe(false);
  });

  it("keeps reading the default when the log holds no policy event", () => {
    const face: ApprovalFace = {
      config: { policy: "never" },
      overrideOf: () => undefined,
    };
    expect(askIsAutoRejected(face, session)).toBe(true);
  });
});
