import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QaAccounts } from "../../src/accounts/store.js";
import {
  emptyNotifications,
  normalizeNotifications,
  validateNotificationsWrite,
} from "../../src/notifications.js";

function reasonOf(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    if (
      error instanceof Object &&
      "reason" in error &&
      typeof error.reason === "string"
    ) {
      return error.reason;
    }
    throw error;
  }
  throw new Error("expected the operation to throw");
}

describe("QA notifications normalization", () => {
  it("degrades absent and malformed records to the shipped defaults", () => {
    expect(normalizeNotifications(undefined)).toEqual({
      inApp: true,
      desktop: false,
    });
    expect(normalizeNotifications(null)).toEqual(emptyNotifications());
    expect(normalizeNotifications("nope")).toEqual(emptyNotifications());
    expect(normalizeNotifications({ desktop: "yes" })).toEqual({
      inApp: true,
      desktop: false,
    });
  });

  it("keeps a half-written record readable without inventing a choice", () => {
    // A row hand-edited to name one channel leaves the other on its default:
    // the reader never asked, and guessing on their behalf is how a desktop
    // notice appears on a laptop nobody expected it on.
    expect(normalizeNotifications({ desktop: true })).toEqual({
      inApp: true,
      desktop: true,
    });
    expect(normalizeNotifications({ inApp: false })).toEqual({
      inApp: false,
      desktop: false,
    });
  });
});

describe("QA notifications write validation", () => {
  it("refuses payloads that are not a pair of choices", () => {
    expect(validateNotificationsWrite("nope")).toMatchObject({ ok: false });
    expect(validateNotificationsWrite(null)).toMatchObject({ ok: false });
    expect(validateNotificationsWrite({ inApp: true })).toMatchObject({
      ok: false,
    });
    expect(
      validateNotificationsWrite({ inApp: true, desktop: "yes" }),
    ).toMatchObject({ ok: false });
  });

  it("accepts the pair the form sends", () => {
    expect(validateNotificationsWrite({ inApp: false, desktop: true })).toEqual(
      { ok: true, value: { inApp: false, desktop: true } },
    );
  });
});

describe("QA account notifications store", () => {
  function notificationsStore(): QaAccounts {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-notifications-"));
    return new QaAccounts(path.join(dir, "qa-accounts.db"), {
      sessionTtlDays: 30,
      allowRegistration: true,
    });
  }

  it("starts every account with the page line on and the desktop off", () => {
    const accounts = notificationsStore();
    const session = accounts.register("a@b.co", "password-1");
    expect(session.user.notifications).toEqual({
      inApp: true,
      desktop: false,
    });
  });

  it("writes only the caller's own channels through the token", () => {
    const accounts = notificationsStore();
    const owner = accounts.register("owner@b.co", "password-1");
    const other = accounts.register("other@b.co", "password-2");
    const updated = accounts.updateOwnNotifications(owner.token, {
      inApp: true,
      desktop: true,
    });
    expect(updated.notifications).toEqual({ inApp: true, desktop: true });
    expect(accounts.findUser(other.user.email)?.notifications).toEqual({
      inApp: true,
      desktop: false,
    });
    expect(
      reasonOf(() =>
        accounts.updateOwnNotifications("v1.nope.nope", {
          inApp: true,
          desktop: false,
        }),
      ),
    ).toBe("auth-required");
  });

  it("refuses an invalid write and keeps the stored record", () => {
    const accounts = notificationsStore();
    const session = accounts.register("a@b.co", "password-1");
    accounts.updateOwnNotifications(session.token, {
      inApp: false,
      desktop: true,
    });
    expect(
      reasonOf(() =>
        accounts.updateOwnNotifications(session.token, {
          inApp: "no",
          desktop: true,
        } as never),
      ),
    ).toBe("invalid-notifications");
    expect(accounts.findUser("a@b.co")?.notifications).toEqual({
      inApp: false,
      desktop: true,
    });
  });

  it("carries the choice to the next reader of the same database", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-notifications-"));
    const file = path.join(dir, "qa-accounts.db");
    const options = { sessionTtlDays: 30, allowRegistration: true } as const;
    const first = new QaAccounts(file, options);
    const session = first.register("a@b.co", "password-1");
    // A row written before this column existed says nothing about the reader,
    // and so does a fresh one: both read back as the shipped defaults.
    expect(session.user.notifications).toEqual(emptyNotifications());
    first.updateOwnNotifications(session.token, {
      inApp: true,
      desktop: true,
    });
    first.close();
    // A re-opened store reads the row back through the same migration the
    // column arrived with, so the account keeps its answer across a restart.
    const again = new QaAccounts(file, options);
    expect(again.findUser("a@b.co")?.notifications).toEqual({
      inApp: true,
      desktop: true,
    });
    again.close();
  });
});
