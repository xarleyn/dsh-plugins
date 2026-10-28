import { describe, expect, it } from "vitest";
import { resolveQueueSlots } from "../../src/access/queue-policy.js";

/**
 * The request-ceiling chain: the deployment's `session.maxActiveRequests` is
 * the profile's default, a subrole may override it, and an account may
 * override the role. The same three layers the model policy folds, read where
 * a turn is admitted.
 */
describe("the queue-slots chain", () => {
  it("keeps the deployment's number while no layer above it speaks", () => {
    expect(
      resolveQueueSlots({ account: undefined, subrole: undefined, deployment: 2 }),
    ).toEqual({ limit: 2, layer: "deployment" });
  });

  it("lets the role speak over the deployment", () => {
    expect(
      resolveQueueSlots({ account: undefined, subrole: 4, deployment: 2 }),
    ).toEqual({ limit: 4, layer: "subrole" });
  });

  it("puts the account above the role", () => {
    expect(
      resolveQueueSlots({ account: 1, subrole: 4, deployment: 2 }),
    ).toEqual({ limit: 1, layer: "account" });
  });

  it("treats zero as a real override, not an absent one", () => {
    // A layer may lift the ceiling for its own principal even when the
    // deployment sets one — that is what 0 means, and it must not read as
    // "no opinion".
    expect(
      resolveQueueSlots({ account: 0, subrole: 4, deployment: 2 }),
    ).toEqual({ limit: 0, layer: "account" });
    expect(
      resolveQueueSlots({ account: undefined, subrole: 0, deployment: 2 }),
    ).toEqual({ limit: 0, layer: "subrole" });
  });
});
