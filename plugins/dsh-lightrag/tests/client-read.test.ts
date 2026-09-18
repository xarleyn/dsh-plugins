/** Unit tests for the LightRAG client: request shape, bounds, error mapping (SPEC §3, §4.4). */

import { describe, expect, it } from "vitest";

import { caught } from "./client.helpers.js";
import { jsonResponse, testClient } from "./helpers/lightrag.js";

describe("query", () => {
  it("sends the retrieval arguments the tool derived", async () => {
    const { client, calls } = testClient(() =>
      jsonResponse({
        response: "answer",
        references: [],
        response_time: 1.5,
        llm_generated: true,
      }),
    );
    await client.query({
      question: "what is the deployment?",
      mode: "hybrid",
      topK: 7,
      withContent: true,
    });
    expect(calls[0]?.url).toBe("http://127.0.0.1:9621/query");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(calls[0]?.body).toEqual({
      query: "what is the deployment?",
      mode: "hybrid",
      top_k: 7,
      include_references: true,
      include_chunk_content: true,
    });
  });

  it("normalizes references, including a null content field", async () => {
    const { client } = testClient(() =>
      jsonResponse({
        response: "answer",
        references: [
          { reference_id: "1", file_path: "docs/a.md", content: ["chunk"] },
          { reference_id: "2", file_path: "docs/b.md", content: null },
          { reference_id: "3", file_path: "docs/c.md" },
        ],
      }),
    );
    const answer = await client.query({
      question: "q",
      mode: "mix",
      topK: 3,
      withContent: true,
    });
    expect(answer.answer).toBe("answer");
    expect(answer.references).toEqual([
      { referenceId: "1", filePath: "docs/a.md", content: ["chunk"] },
      { referenceId: "2", filePath: "docs/b.md", content: [] },
      { referenceId: "3", filePath: "docs/c.md", content: [] },
    ]);
  });

  it("treats a missing reference list as empty and reports llm_generated", async () => {
    const { client } = testClient(() => jsonResponse({ response: "canned" }));
    const answer = await client.query({
      question: "q",
      mode: "mix",
      topK: 3,
      withContent: false,
    });
    expect(answer.references).toEqual([]);
    expect(answer.llmGenerated).toBeNull();
    expect(answer.responseTimeSeconds).toBeNull();
  });
});

