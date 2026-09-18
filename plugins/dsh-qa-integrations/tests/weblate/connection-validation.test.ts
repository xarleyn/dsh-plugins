import { tokenKind } from "../../src/providers/weblate/index.js";
import { accountFromUsers } from "../../src/providers/weblate/operations.js";
import {
  INSTANCE,
  PAGE,
  TOKEN,
  USER,
  credentialFor,
  provider,
  stub,
} from "./shared.js";

describe("weblate connection validation", () => {
  it("proves the token and names the account in one read", async () => {
    const { calls, fetcher } = stub((url) =>
      url.pathname === "/api/users/"
        ? { json: { ...PAGE, results: [USER] } }
        : { json: {} },
    );
    const p = provider(fetcher);
    const validation = await p.validate({
      credential: credentialFor(TOKEN, {}, fetcher),
    });
    expect(calls[0]?.url.pathname).toBe("/api/users/");
    expect(calls[0]?.url.searchParams.get("page_size")).toBe("2");
    expect(validation).toEqual({
      tenantId: INSTANCE,
      externalUserId: "7",
      displayName: "Alice Example (@alice) · токен",
      capabilities: [...p.capabilities],
    });
    // The token travels in the Authorization header and nowhere else.
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Token ${TOKEN}`);
    expect(calls[0]?.url.toString()).not.toContain(TOKEN);
  });

  it("labels the token shape without trusting it", async () => {
    expect(tokenKind("wlu_abc")).toBe("personal");
    expect(tokenKind("wlp_abc")).toBe("project");
    expect(tokenKind("0123456789abcdef")).toBe("unknown");
    const { fetcher } = stub(() => ({ json: { ...PAGE, results: [USER] } }));
    const p = provider(fetcher);
    // The kind is read from the token that is actually stored, so it is a
    // property of the connection rather than a hint the caller sends along.
    for (const [token, label] of [
      [`wlu_${"a".repeat(40)}`, "личный токен"],
      [`wlp_${"b".repeat(40)}`, "токен проекта"],
      ["0123456789abcdef0123456789abcdef01234567", "токен"],
    ] as const) {
      const credential = p.parseCredential(token, { instanceId: "main" });
      const validation = await p.validate({
        credential: credential.credential,
      });
      expect(validation.displayName, token).toBe(
        `Alice Example (@alice) · ${label}`,
      );
    }
  });

  it("reports an unpinnable account instead of guessing one", async () => {
    // A token that may administer users answers with a full user list, and the
    // first row of that list is not the caller.
    const many = {
      count: 3,
      next: null,
      previous: null,
      results: [USER, { id: 1, username: "root", name: "Administrator" }],
    };
    expect(accountFromUsers(many)).toEqual({ account: null, resolved: false });
    expect(accountFromUsers({ ...PAGE, results: [] }).resolved).toBe(false);
    const { fetcher } = stub(() => ({ json: many }));
    const p = provider(fetcher);
    const validation = await p.validate({ credential: credentialFor() });
    expect(validation.externalUserId).toBe("");
    expect(validation.displayName).toBe("weblate.example.com · токен");
  });

  it("narrows the capabilities to the deployment switches", async () => {
    const { fetcher } = stub(() => ({ json: { ...PAGE, results: [USER] } }));
    const p = provider(fetcher, { screenshotsRead: false, checksRead: false });
    const validation = await p.validate({ credential: credentialFor() });
    expect(validation.capabilities).not.toContain("screenshots.read");
    expect(validation.capabilities).not.toContain("checks.read");
    expect(validation.capabilities).toContain("units.read");
  });
});
