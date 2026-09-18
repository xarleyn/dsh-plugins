import { describe, expect, it } from "vitest";
import { QaAccountsError } from "../src/accounts/store.js";
import { harness, refusal } from "./admin-service.helpers.js";

describe("admin authorization gates", () => {
  it("refuses every administrative read to an ordinary user", async () => {
    const { service, alice } = harness();
    for (const call of [
      () => service.users(alice.token, {}, undefined, undefined),
      () => service.conversations(alice.token, {}, undefined, undefined),
      () => service.feedback(alice.token, {}, undefined, undefined),
      () => service.reviewQueue(alice.token, undefined, undefined),
      () => service.metrics(alice.token),
      () => service.audit(alice.token, {}, undefined, undefined),
      () => service.overview(alice.token),
    ]) {
      const error = await refusal(call);
      expect(error).toBeInstanceOf(QaAccountsError);
      expect(error.reason).toBe("forbidden");
    }
  });

  it("lets a reviewer read conversations and answer them, but not manage users", async () => {
    const { service, reviewer } = harness();
    const page = await service.conversations(
      reviewer.token,
      {},
      undefined,
      undefined,
    );
    expect(page.total).toBe(2);
    expect(
      await refusal(() =>
        service.users(reviewer.token, {}, undefined, undefined),
      ),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() =>
        service.updateUser(reviewer.token, "someone", { disabled: true }),
      ),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() =>
        service.audit(reviewer.token, {}, undefined, undefined),
      ),
    ).toMatchObject({ reason: "forbidden" });
  });

  it("refuses an unknown token outright", async () => {
    const { service } = harness();
    expect(
      await refusal(() =>
        service.users("not-a-token", {}, undefined, undefined),
      ),
    ).toMatchObject({ reason: "auth-required" });
  });
});
