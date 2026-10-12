import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Config, DEFAULTS, resolveConfig } from "../src/config.js";
import { buildPrompt } from "../src/prompt.js";
import { preservationWarnings, splitDraft } from "../src/text.js";

afterEach(() => vi.unstubAllEnvs());

describe("configuration", () => {
  it("exposes the schema and defaults", () => {
    vi.stubEnv("DSH_HUMANIZER_API_KEY", "");
    expect(Config).toBeDefined();
    expect(resolveConfig()).toEqual(DEFAULTS);
  });
  it.each([
    "file:///tmp/model",
    "http://user:secret@example.com",
    "http://example.com/api",
    "http://example.com/?key=secret",
    "http://example.com/#fragment",
    "invalid",
  ])(
    "rejects destinations outside the origin contract without echoing them",
    (endpoint) => {
      expect(() => resolveConfig({ endpoint })).toThrow("bare HTTP(S) origin");
      expect(() => resolveConfig({ endpoint })).not.toThrow(endpoint);
    },
  );
  it("normalizes origins and constrains numeric limits", () => {
    expect(
      resolveConfig({
        endpoint: " https://example.com:443/ ",
        timeoutMs: Infinity,
        maxInputBytes: 10,
        maxChunkBytes: 999999,
        maxOutputTokens: 999999,
        maxOutputBytes: -1,
      }),
    ).toMatchObject({
      endpoint: "https://example.com",
      timeoutMs: DEFAULTS.timeoutMs,
      maxInputBytes: 1024,
      maxChunkBytes: 1024,
      maxOutputTokens: 4096,
      maxOutputBytes: 1024,
    });
  });
  it("uses operator bearer configuration and rejects header injection", () => {
    vi.stubEnv("DSH_HUMANIZER_API_KEY", "environment-demo-key");
    expect(resolveConfig().apiKey).toBe("environment-demo-key");
    expect(resolveConfig({ apiKey: " override-demo-key " }).apiKey).toBe(
      "override-demo-key",
    );
    expect(() => resolveConfig({ apiKey: "demo\r\ninjected" })).toThrow(
      "invalid API key",
    );
  });
});

describe("prompt and preservation", () => {
  it("matches the author's byte-level fingerprint", () => {
    expect(
      createHash("sha256")
        .update(buildPrompt(" X "))
        .digest("hex")
        .slice(0, 16),
    ).toBe("cc51d66b4c593fbe");
    expect(buildPrompt("X")).toMatch(/\n\n### Rewritten:\n\n$/u);
  });
  it("groups prose without losing original boundary separators", () => {
    const text =
      "Alpha paragraph.\r\n\r\nBeta paragraph.\n\n\nGamma paragraph.";
    const groups = splitDraft(text, 25);
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.text + group.separator).join("")).toBe(
      text,
    );
  });
  it("measures UTF-8 bytes without cutting a paragraph", () => {
    expect(() => splitDraft("界".repeat(10), 29)).toThrow(
      "PARAGRAPH_TOO_LARGE",
    );
    expect(splitDraft("界".repeat(10), 30)).toHaveLength(1);
  });
  it("rejects fenced code", () => {
    expect(() => splitDraft("Prose.\n\n```js\nx()\n```", 100)).toThrow(
      "UNSUPPORTED_FORMAT",
    );
  });
  it("detects numbers, percent changes, duplicate loss and exact phrase changes", () => {
    expect(
      preservationWarnings(
        "12% by 2026-10-12; 12%; Demo Product",
        "12 by 2026-10-12; Demo",
        ["Demo Product"],
      ),
    ).toHaveLength(2);
    expect(
      preservationWarnings(
        "Pay 12.5 USD, twice: 12.5 USD.",
        "Twice, pay 12.5 USD and 12.5 USD.",
        ["USD"],
      ),
    ).toEqual([]);
  });
  it("warns about unexpected scripts", () => {
    expect(
      preservationWarnings("Русский черновик.", "English rewrite.", []),
    ).toEqual([expect.stringContaining("LANGUAGE_MISMATCH")]);
    expect(preservationWarnings("English draft.", "中文文本", [])).toEqual([
      expect.stringContaining("LANGUAGE_MISMATCH"),
    ]);
  });
});
