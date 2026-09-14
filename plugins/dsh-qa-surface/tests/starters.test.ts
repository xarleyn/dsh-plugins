import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QaAccounts } from "../src/accounts/store.js";
import {
  QA_STARTERS_MAX_ITEMS,
  QA_STARTERS_MAX_LABEL,
  QA_STARTERS_MAX_PROMPT,
  effectiveQuickQuestions,
  normalizeStarters,
  validateStartersWrite,
} from "../src/starters.js";

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

describe("QA starters normalization", () => {
  it("degrades absent and malformed records to the empty shape", () => {
    expect(normalizeStarters(undefined)).toEqual({
      items: [],
      hideDefaults: false,
    });
    expect(normalizeStarters(null)).toEqual({ items: [], hideDefaults: false });
    expect(normalizeStarters("nope")).toEqual({
      items: [],
      hideDefaults: false,
    });
    expect(normalizeStarters({ items: "nope" })).toEqual({
      items: [],
      hideDefaults: false,
    });
  });

  it("drops incomplete pairs and keeps the readable rest", () => {
    expect(
      normalizeStarters({
        hideDefaults: true,
        items: [
          { label: "Задачи", prompt: "Найди мои задачи" },
          { label: "", prompt: "без названия" },
          { label: "Без промпта", prompt: "   " },
          "not an object",
          { label: "Ок", prompt: "Идём" },
        ],
      }),
    ).toEqual({
      items: [
        { label: "Задачи", prompt: "Найди мои задачи" },
        { label: "Ок", prompt: "Идём" },
      ],
      hideDefaults: true,
    });
  });

  it("caps the stored list and trims the fields", () => {
    const items = Array.from({ length: QA_STARTERS_MAX_ITEMS + 4 }, (_, i) => ({
      label: `Кнопка ${String(i)}`,
      prompt: `Промпт ${String(i)}`,
    }));
    const normalized = normalizeStarters({ items });
    expect(normalized.items).toHaveLength(QA_STARTERS_MAX_ITEMS);
    expect(
      normalizeStarters({ items: [{ label: " x ", prompt: " y " }] }),
    ).toEqual({ items: [{ label: "x", prompt: "y" }], hideDefaults: false });
  });
});

describe("QA starters write validation", () => {
  it("refuses payloads that are not a starters record", () => {
    expect(validateStartersWrite("nope")).toMatchObject({ ok: false });
    expect(validateStartersWrite(null)).toMatchObject({ ok: false });
    expect(validateStartersWrite({ hideDefaults: "yes" })).toMatchObject({
      ok: false,
    });
  });

  it("demands a label and a prompt on every row", () => {
    expect(
      validateStartersWrite({ items: [{ label: "", prompt: "x" }] }),
    ).toMatchObject({ ok: false });
    expect(
      validateStartersWrite({ items: [{ label: "x", prompt: "" }] }),
    ).toMatchObject({ ok: false });
    expect(validateStartersWrite({ items: ["x"] })).toMatchObject({
      ok: false,
    });
  });

  it("refuses overlong fields instead of truncating", () => {
    expect(
      validateStartersWrite({
        items: [{ label: "я".repeat(QA_STARTERS_MAX_LABEL + 1), prompt: "x" }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateStartersWrite({
        items: [{ label: "x", prompt: "я".repeat(QA_STARTERS_MAX_PROMPT + 1) }],
      }),
    ).toMatchObject({ ok: false });
  });

  it("accepts a clean write and caps the list", () => {
    expect(
      validateStartersWrite({
        items: [{ label: " Задачи ", prompt: "Найди мои задачи\n" }],
        hideDefaults: true,
      }),
    ).toEqual({
      ok: true,
      value: {
        items: [{ label: "Задачи", prompt: "Найди мои задачи" }],
        hideDefaults: true,
      },
    });
    const overflow = Array.from(
      { length: QA_STARTERS_MAX_ITEMS + 1 },
      (_, i) => ({ label: `К${String(i)}`, prompt: `П${String(i)}` }),
    );
    expect(validateStartersWrite({ items: overflow })).toMatchObject({
      ok: false,
    });
  });
});

describe("effective quick questions", () => {
  const DEFAULTS = ["Что ты умеешь?", "С чего начать?"];

  it("maps the deployment list for an anonymous visitor", () => {
    expect(effectiveQuickQuestions(undefined, DEFAULTS)).toEqual([
      { label: "Что ты умеешь?", prompt: "Что ты умеешь?" },
      { label: "С чего начать?", prompt: "С чего начать?" },
    ]);
  });

  it("puts the account's starters before the deployment list", () => {
    expect(
      effectiveQuickQuestions(
        {
          items: [{ label: "Мои задачи", prompt: "Найди мои задачи" }],
          hideDefaults: false,
        },
        DEFAULTS,
      ),
    ).toEqual([
      { label: "Мои задачи", prompt: "Найди мои задачи" },
      { label: "Что ты умеешь?", prompt: "Что ты умеешь?" },
      { label: "С чего начать?", prompt: "С чего начать?" },
    ]);
  });

  it("hides the deployment list when the account asked to", () => {
    expect(
      effectiveQuickQuestions({ items: [], hideDefaults: true }, DEFAULTS),
    ).toEqual([]);
  });
});

describe("QA account starters store", () => {
  function startersStore(): QaAccounts {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-starters-"));
    return new QaAccounts(path.join(dir, "qa-accounts.json"), {
      sessionTtlDays: 30,
      allowRegistration: true,
    });
  }

  it("starts every account on the empty starters", () => {
    const accounts = startersStore();
    const session = accounts.register("a@b.co", "password-1");
    expect(session.user.starters).toEqual({ items: [], hideDefaults: false });
  });

  it("writes only the caller's own starters through the token", () => {
    const accounts = startersStore();
    const owner = accounts.register("owner@b.co", "password-1");
    const other = accounts.register("other@b.co", "password-2");
    const updated = accounts.updateOwnStarters(owner.token, {
      items: [{ label: "Мои задачи", prompt: "Найди мои задачи" }],
      hideDefaults: true,
    });
    expect(updated.starters).toEqual({
      items: [{ label: "Мои задачи", prompt: "Найди мои задачи" }],
      hideDefaults: true,
    });
    expect(accounts.findUser(other.user.email)?.starters.items).toEqual([]);
    expect(
      reasonOf(() =>
        accounts.updateOwnStarters("v1.nope.nope", {
          items: [],
          hideDefaults: false,
        }),
      ),
    ).toBe("auth-required");
  });

  it("refuses invalid writes and keeps the stored record", () => {
    const accounts = startersStore();
    const session = accounts.register("a@b.co", "password-1");
    const write = (
      input: Parameters<QaAccounts["updateOwnStarters"]>[1],
    ): string | undefined =>
      reasonOf(() => accounts.updateOwnStarters(session.token, input));
    expect(
      write({ items: [{ label: "x", prompt: "" }], hideDefaults: false }),
    ).toBe("invalid-starters");
    expect(
      write({
        items: [{ label: "x", prompt: "я".repeat(QA_STARTERS_MAX_PROMPT + 1) }],
        hideDefaults: false,
      }),
    ).toBe("invalid-starters");
    // A refusal leaves the stored record untouched.
    expect(accounts.findUser("a@b.co")?.starters.items).toEqual([]);
  });
});
