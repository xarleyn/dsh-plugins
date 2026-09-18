import { IntegrationError } from "../../src/errors.js";
import { INSTANCE, INSTANCES, TOKEN, provider, stub } from "./shared.js";

describe("weblate connect form", () => {
  it("accepts a token as a token, never as a pasted URL", () => {
    const p = provider(stub(() => ({ json: {} })).fetcher);
    for (const bad of [
      "https://weblate.example.com/api/",
      `${INSTANCE}/accounts/profile/#api`,
      "short",
      "with space inside",
      "",
    ]) {
      expect(() => p.parseCredential(bad, { instanceId: "main" })).toThrow(
        IntegrationError,
      );
    }
    // A token whose shape this provider has never seen is still a token: the
    // prefixes below are a label for the user, never an authorization check.
    for (const token of [
      "0123456789abcdef0123456789abcdef01234567",
      `wlu_${"a".repeat(40)}`,
      `wlp_${"b".repeat(40)}`,
    ]) {
      expect(p.parseCredential(token, { instanceId: "main" }).portal).toBe(
        INSTANCE,
      );
    }
  });

  it("keeps the instance out of the stored credential", () => {
    const p = provider(stub(() => ({ json: {} })).fetcher);
    const stored = p.parseCredential(TOKEN, { instanceId: "main" });
    // The address is re-resolved from operator config on every call, so a
    // repointed instance takes effect at once and no host is ever stored.
    expect(JSON.parse(stored.credential)).toEqual({
      instanceId: "main",
      token: TOKEN,
    });
    expect(stored.credential).not.toContain("example.com");
    expect(stored.portal).toBe(INSTANCE);
  });

  it("refuses an instance it does not know, and demands a choice among many", () => {
    const p = provider(stub(() => ({ json: {} })).fetcher);
    expect(() => p.parseCredential(TOKEN, { instanceId: "other" })).toThrow(
      /Unknown Weblate instance/u,
    );
    const many = provider(stub(() => ({ json: {} })).fetcher, {
      instances: [
        ...INSTANCES,
        { id: "dev", label: "Dev", baseUrl: "https://dev.example.com" },
      ],
    });
    expect(() => many.parseCredential(TOKEN)).toThrow(
      /Choose a Weblate instance/u,
    );
    expect(many.parseCredential(TOKEN, { instanceId: "dev" }).portal).toBe(
      "https://dev.example.com",
    );
  });

  it("fails closed when the stored instance is no longer configured", async () => {
    const p = provider(stub(() => ({ json: {} })).fetcher);
    await expect(
      p.execute(
        { credential: JSON.stringify({ instanceId: "gone", token: TOKEN }) },
        "connection.get",
        {},
      ),
    ).rejects.toMatchObject({ code: "CredentialRevoked" });
    await expect(
      p.execute({ credential: "not json" }, "connection.get", {}),
    ).rejects.toMatchObject({ code: "CredentialRevoked" });
  });
});
