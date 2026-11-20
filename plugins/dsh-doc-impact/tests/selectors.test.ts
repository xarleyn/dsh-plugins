import { describe, expect, it } from "vitest";
import {
  createFilesystemDetector,
  matchingFiles,
  matchesSelector,
  materializeSelector,
  normalizeWorkspacePath,
} from "../src/index.js";

describe("selectors", () => {
  it("accepts brace alternatives and character classes", () => {
    const rule = { include: ["docs/{guide,part-[ab]}.md"], exclude: [] };
    expect(
      matchingFiles(
        ["docs/guide.md", "docs/part-a.md", "docs/part-c.md"],
        rule,
      ),
    ).toEqual(["docs/guide.md", "docs/part-a.md"]);
    expect(
      matchesSelector("docs/part-+.md", {
        include: ["docs/part-[a+(].md"],
        exclude: [],
      }),
    ).toBe(true);
  });

  it("rejects extglobs supplied directly to matching and filesystem enumeration", async () => {
    const rule = { include: ["docs/@(guide|notes).md"], exclude: [] };
    expect(() => matchesSelector("docs/guide.md", rule)).toThrow("extglob");
    const detector = createFilesystemDetector({
      selectors: [rule],
      maxFiles: 10,
    });
    await expect(detector.listFiles(process.cwd())).rejects.toThrow("extglob");
  });

  const selector = {
    include: ["packages/api/**", "packages/sdk"],
    exclude: ["**/*.test.ts", "**/__fixtures__/**"],
  };

  it("matches globs, directories, and Windows-style candidate paths", () => {
    expect(matchesSelector("packages\\api\\src\\index.ts", selector)).toBe(
      true,
    );
    expect(matchesSelector("packages/sdk/src/client.ts", selector)).toBe(true);
    expect(matchesSelector("packages/api/src/index.test.ts", selector)).toBe(
      false,
    );
    expect(
      matchesSelector("packages/api/__fixtures__/response.ts", selector),
    ).toBe(false);
    expect(matchesSelector("packages/other/index.ts", selector)).toBe(false);
  });

  it("materializes known glob matches and preserves literal missing targets", () => {
    expect(
      materializeSelector(
        {
          include: ["docs/**/*.md", "docs/missing.md"],
          exclude: ["docs/internal/**"],
        },
        ["docs/api.md", "docs/internal/debug.md"],
      ),
    ).toEqual(["docs/api.md", "docs/missing.md"]);
  });

  it("normalizes workspace paths to POSIX style", () => {
    expect(normalizeWorkspacePath(".\\packages\\auth\\src\\index.ts")).toBe(
      "packages/auth/src/index.ts",
    );
  });
});
