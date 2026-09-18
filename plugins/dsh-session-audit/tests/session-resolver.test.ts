import { describe, expect, it } from "vitest";
import { SessionResolver } from "../src/host/session-resolver.js";

const SESSION = "session-41b4e63f-9e35-4406-927b-25a60b7be2c2";
const SIBLING = "session-41b4e63f-9999-8888-7777-666655554444";

const resolverWith = (
  sessions: readonly string[],
  allowDirectoryPrefixMatch = true,
): SessionResolver =>
  new SessionResolver({
    listSessionIds: async () => sessions,
    allowDirectoryPrefixMatch,
  });

describe("SessionResolver", () => {
  it("binds the id the analysis declares, without consulting the corpus", async () => {
    let listed = false;
    const resolver = new SessionResolver({
      listSessionIds: async () => {
        listed = true;
        return [];
      },
      allowDirectoryPrefixMatch: true,
    });

    const result = await resolver.resolve(SESSION, "some-other-name");

    expect(result).toEqual({ status: "resolved", sessionId: SESSION });
    expect(listed).toBe(false);
  });

  it("binds a directory named for the full session id when the analysis is silent", async () => {
    const result = await resolverWith([SESSION, "session-1"]).resolve(
      null,
      SESSION,
    );

    expect(result).toEqual({ status: "resolved", sessionId: SESSION });
  });

  it("binds a unique prefix", async () => {
    const result = await resolverWith([SESSION, "session-9f9f9f9f"]).resolve(
      null,
      "session-41b4e63f",
    );

    expect(result).toEqual({ status: "resolved", sessionId: SESSION });
  });

  it("refuses an ambiguous prefix", async () => {
    const result = await resolverWith([SESSION, SIBLING]).resolve(
      null,
      "session-41b4e63f",
    );

    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;
    expect(result.error.code).toBe("SESSION_ID_AMBIGUOUS");
    expect(result.sessionId).toBeNull();
  });

  it("reports an unknown session", async () => {
    const result = await resolverWith([SESSION]).resolve(null, "session-nope");

    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("honours allowDirectoryPrefixMatch: false", async () => {
    const result = await resolverWith([SESSION], false).resolve(
      null,
      "session-41b4e63f",
    );

    expect(result.status).toBe("unresolved");
  });

  it("still matches an exact directory name with prefix matching disabled", async () => {
    const result = await resolverWith([SESSION], false).resolve(null, SESSION);

    expect(result).toEqual({ status: "resolved", sessionId: SESSION });
  });

  it("degrades when the corpus cannot be listed", async () => {
    const resolver = new SessionResolver({
      listSessionIds: async () => {
        throw new Error("sessionQuery is unavailable");
      },
      allowDirectoryPrefixMatch: true,
    });

    const result = await resolver.resolve(null, "session-41b4e63f");

    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
    expect(result.error.message).toContain("sessionQuery is unavailable");
  });

  it("treats a malformed directory name as unmatchable", async () => {
    const result = await resolverWith([SESSION]).resolve(null, "../escape");

    expect(result.status).toBe("unresolved");
  });
});

describe("SessionResolver.directoryAgreesWithSession", () => {
  it("accepts the abbreviated and the full form", () => {
    expect(
      SessionResolver.directoryAgreesWithSession("session-41b4e63f", SESSION),
    ).toBe(true);
    expect(SessionResolver.directoryAgreesWithSession(SESSION, SESSION)).toBe(
      true,
    );
  });

  it("rejects a directory naming a different session", () => {
    expect(
      SessionResolver.directoryAgreesWithSession("session-0ad608a8", SESSION),
    ).toBe(false);
  });
});
