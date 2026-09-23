import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("authenticated fetch settings content guide", () => {
  it("lists page, generic file and image download capabilities", () => {
    const source = readFileSync(
      new URL("../src/client/sections.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("web_fetch_file");
    expect(source).toContain("PDF, Office, spreadsheet, presentation, archive");
    expect(source).toContain("HTML/JSON/XML");
    expect(source).toContain("web_fetch_image");
    expect(source).toContain("PNG, JPEG, WebP and GIF");
  });
});
