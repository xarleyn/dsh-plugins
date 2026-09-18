import {
  attachmentBinaryProblem,
  attachmentByteLimit,
  attachmentName,
  assertReadableSize,
} from "../../src/providers/testit/attachments.js";
import { resolveTestitConfig } from "../../src/providers/testit/config.js";
import { TestitProvider } from "../../src/providers/testit/index.js";
import { config, credentialFor, stub } from "./shared.js";

describe("testit attachment policy", () => {
  it("refuses kinds that are not text and keeps the name it was given", () => {
    expect(attachmentBinaryProblem("report.txt")).toBeUndefined();
    expect(attachmentBinaryProblem("stack.log")).toBeUndefined();
    expect(attachmentBinaryProblem("screen.png")).toMatch(/never inlined/u);
    expect(attachmentBinaryProblem("build.zip")).toMatch(/never inlined/u);
    expect(attachmentBinaryProblem("spec.pdf")).toMatch(/never inlined/u);
    expect(attachmentBinaryProblem("id_rsa")).toBeUndefined();
    expect(attachmentName("  report.txt  ")).toBe("report.txt");
    expect(attachmentName(undefined)).toBe("");
  });

  it("bounds the byte budget by the deployment", () => {
    const flags = resolveTestitConfig({
      defaultAttachmentBytes: 4_096,
      maxAttachmentBytes: 8_192,
    });
    expect(attachmentByteLimit(undefined, flags)).toBe(4_096);
    expect(attachmentByteLimit(2_048, flags)).toBe(2_048);
    expect(attachmentByteLimit(64_000, flags)).toBe(8_192);
  });

  it("refuses a file Test IT already described as too large", () => {
    expect(() => assertReadableSize(9_000, 8_192)).toThrow(
      /larger than the attachment byte budget/u,
    );
    expect(() => assertReadableSize(8_192, 8_192)).not.toThrow();
    expect(() => assertReadableSize(undefined, 8_192)).not.toThrow();
  });

  it("describes the file itself before downloading it", async () => {
    const { calls, fetcher } = stub((url) => {
      if (url.pathname.endsWith("/metadata")) {
        return {
          json: {
            id: "att-1",
            name: "screen.png",
            size: 20_480,
            type: "image/png",
          },
        };
      }
      return {
        text: "never requested",
        headers: { "content-type": "image/png" },
      };
    });
    const provider = new TestitProvider(config(), fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor(fetcher) },
        "attachments.text",
        {
          attachmentId: "att-1",
        },
      ),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    // Only the metadata call was made: the refusal happened before the download.
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      "/api/v2/attachments/att-1/metadata",
    ]);
  });

  it("refuses an oversized file from its declared size, before the download", async () => {
    const { calls, fetcher } = stub((url) => {
      if (url.pathname.endsWith("/metadata")) {
        return {
          json: { name: "huge.log", size: 999_999, type: "text/plain" },
        };
      }
      return { text: "never requested" };
    });
    const provider = new TestitProvider(config(), fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor(fetcher) },
        "attachments.text",
        {
          attachmentId: "att-1",
          maxBytes: 2_048,
        },
      ),
    ).rejects.toMatchObject({ code: "ResultTooLarge" });
    expect(calls).toHaveLength(1);
  });

  it("redacts a secret a log left behind and bounds the body", async () => {
    const body = `setup ok\npassword=hunter2\n${"line\n".repeat(50)}`;
    const { calls, fetcher } = stub((url) => {
      if (url.pathname.endsWith("/metadata")) {
        return { json: { name: "run.log", size: 128, type: "text/plain" } };
      }
      return { text: body, headers: { "content-type": "text/plain" } };
    });
    const provider = new TestitProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "attachments.text",
      { attachmentId: "att-1", maxBytes: 1_024 },
    )) as Record<string, unknown>;
    expect(answer["name"]).toBe("run.log");
    expect(answer["declaredBytes"]).toBe(128);
    expect(answer["binary"]).toBe(false);
    const content = answer["untrustedContent"] as {
      readonly text: string;
      readonly truncated: boolean;
    };
    expect(content.text).toContain("password=[REDACTED]");
    expect(content.text).not.toContain("hunter2");
    expect(calls[1]?.url.pathname).toBe("/api/v2/attachments/att-1");
  });

  it("answers a binary body with its size and no content", async () => {
    const { fetcher } = stub((url) => {
      if (url.pathname.endsWith("/metadata")) {
        return {
          json: {
            name: "dump.bin.dat",
            size: 4,
            type: "application/octet-stream",
          },
        };
      }
      return {
        text: "\u0000\u0001\u0002\u0003",
        headers: { "content-type": "application/octet-stream" },
      };
    });
    const provider = new TestitProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "attachments.text",
      { attachmentId: "att-1" },
    )) as Record<string, unknown>;
    expect(answer["binary"]).toBe(true);
    expect(answer).not.toHaveProperty("untrustedContent");
  });
});
