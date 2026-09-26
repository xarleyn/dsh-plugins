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

  it("puts back a session prefix the producer left off", async () => {
    const result = await resolverWith([SESSION, SIBLING]).resolve(
      "41b4e63f-9e35-4406-927b-25a60b7be2c2",
      "session-41b4e63f",
    );

    expect(result).toEqual({ status: "resolved", sessionId: SESSION });
  });

  it("matches the prefixed form as a whole id, never as a prefix", async () => {
    const result = await resolverWith([SESSION, SIBLING]).resolve(
      "41b4e63f",
      "session-41b4e63f",
    );

    // Two sessions start that way, and a repair that guessed would be a lie
    // about someone's work rather than an invisible audit.
    expect(result).toEqual({ status: "resolved", sessionId: "41b4e63f" });
  });

  it("keeps a declared id the corpus does not spell that way", async () => {
    const result = await resolverWith([SIBLING]).resolve(
      "41b4e63f-9e35-4406-927b-25a60b7be2c2",
      "audit-imported",
    );

    expect(result).toEqual({
      status: "resolved",
      sessionId: "41b4e63f-9e35-4406-927b-25a60b7be2c2",
    });
  });

  it("binds a prefix-less id even when the corpus cannot be listed", async () => {
    const resolver = new SessionResolver({
      listSessionIds: async () => {
        throw new Error("sessionQuery is unavailable");
      },
      allowDirectoryPrefixMatch: true,
    });

    const result = await resolver.resolve(
      "41b4e63f-9e35-4406-927b-25a60b7be2c2",
      "session-41b4e63f",
    );

    expect(result).toEqual({
      status: "resolved",
      sessionId: "41b4e63f-9e35-4406-927b-25a60b7be2c2",
    });
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

  it("answers a whole pass from one listing", async () => {
    let listed = 0;
    const resolver = new SessionResolver({
      listSessionIds: async () => {
        listed += 1;
        return [SESSION, SIBLING];
      },
      allowDirectoryPrefixMatch: true,
    });

    await resolver.observeCorpus();
    await resolver.resolve(null, "session-41b4e63f");
    await resolver.resolve("41b463f", "whatever");

    // Re-deciding a binding is per audit; walking the session store is not.
    expect(listed).toBe(1);
  });

  it("hands a listing it could not take back to the caller that can log it", async () => {
    const resolver = new SessionResolver({
      listSessionIds: async () => {
        throw new Error("sessionQuery is unavailable");
      },
      allowDirectoryPrefixMatch: true,
    });

    const observed = await resolver.observeCorpus();

    // The caller's `needsRebind` reads the generation, so a listing that did not
    // answer must not look like a corpus that changed.
    expect(observed.ok).toBe(false);
    if (observed.ok) return;
    expect(observed.error.code).toBe("SESSION_NOT_FOUND");
    expect(observed.error.message).toContain("sessionQuery is unavailable");
    expect(resolver.corpusGeneration).toBe(0);
  });
});

describe("SessionResolver.bindingCouldImprove", () => {
  it("keeps a binding the list made open", async () => {
    const byPrefix = await resolverWith([SESSION]).resolve(
      null,
      "session-41b4e63f",
    );
    const byName = await resolverWith([SESSION]).resolve(null, SESSION);

    // Both are the list's answer, and a list that grows can withdraw it: a
    // sibling appearing under the same prefix, or this session disappearing.
    expect(SessionResolver.bindingCouldImprove(byPrefix, null)).toBe(true);
    expect(SessionResolver.bindingCouldImprove(byName, null)).toBe(true);
  });

  it("closes a binding the analysis named the harness' way", async () => {
    const declared = await resolverWith([SESSION]).resolve(
      SESSION,
      "session-41b4e63f",
    );

    expect(SessionResolver.bindingCouldImprove(declared, SESSION)).toBe(false);
  });

  it("keeps a declared id whose spelling is not the harness' open", async () => {
    const bare = "41b4e63f-9e35-4406-927b-25a60b7be2c2";
    const declared = await resolverWith([SIBLING]).resolve(bare, "audit-in");

    expect(SessionResolver.bindingCouldImprove(declared, bare)).toBe(true);
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
