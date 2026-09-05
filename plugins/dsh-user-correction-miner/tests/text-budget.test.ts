import { describe, expect, it } from "vitest";
import { truncateText } from "../src/mining/text-budget.js";

describe("truncateText", () => {
  it("returns short text unchanged", () => {
    expect(truncateText("abc", 10, "code-points")).toBe("abc");
    expect(truncateText("abc", 3, "code-points")).toBe("abc");
  });

  it("returns empty string when the budget cannot fit the ellipsis", () => {
    expect(truncateText("abcdef", 0, "code-points")).toBe("");
    expect(truncateText("abcdef", 0, "utf8-bytes")).toBe("");
    expect(truncateText("abcdef", 2, "utf8-bytes")).toBe("");
  });

  it("truncates by code points and keeps the ellipsis inside the budget", () => {
    const result = truncateText("abcdefgh", 6, "code-points");
    expect(result).toBe("abcde…");
    expect([...result]).toHaveLength(6);
  });

  it("keeps text that fits exactly, truncating one code point below", () => {
    expect(truncateText("abcdef", 7, "code-points")).toBe("abcdef");
    expect(truncateText("abcdef", 6, "code-points")).toBe("abcdef");
    expect(truncateText("abcdef", 5, "code-points")).toBe("abcd…");
  });

  it("truncates by utf8 byte size without splitting surrogate pairs", () => {
    const text = "ab😀"; // 1 + 1 + 4 = 6 bytes; ellipsis "…" = 3 bytes.
    expect(truncateText(text, 6, "utf8-bytes")).toBe(text);
    const truncated = truncateText(text, 5, "utf8-bytes");
    expect(truncated).toBe("ab…");
    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(5);
  });

  it("drops whole code points that do not fit the byte budget", () => {
    // "a😀bc" is 7 bytes; a 6-byte budget cannot keep the 4-byte emoji.
    const truncated = truncateText("a😀bc", 6, "utf8-bytes");
    expect(truncated).toBe("a…");
  });

  it("can return the bare ellipsis when only it fits", () => {
    expect(truncateText("😀", 3, "utf8-bytes")).toBe("…");
  });
});
