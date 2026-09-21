/**
 * The HTTP boundary every provider shares: the deployment's byte cap, the
 * prefix-keeping truncation and the fold from a capped or unreadable body into
 * a domain error. Pinned once here because all seven transports route through
 * it — a second copy is what let one of them answer `ProviderUnavailable` for
 * a body the other six called `ResultTooLarge`.
 */
import { describe, expect, it } from "vitest";

import {
  readBoundedJson,
  readBoundedText,
} from "../src/providers/shared/http.js";

const JSON_HEADERS = { "content-type": "application/json" };

function upstream(
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status: 200,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

describe("readBoundedJson", () => {
  it("parses a body that is exactly the cap", async () => {
    const payload = JSON.stringify({ ID: "7" });
    await expect(
      readBoundedJson(
        upstream(payload),
        Buffer.byteLength(payload, "utf8"),
        "Provider",
      ),
    ).resolves.toEqual({ ID: "7" });
  });

  it("folds a body over the cap into ResultTooLarge, in the transport's words", async () => {
    const payload = JSON.stringify({ ID: "7".repeat(64) });
    await expect(
      readBoundedJson(upstream(payload), 32, "Confluence"),
    ).rejects.toMatchObject({
      code: "ResultTooLarge",
      message: "Confluence response is too large",
    });
  });

  it("treats a declared size over the cap as too large without reading the body", async () => {
    await expect(
      readBoundedJson(
        upstream('{"ID":"7"}', { "content-length": "4000000" }),
        8,
        "Provider",
      ),
    ).rejects.toMatchObject({ code: "ResultTooLarge" });
  });

  it("folds a body that is not JSON into ProviderUnavailable", async () => {
    await expect(
      readBoundedJson(upstream("not json"), 64, "Jira"),
    ).rejects.toMatchObject({
      code: "ProviderUnavailable",
      message: "Jira returned invalid JSON",
    });
  });

  it("never parses a body it classified as binary", async () => {
    const binary = new Response(new Uint8Array([0, 1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
    await expect(readBoundedJson(binary, 64, "Provider")).rejects.toMatchObject(
      { code: "ProviderUnavailable" },
    );
  });
});

describe("readBoundedText", () => {
  it("keeps the prefix that fits and reports the body as truncated", async () => {
    const body = await readBoundedText(upstream("x".repeat(40)), 16);
    expect(body.truncated).toBe(true);
    expect(body.text).toBe("x".repeat(16));
    expect(body.binary).toBe(false);
  });

  it("hands a binary body back as metadata instead of text", async () => {
    const binary = new Response(new Uint8Array([0, 1, 2]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
    const body = await readBoundedText(binary, 64);
    expect(body).toMatchObject({ binary: true, text: "", truncated: false });
  });
});
