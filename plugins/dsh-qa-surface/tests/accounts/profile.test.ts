import { describe, expect, it } from "vitest";
import {
  QA_PROFILE_MAX_FULL_NAME,
  QA_PROFILE_MAX_IDENTITIES,
  emptyProfile,
  normalizeProfile,
  validateIdentityFields,
  validateProfileWrite,
} from "../../src/profile.js";
import type { QaAccountIdentityField } from "../../src/types.js";

const FIELDS: readonly QaAccountIdentityField[] = [
  { key: "jira", label: "Jira" },
  { key: "gitlab", label: "GitLab" },
];
const WRITE = { instructionsMaxLength: 100, identities: FIELDS };

describe("stored profile normalization", () => {
  it("reads an absent or malformed profile as empty", () => {
    expect(normalizeProfile(undefined)).toEqual(emptyProfile());
    expect(normalizeProfile("nope")).toEqual(emptyProfile());
    expect(normalizeProfile({ identities: ["jira"] })).toEqual(emptyProfile());
  });

  it("normalizes stored text and drops unusable handles", () => {
    const profile = normalizeProfile({
      fullName: "  Иван\u0000  Иванов ",
      identities: { jira: " i.ivanov ", "Bad Key": "x", gitlab: "", "": "y" },
      instructions: "Отвечай кратко\r\n\r\n\r\nи по делу",
      updatedAt: "2026-09-13T00:00:00.000Z",
    });
    expect(profile.fullName).toBe("Иван Иванов");
    expect(profile.identities).toEqual({ jira: "i.ivanov" });
    expect(profile.instructions).toBe("Отвечай кратко\n\nи по делу");
    expect(profile.updatedAt).toBe("2026-09-13T00:00:00.000Z");
  });

  it("truncates overlong stored values instead of throwing", () => {
    const profile = normalizeProfile({
      fullName: "я".repeat(QA_PROFILE_MAX_FULL_NAME + 50),
      identities: Object.fromEntries(
        Array.from({ length: QA_PROFILE_MAX_IDENTITIES + 4 }, (_, index) => [
          `key${String(index)}`,
          "value",
        ]),
      ),
    });
    expect(profile.fullName.length).toBe(QA_PROFILE_MAX_FULL_NAME);
    expect(Object.keys(profile.identities).length).toBe(
      QA_PROFILE_MAX_IDENTITIES,
    );
  });
});

describe("profile write validation", () => {
  it("accepts and cleans a full write", () => {
    const result = validateProfileWrite(
      {
        fullName: "  Иван Иванов ",
        identities: { jira: " i.ivanov ", gitlab: "" },
        instructions: "Отвечай кратко",
      },
      WRITE,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        fullName: "Иван Иванов",
        identities: { jira: "i.ivanov" },
        instructions: "Отвечай кратко",
      },
    });
  });

  it("refuses overlong text and undeclared handles by name", () => {
    const longName = validateProfileWrite(
      { fullName: "я".repeat(QA_PROFILE_MAX_FULL_NAME + 1) },
      WRITE,
    );
    expect(longName).toMatchObject({ ok: false });
    expect(longName.ok ? "" : longName.message).toContain("full name");

    const longInstructions = validateProfileWrite(
      { instructions: "я".repeat(101) },
      WRITE,
    );
    expect(longInstructions.ok ? "" : longInstructions.message).toContain(
      "100 characters",
    );

    const undeclared = validateProfileWrite(
      { identities: { confluence: "x" } },
      WRITE,
    );
    expect(undeclared.ok ? "" : undeclared.message).toContain(
      'declares no "confluence"',
    );
  });

  it("checks only the key shape when no fields are declared", () => {
    // The operator CLI writes without a deployment field list in hand, so an
    // undeclared key is stored (and simply never rendered) while a key that
    // could not be rendered anywhere is still refused.
    const undeclared = validateProfileWrite(
      { identities: { confluence: "x" } },
      { instructionsMaxLength: 100 },
    );
    expect(undeclared).toMatchObject({
      ok: true,
      value: { identities: { confluence: "x" } },
    });
    const malformed = validateProfileWrite(
      { identities: { "Bad Key": "y" } },
      { instructionsMaxLength: 100 },
    );
    expect(malformed.ok ? "" : malformed.message).toContain(
      "not a usable identity key",
    );
  });

  it("refuses payloads that are not the shape the form sends", () => {
    for (const input of [undefined, "nope", [], { identities: 4 }]) {
      expect(validateProfileWrite(input, WRITE).ok).toBe(false);
    }
  });
});

describe("declared identity fields", () => {
  it("defaults an absent list to none", () => {
    expect(validateIdentityFields(undefined)).toEqual({ ok: true, value: [] });
  });

  it("normalizes keys and falls back to the key as the label", () => {
    expect(
      validateIdentityFields([
        { key: " JIRA " },
        { key: "gitlab", label: " GitLab " },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { key: "jira", label: "jira" },
        { key: "gitlab", label: "GitLab" },
      ],
    });
  });

  it("refuses duplicates, unusable keys, and absurd lists", () => {
    const duplicate = validateIdentityFields([
      { key: "jira" },
      { key: "jira" },
    ]);
    expect(duplicate.ok ? "" : duplicate.message).toContain("twice");

    const badKey = validateIdentityFields([{ key: "Jira Tracker!" }]);
    expect(badKey.ok ? "" : badKey.message).toContain("lowercase labels");

    const notAnObject = validateIdentityFields(["jira"]);
    expect(notAnObject.ok ? "" : notAnObject.message).toContain("object");

    const tooMany = validateIdentityFields(
      Array.from({ length: 9 }, (_, index) => ({ key: `key${String(index)}` })),
    );
    expect(tooMany.ok ? "" : tooMany.message).toContain("at most 8");
  });
});
