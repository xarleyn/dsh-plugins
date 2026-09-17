/** Unit tests for `dsh_lightrag_documents` and `dsh_lightrag_status` (SPEC §4.3). */

import { describe, expect, it } from "vitest";

import { LightRagError } from "../src/errors.js";
import {
  createLightRagDocumentsTool,
  type LightRagDocumentsResult,
} from "../src/tools/documents.js";
import {
  createLightRagStatusTool,
  type LightRagStatusResult,
} from "../src/tools/status.js";
import type { LightRagToolDeps } from "../src/tools/shared.js";
import {
  jsonResponse,
  makeExec,
  testClient,
  testConfig,
  type RecordedCall,
  type TestClient,
} from "./helpers/lightrag.js";
import { silentPluginLogger } from "@yadsh/dsh-plugin-log";

function depsFor(stub: TestClient): LightRagToolDeps {
  return {
    config: stub.config,
    client: stub.client,
    logger: silentPluginLogger(),
  };
}

const DOCUMENT = {
  id: "doc-1",
  content_summary: "an architecture note",
  content_length: 1_240,
  status: "processed",
  created_at: "2026-09-17T09:00:00",
  updated_at: "2026-09-17T09:05:00",
  track_id: "track-1",
  chunks_count: 12,
  error_msg: null,
  metadata: { author: "stand" },
  file_path: "docs/architecture.md",
};

function listingHandler(
  documents: unknown[],
  counts: Record<string, number> = { processed: documents.length },
): (call: RecordedCall) => Response {
  return () =>
    jsonResponse({
      documents,
      pagination: {
        page: 1,
        page_size: 10,
        total_count: documents.length,
        total_pages: 1,
        has_next: false,
        has_prev: false,
      },
      status_counts: counts,
    });
}

describe("dsh_lightrag_documents", () => {
  it("lists the fields a deployment cares about", async () => {
    const stub = testClient(listingHandler([DOCUMENT]));
    const tool = createLightRagDocumentsTool(depsFor(stub));
    const result = (await tool.execute(
      {},
      makeExec(),
    )) as LightRagDocumentsResult;

    expect(result.documents).toEqual([
      {
        id: "doc-1",
        filePath: "docs/architecture.md",
        status: "processed",
        chunksCount: 12,
        contentLength: 1_240,
        updatedAt: "2026-09-17T09:05:00",
        errorMessage: "",
      },
    ]);
    expect(result.count).toBe(1);
    expect(result.totalCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.statusCounts).toEqual([{ status: "processed", count: 1 }]);
  });

  it("reports the failure reason of a failed document", async () => {
    const stub = testClient(
      listingHandler([
        {
          ...DOCUMENT,
          status: "failed",
          error_msg: "embedding endpoint refused",
        },
      ]),
    );
    const tool = createLightRagDocumentsTool(depsFor(stub));
    const result = (await tool.execute(
      {},
      makeExec(),
    )) as LightRagDocumentsResult;
    expect(result.documents[0]?.status).toBe("failed");
    expect(result.documents[0]?.errorMessage).toBe(
      "embedding endpoint refused",
    );
  });

  it("bounds the listing by the configured maximum", async () => {
    const stub = testClient(
      listingHandler([DOCUMENT]),
      testConfig({ documents: { maxListed: 7 } }),
    );
    const tool = createLightRagDocumentsTool(depsFor(stub));
    await tool.execute({}, makeExec());
    expect(stub.calls[0]?.body).toMatchObject({ page_size: 10 });

    const capped = testClient(
      listingHandler([DOCUMENT]),
      testConfig({ documents: { maxListed: 1_000 } }),
    );
    const bigLimit = createLightRagDocumentsTool(depsFor(capped));
    await bigLimit.execute({ limit: 10_000 }, makeExec());
    expect(capped.calls[0]?.body).toMatchObject({ page_size: 200 });
  });

  it("forwards a status filter and reports truncation", async () => {
    const stub = testClient((_call) =>
      jsonResponse({
        documents: [DOCUMENT],
        pagination: { page: 1, page_size: 10, total_count: 99, has_next: true },
        status_counts: { processed: 99 },
      }),
    );
    const tool = createLightRagDocumentsTool(depsFor(stub));
    const result = (await tool.execute(
      { status: "processed", limit: 10 },
      makeExec(),
    )) as LightRagDocumentsResult;
    expect(stub.calls[0]?.body).toMatchObject({
      status_filters: ["processed"],
    });
    expect(result.truncated).toBe(true);
    expect(result.totalCount).toBe(99);
    // statusCounts always describes the whole knowledge base.
    expect(result.statusCounts).toEqual([{ status: "processed", count: 99 }]);
  });

  it("surfaces a server failure as the plugin's typed error", async () => {
    const stub = testClient(() => jsonResponse({}, 503));
    const tool = createLightRagDocumentsTool(depsFor(stub));
    await expect(tool.execute({}, makeExec())).rejects.toMatchObject({
      code: "server-error",
    });
  });

  it("renders one line per document", async () => {
    const stub = testClient(listingHandler([DOCUMENT]));
    const tool = createLightRagDocumentsTool(depsFor(stub));
    const result = (await tool.execute(
      {},
      makeExec(),
    )) as LightRagDocumentsResult;
    const blocks = tool.output.render({}, result as never);
    const text = blocks[0]?.type === "text" ? blocks[0].text : "";
    expect(text).toContain("1 of 1 document(s)");
    expect(text).toContain("statuses: processed=1");
    expect(text).toContain("doc-1 processed docs/architecture.md");
  });
});

describe("dsh_lightrag_status", () => {
  it("reports health and the per-status document counts", async () => {
    const stub = testClient((call) =>
      call.url.endsWith("/health")
        ? jsonResponse({
            status: "healthy",
            core_version: "1.5.7",
            api_version: "0344",
            auth_mode: "disabled",
            pipeline_busy: true,
          })
        : jsonResponse({
            status_counts: { processed: 40, failed: 2, all: 42 },
          }),
    );
    const tool = createLightRagStatusTool(depsFor(stub));
    const result = await tool.execute({}, makeExec());

    expect(result).toEqual({
      status: "healthy",
      coreVersion: "1.5.7",
      apiVersion: "0344",
      authMode: "disabled",
      pipelineBusy: true,
      statusCounts: [
        { status: "all", count: 42 },
        { status: "failed", count: 2 },
        { status: "processed", count: 40 },
      ],
    });
    expect(stub.calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:9621/health",
      "http://127.0.0.1:9621/documents/status_counts",
    ]);
  });

  it("reports an empty knowledge base without failing", async () => {
    const stub = testClient((call) =>
      call.url.endsWith("/health")
        ? jsonResponse({ status: "healthy" })
        : jsonResponse({ status_counts: { all: 0 } }),
    );
    const tool = createLightRagStatusTool(depsFor(stub));
    const result = (await tool.execute({}, makeExec())) as LightRagStatusResult;
    expect(result.statusCounts).toEqual([{ status: "all", count: 0 }]);
    const blocks = tool.output.render({}, result as never);
    const text = blocks[0]?.type === "text" ? blocks[0].text : "";
    expect(text).toContain("pipeline idle");
    expect(text).toContain("all=0");
  });

  it("fails loudly when the server is unreachable", async () => {
    const stub = testClient(() => {
      throw new TypeError("fetch failed");
    });
    const tool = createLightRagStatusTool(depsFor(stub));
    await expect(tool.execute({}, makeExec())).rejects.toBeInstanceOf(
      LightRagError,
    );
    await expect(tool.execute({}, makeExec())).rejects.toMatchObject({
      code: "unreachable",
    });
  });
});
