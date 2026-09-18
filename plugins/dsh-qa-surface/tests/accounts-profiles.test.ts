import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QaAccounts } from "../src/accounts/store.js";
import { reasonOf } from "./accounts.helpers.js";

describe("QA account profiles", () => {
  const FIELDS = [
    { key: "jira", label: "Jira" },
    { key: "gitlab", label: "GitLab" },
  ];

  function profileStore(): QaAccounts {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-profiles-"));
    return new QaAccounts(path.join(dir, "qa-accounts.db"), {
      sessionTtlDays: 30,
      allowRegistration: true,
      instructionsMaxLength: 100,
      identityFields: FIELDS,
    });
  }

  it("starts every account on an empty profile", () => {
    const accounts = profileStore();
    const session = accounts.register("a@b.co", "password-1");
    expect(session.user.profile).toEqual({
      fullName: "",
      identities: {},
      instructions: "",
      updatedAt: null,
    });
    expect(accounts.findUser("A@B.co")?.profile.fullName).toBe("");
  });

  it("writes only the caller's own profile through the token", () => {
    const accounts = profileStore();
    const owner = accounts.register("owner@b.co", "password-1");
    const other = accounts.register("other@b.co", "password-2");
    const updated = accounts.updateOwnProfile(owner.token, {
      fullName: "Иван Иванов",
      identities: { jira: "i.ivanov", gitlab: "@iivanov" },
      instructions: "Отвечай кратко.",
    });
    expect(updated.email).toBe("owner@b.co");
    expect(updated.profile).toMatchObject({
      fullName: "Иван Иванов",
      identities: { jira: "i.ivanov", gitlab: "@iivanov" },
      instructions: "Отвечай кратко.",
    });
    expect(updated.profile.updatedAt).not.toBeNull();
    // The other account is untouched, and a bad token writes nothing.
    expect(accounts.findUser(other.user.email)?.profile.fullName).toBe("");
    expect(
      reasonOf(() =>
        accounts.updateOwnProfile("v1.nope.nope", {
          fullName: "x",
          identities: {},
          instructions: "",
        }),
      ),
    ).toBe("auth-required");
  });

  it("refuses writes the deployment cannot render", () => {
    const accounts = profileStore();
    const session = accounts.register("a@b.co", "password-1");
    const write = (
      input: Parameters<QaAccounts["setProfile"]>[1],
    ): string | undefined =>
      reasonOf(() => accounts.setProfile("a@b.co", input));
    expect(
      write({
        fullName: "",
        identities: { confluence: "x" },
        instructions: "",
      }),
    ).toBe("invalid-profile");
    expect(
      write({
        fullName: "я".repeat(201),
        identities: {},
        instructions: "",
      }),
    ).toBe("invalid-profile");
    expect(
      write({
        fullName: "",
        identities: {},
        instructions: "я".repeat(101),
      }),
    ).toBe("invalid-profile");
    expect(session.user.profile.fullName).toBe("");
    expect(accounts.findUser("a@b.co")?.profile.instructions).toBe("");
  });

  it("keeps the stored handles the request does not mention", () => {
    const accounts = profileStore();
    accounts.register("a@b.co", "password-1");
    accounts.setProfile("a@b.co", {
      fullName: "Иван",
      identities: { jira: "i.ivanov" },
      instructions: "",
    });
    // A full replace is what the browser sends: what it omits is cleared.
    const cleared = accounts.setProfile("a@b.co", {
      fullName: "Иван",
      identities: {},
      instructions: "",
    });
    expect(cleared.profile.identities).toEqual({});
  });

  it("resolves a session's owner and its identity for the prompt", () => {
    const accounts = profileStore();
    const session = accounts.register("a@b.co", "password-1");
    accounts.reserveSession(session.token, "session-1");
    expect(accounts.ownerIdOf("session-1")).toBe(session.user.id);
    expect(accounts.ownerIdOf("session-unknown")).toBeUndefined();
    expect(accounts.identityOf(session.user.id)).toEqual({
      email: "a@b.co",
      profile: {
        fullName: "",
        identities: {},
        instructions: "",
        updatedAt: null,
      },
    });
    // A disabled account stops being addressed by name.
    accounts.setUserDisabled("a@b.co", true);
    expect(accounts.identityOf(session.user.id)).toBeUndefined();
    expect(accounts.findUser("ghost@b.co")).toBeUndefined();
  });

  it("sees profile edits made by another process", () => {
    const filePath = path.join(
      mkdtempSync(path.join(tmpdir(), "qa-profiles-")),
      "qa-accounts.db",
    );
    const options = {
      sessionTtlDays: 30,
      allowRegistration: true,
      instructionsMaxLength: 100,
      identityFields: FIELDS,
    };
    const host = new QaAccounts(filePath, options);
    const session = host.register("a@b.co", "password-1");
    // The CLI is a separate process holding its own store on the same file.
    const cli = new QaAccounts(filePath, options);
    cli.setProfile("a@b.co", {
      fullName: "Иван Иванов",
      identities: { jira: "i.ivanov" },
      instructions: "",
    });
    expect(host.findUser("a@b.co")?.profile.fullName).toBe("Иван Иванов");
    expect(host.identityOf(session.user.id)?.profile.identities).toEqual({
      jira: "i.ivanov",
    });
  });
});
