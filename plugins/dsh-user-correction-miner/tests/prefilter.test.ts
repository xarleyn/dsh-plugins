import { describe, expect, it } from "vitest";
import { prefilterCorrection } from "../src/mining/prefilter.js";

describe("prefilterCorrection", () => {
  it.each([
    "Не тот файл.",
    "Не трогай public/.",
    "Используй pnpm, не npm.",
    "Я же просил сначала запустить typecheck.",
    "Don't deploy without asking.",
    "Use pnpm instead of npm.",
  ])("selects correction-like text: %s", (text) => {
    expect(prefilterCorrection(text).matched).toBe(true);
  });

  it.each(["Спасибо!", "Готово", "Looks good to me."])("rejects ordinary text: %s", (text) => {
    expect(prefilterCorrection(text).matched).toBe(false);
  });

  it("marks explicit temporary language without deciding durability", () => {
    expect(prefilterCorrection("Не запускай сейчас тесты.")).toMatchObject({
      matched: true,
      likelyOneOff: true,
    });
  });
});
