/** Unit tests for the LightRAG client: request shape, bounds, error mapping (SPEC §3, §4.4). */

import { describe, expect, it } from "vitest";

import { jsonResponse, testClient } from "./helpers/lightrag.js";

describe("write endpoints", () => {
  it("inserts text and omits an empty file_source", async () => {
    const { client, calls } = testClient(() =>
      jsonResponse({ status: "success", message: "ok", track_id: "track-1" }),
    );
    expect(await client.insertText({ text: "hello", source: "" })).toEqual({
      status: "success",
      message: "ok",
      trackId: "track-1",
    });
    expect(calls[0]?.url).toBe("http://127.0.0.1:9621/documents/text");
    expect(calls[0]?.body).toEqual({ text: "hello" });

    await client.insertText({ text: "hello", source: "docs/a.md" });
    expect(calls[1]?.body).toEqual({ text: "hello", file_source: "docs/a.md" });
  });

  it("scans the input directory", async () => {
    const { client, calls } = testClient(() =>
      jsonResponse({ status: "success", message: "scanning", track_id: "t" }),
    );
    await client.scanInputDirectory();
    expect(calls[0]?.url).toBe("http://127.0.0.1:9621/documents/scan");
    expect(calls[0]?.body).toBeUndefined();
  });

  it("deletes an index entry without touching the source file", async () => {
    const { client, calls } = testClient(() =>
      jsonResponse({ status: "success", message: "gone", doc_id: "doc-1" }),
    );
    expect(await client.deleteDocument({ documentId: "doc-1" })).toEqual({
      status: "success",
      message: "gone",
      docId: "doc-1",
    });
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.body).toEqual({
      doc_ids: ["doc-1"],
      delete_file: false,
      delete_llm_cache: false,
    });
  });

  it("treats an empty body as an empty result", async () => {
    const { client } = testClient(() => new Response("", { status: 200 }));
    expect(await client.deleteDocument({ documentId: "doc-1" })).toEqual({
      status: "",
      message: "",
      docId: "",
    });
  });
});
