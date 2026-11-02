import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { DoclingExtractor } from "../src/documents/providers/docling.js";
import { workspace, writeInput } from "./documents-convert.helpers.js";

async function run(
  fetchImpl: typeof fetch,
  maxResponseBytes = 100,
  signal = new AbortController().signal,
) {
  const inputPath = await writeInput("input.pdf", "%PDF-1.4\n%%EOF");
  return new DoclingExtractor({
    baseUrl: "https://docling.example.com",
    timeoutMs: 20,
    maxResponseBytes,
    maxImages: 2,
    fetchImpl,
  }).extract({
    inputPath,
    workDir: workspace,
    assetsDir: path.join(workspace, "assets"),
    ocr: "off",
    extractImages: false,
    extractTables: true,
    preservePageMarkers: false,
    signal,
  });
}

describe("Docling HTTP lifetime", () => {
  test("enforces its deadline even with an active caller signal", async () => {
    await expect(
      run(async () => new Promise<Response>(() => {})),
    ).rejects.toMatchObject({ code: "BACKEND_TIMEOUT" });
  });

  test.each([200, 503])(
    "bounds a stalled body after HTTP %s headers",
    async (status) => {
      const cancel = vi.fn();
      await expect(
        run(
          async () => new Response(new ReadableStream({ cancel }), { status }),
        ),
      ).rejects.toMatchObject({ code: "BACKEND_TIMEOUT" });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  test("counts UTF-8 bytes instead of JSON string characters", async () => {
    const body = JSON.stringify({ md_content: "я".repeat(60) });
    expect(body.length).toBeLessThan(100);
    await expect(run(async () => new Response(body))).rejects.toMatchObject({
      code: "DOCUMENT_TOO_LARGE",
    });
  });

  test("stops reading an oversized error body and keeps its status classification", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    await expect(
      run(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("x".repeat(1000)));
              },
              cancel,
            }),
            { status: 503 },
          ),
      ),
    ).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      details: { status: 503 },
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("preserves caller cancellation before issuing a request", async () => {
    const caller = new AbortController();
    caller.abort();
    const fetcher = vi.fn<typeof fetch>();
    await expect(run(fetcher, 100, caller.signal)).rejects.toMatchObject({
      code: "BACKEND_TIMEOUT",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