describe("documents", () => {
  const page = (documents: unknown[], pagination: object, counts: object) => ({
    documents,
    pagination,
    status_counts: counts,
  });

  it("sends a server-legal page size and asks for the widest page it can", async () => {
    const { client, calls } = testClient(() =>
      jsonResponse(
        page(
          [],
          { page: 1, page_size: 10, total_count: 0, has_next: false },
          {},
        ),
      ),
    );
    await client.documents({ limit: 3 });
    // The server rejects page_size below 10, so a small limit still asks for 10.
    expect(calls[0]?.body).toEqual({
      page: 1,
      page_size: 10,
      sort_field: "updated_at",
      sort_direction: "desc",
    });
  });

  it("walks the server's pagination until the limit is met", async () => {
    const make = (index: number, hasNext: boolean) => ({
      documents: [
        {
          id: `doc-${index}`,
          file_path: `docs/${index}.md`,
          status: "processed",
          chunks_count: index,
          content_length: index * 10,
          created_at: "2026-09-17T10:00:00",
          updated_at: "2026-09-17T10:01:00",
          track_id: `track-${index}`,
          error_msg: null,
        },
      ],
      pagination: {
        page: index + 1,
        page_size: 10,
        total_count: 3,
        has_next: hasNext,
      },
      status_counts: { processed: 3 },
    });
    let call = 0;
    const { client, calls } = testClient(() => {
      const index = call;
      call += 1;
      return jsonResponse(make(index, index < 2));
    });

    const result = await client.documents({ limit: 3 });
    expect(calls).toHaveLength(3);
    expect(result.documents.map((document) => document.id)).toEqual([
      "doc-0",
      "doc-1",
      "doc-2",
    ]);
    expect(result.totalCount).toBe(3);
    expect(result.hasMore).toBe(false);
    expect(result.statusCounts).toEqual([{ status: "processed", count: 3 }]);
  });

  it("stops at the requested limit and reports that more remain", async () => {
    let call = 0;
    const { client, calls } = testClient(() => {
      const index = call;
      call += 1;
      return jsonResponse({
        documents: Array.from({ length: 10 }, (_unused, position) => ({
          id: `doc-${index * 10 + position}`,
          file_path: `docs/${index * 10 + position}.md`,
          status: "processed",
          content_length: 1,
        })),
        pagination: {
          page: index + 1,
          page_size: 10,
          total_count: 100,
          has_next: true,
        },
        status_counts: {},
      });
    });
    const result = await client.documents({ limit: 10 });
    expect(calls).toHaveLength(1);
    expect(result.documents).toHaveLength(10);
    expect(result.hasMore).toBe(true);
  });

  it("caps the page walk so one call cannot fan out forever", async () => {
    const { client, calls } = testClient(() =>
      jsonResponse({
        documents: Array.from({ length: 200 }, (_unused, index) => ({
          id: `doc-${index}`,
          file_path: `docs/${index}.md`,
          status: "processed",
        })),
        pagination: {
          page: 1,
          page_size: 200,
          total_count: 10_000,
          has_next: true,
        },
        status_counts: {},
      }),
    );
    const result = await client.documents({ limit: 1_000 });
    expect(calls).toHaveLength(5);
    expect(result.documents).toHaveLength(1_000);
    expect(result.hasMore).toBe(true);
  });

  it("passes a status filter as the server's status_filters list", async () => {
    const { client, calls } = testClient(() =>
      jsonResponse(page([], { total_count: 0, has_next: false }, {})),
    );
    await client.documents({ status: "failed", limit: 20 });
    expect(calls[0]?.body).toMatchObject({ status_filters: ["failed"] });

    const unfiltered = testClient(() =>
      jsonResponse(page([], { total_count: 0, has_next: false }, {})),
    );
    await unfiltered.client.documents({ limit: 20 });
    expect(unfiltered.calls[0]?.body).not.toHaveProperty("status_filters");
  });

  it("reads a document defensively when fields are missing", async () => {
    const { client } = testClient(() =>
      jsonResponse(
        page(
          [{ id: "doc-1", file_path: "docs/a.md", status: "processed" }],
          { total_count: 1, has_next: false },
          {},
        ),
      ),
    );
    const result = await client.documents({ limit: 10 });
    expect(result.documents[0]).toEqual({
      id: "doc-1",
      filePath: "docs/a.md",
      status: "processed",
      chunksCount: 0,
      contentLength: 0,
      createdAt: "",
      updatedAt: "",
      trackId: "",
      errorMessage: "",
    });
  });

  it("rejects a listing without a documents array", async () => {
    const { client } = testClient(() => jsonResponse({ pagination: {} }));
    const error = await caught(() => client.documents({ limit: 10 }));
    expect(error.code).toBe("bad-response");
  });
});

describe("status and health", () => {
  it("flattens and sorts the status count map", async () => {
    const { client } = testClient(() =>
      jsonResponse({ status_counts: { processed: 40, failed: 2, all: 42 } }),
    );
    expect(await client.statusCounts()).toEqual([
      { status: "all", count: 42 },
      { status: "failed", count: 2 },
      { status: "processed", count: 40 },
    ]);
  });

  it("reads health by name and ignores everything else", async () => {
    const { client } = testClient(() =>
      jsonResponse({
        status: "healthy",
        auth_mode: "disabled",
        core_version: "1.5.7",
        api_version: "0344",
        pipeline_busy: false,
        pipeline_active: true,
        webui_title: "QA knowledge base",
        input_directory: "/app/data/inputs",
        working_directory: "/app/data/rag_storage",
        configuration: { llm_model: "gpt-oss-120b" },
        something_new: [1, 2, 3],
      }),
    );
    expect(await client.health()).toEqual({
      status: "healthy",
      apiVersion: "0344",
      coreVersion: "1.5.7",
      authMode: "disabled",
      pipelineBusy: false,
      pipelineActive: true,
      webUiTitle: "QA knowledge base",
      inputDirectory: "/app/data/inputs",
      workingDirectory: "/app/data/rag_storage",
    });
  });

  it("reports absent health fields as empty rather than guessing", async () => {
    const { client } = testClient(() => jsonResponse({}));
    const health = await client.health();
    expect(health.status).toBe("");
    expect(health.coreVersion).toBe("");
    expect(health.pipelineBusy).toBe(false);
  });

  it("returns the raw pipeline status", async () => {
    const payload = { busy: true, job_name: "ingest" };
    const { client, calls } = testClient(() => jsonResponse(payload));
    expect(await client.pipelineStatus()).toEqual(payload);
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:9621/documents/pipeline_status",
    );
  });
});
