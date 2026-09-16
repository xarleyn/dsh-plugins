import { describe, expect, it } from "vitest";

import { tabCountLabel } from "../src/client/chrome.js";

describe("panel wording", () => {
  it("counts tabs the way Russian asks for", () => {
    expect(tabCountLabel(0)).toBe("0 вкладок");
    expect(tabCountLabel(1)).toBe("1 вкладка");
    expect(tabCountLabel(2)).toBe("2 вкладки");
    expect(tabCountLabel(4)).toBe("4 вкладки");
    expect(tabCountLabel(5)).toBe("5 вкладок");
    expect(tabCountLabel(11)).toBe("11 вкладок");
    expect(tabCountLabel(21)).toBe("21 вкладка");
    expect(tabCountLabel(22)).toBe("22 вкладки");
  });
});
