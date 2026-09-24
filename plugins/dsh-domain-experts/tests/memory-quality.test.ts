import { describe, expect, it } from "vitest";
import { checkMemoryText } from "../src/host/memory/quality.js";

describe("memory quality gate", () => {
  it.each([
    "The settlement batch closes at 14:00 on the last working day.",
    "Проверка балансов идёт до 14:00, спорные tickets — в очередь разбора.",
    "Порог отсечки перенесён на 15:00",
  ])("keeps a finding: %s", (text) => {
    const check = checkMemoryText(text);
    expect(check.verdict).toBe("ok");
    expect(check.text).toBe(text);
  });

  it("trims what it keeps, so no stored record starts with padding", () => {
    expect(checkMemoryText("   A durable fact about cutoffs.  ").text).toBe(
      "A durable fact about cutoffs.",
    );
  });

  it.each([
    ["", "empty"],
    ["   \n ", "empty"],
    ["ок", "ack"],
    ["OK!", "ack"],
    ["Thank you.", "ack"],
    ["понял", "ack"],
    ["/clear", "slash_command"],
    ["/compact the session", "slash_command"],
    ["TODO", "placeholder"],
    ["<fill in later>", "placeholder"],
    ["{{value}}", "placeholder"],
    ["...", "placeholder"],
    ["не нашёл информации", "no_finding"],
    ["Ничего не нашёл.", "no_finding"],
    ["нет данных", "no_finding"],
    ["I don't know", "no_finding"],
    ["!!! ??? ***", "punctuation"],
    ["да", "ack"],
  ])("refuses %j as %s", (text, verdict) => {
    expect(checkMemoryText(text).verdict).toBe(verdict);
  });

  it.each(["see 4", "см. рис"])(
    "refuses %j as too short to carry a fact",
    (text) => {
      expect(checkMemoryText(text).verdict).toBe("too_short");
    },
  );

  it("names the verdict and the fix, so the model can act on the refusal", () => {
    const check = checkMemoryText("ок");
    expect(check.message).toContain("acknowledgement");
    expect(check.message.length).toBeGreaterThan(20);
  });
});
