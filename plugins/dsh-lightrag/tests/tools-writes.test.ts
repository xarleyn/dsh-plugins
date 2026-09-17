/**
 * Unit tests for the write tools: the `writes.enabled` guard, the local byte
 * cap before any request, and the request each tool issues (SPEC §4.2, §4.3).
 */

import { describe, expect, it } from "vitest";

import { LightRagError } from "../src/errors.js";
import type { LightRagToolDeps } from "../src/tools/shared.js";
import {
  createLightRagDeleteTool,
  createLightRagInsertTool,
  createLightRagScanTool,
} from "../src/tools/writes.js";
import {
  jsonResponse,
  makeExec,
  testClient,
  testConfig,
  type TestClient,
} from "./helpers/lightrag.js";
import { silentPluginLogger } from "@yadsh/dsh-plugin-log";

const INSERT_RESPONSE = {
  status: "success",
  message: "Text inserted and queued for processing",
  track_id: "insert_20260917_abc",
};

function writesDeps(stub: TestClient): LightRagToolDeps {
  return {
    config: stub.config,
    client: stub.client,
    logger: silentPluginLogger(),
  };
}

/** The three write tools bound to one stub. */
function makeWriteTools(stub: TestClient) {
  const deps = writesDeps(stub);
  return {
    insert: createLightRagInsertTool(deps),
    scan: createLightRagScanTool(deps),
    remove: createLightRagDeleteTool(deps),
  };
}

const ENABLED = testConfig({ writes: { enabled: true } });

describe("writes.enabled guard", () => {
  it("refuses every write while the deployment kept them off", async () => {
    const stub = testClient(() => jsonResponse(INSERT_RESPONSE));
    const tools = makeWriteTools(stub);

    for (const [name, call] of [
      ["insert", () => tools.insert.execute({ text: "hi" }, makeExec())],
      ["scan", () => tools.scan.execute({}, makeExec())],
      ["delete", () => tools.remove.execute({ documentId: "d" }, makeExec())],
    ] as const) {
      await expect(call(), name).rejects.toMatchObject({ code: "disabled" });
    }
    // The guard runs before anything reaches the network.
    expect(stub.calls).toHaveLength(0);
  });

  it("names the switch that turns the tools on", async () => {
    const stub = testClient(() => jsonResponse(INSERT_RESPONSE));
    const tools = makeWriteTools(stub);
    await expect(tools.scan.execute({}, makeExec())).rejects.toThrow(
      /writes\.enabled/u,
    );
  });
});

describe("dsh_lightrag_insert", () => {
  it("inserts text with its source label", async () => {
    const stub = testClient(() => jsonResponse(INSERT_RESPONSE), ENABLED);
    const { insert } = makeWriteTools(stub);
    const result = await insert.execute(
      { text: "the stand runs three services", source: "docs/architecture.md" },
      makeExec(),
    );
    expect(result).toEqual({
      trackId: "insert_20260917_abc",
      status: "success",
      message: "Text inserted and queued for processing",
    });
    expect(stub.calls[0]?.url).toBe("http://127.0.0.1:9621/documents/text");
    expect(stub.calls[0]?.body).toEqual({
      text: "the stand runs three services",
      file_source: "docs/architecture.md",
    });
  });

  it("rejects text above the local byte cap before any request", async () => {
    const stub = testClient(
      () => jsonResponse(INSERT_RESPONSE),
      testConfig({ writes: { enabled: true, maxTextBytes: 1_024 } }),
    );
    const { insert } = makeWriteTools(stub);
    await expect(
      insert.execute({ text: "x".repeat(2_000) }, makeExec()),
    ).rejects.toMatchObject({ code: "too-large" });
    expect(stub.calls).toHaveLength(0);
  });

  it("measures the cap in bytes, not characters", async () => {
    // Each of these characters is two bytes in UTF-8.
    const stub = testClient(
      () => jsonResponse(INSERT_RESPONSE),
      testConfig({ writes: { enabled: true, maxTextBytes: 1_024 } }),
    );
    const { insert } = makeWriteTools(stub);
    await expect(
      insert.execute({ text: "é".repeat(600) }, makeExec()),
    ).rejects.toMatchObject({ code: "too-large" });
    expect(stub.calls).toHaveLength(0);

    const accepted = testClient(() => jsonResponse(INSERT_RESPONSE), ENABLED);
    await makeWriteTools(accepted).insert.execute(
      { text: "é".repeat(600) },
      makeExec(),
    );
    expect(accepted.calls).toHaveLength(1);
  });

  it("rejects blank text", async () => {
    const stub = testClient(() => jsonResponse(INSERT_RESPONSE), ENABLED);
    const { insert } = makeWriteTools(stub);
    await expect(
      insert.execute({ text: "   " }, makeExec()),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(stub.calls).toHaveLength(0);
  });
});

describe("dsh_lightrag_scan", () => {
  it("starts a scan of the server's input directory", async () => {
    const stub = testClient(
      () =>
        jsonResponse({
          status: "success",
          message: "Scanning started",
          track_id: "scan_1",
        }),
      ENABLED,
    );
    const { scan } = makeWriteTools(stub);
    expect(await scan.execute({}, makeExec())).toEqual({
      trackId: "scan_1",
      status: "success",
      message: "Scanning started",
    });
    expect(stub.calls[0]?.url).toBe("http://127.0.0.1:9621/documents/scan");
  });
});

describe("dsh_lightrag_delete", () => {
  it("removes one document by id", async () => {
    const stub = testClient(
      () =>
        jsonResponse({
          status: "success",
          message: "Document deleted",
          doc_id: "doc-1",
        }),
      ENABLED,
    );
    const { remove } = makeWriteTools(stub);
    expect(await remove.execute({ documentId: "doc-1" }, makeExec())).toEqual({
      docId: "doc-1",
      status: "success",
      message: "Document deleted",
    });
    expect(stub.calls[0]?.method).toBe("DELETE");
    expect(stub.calls[0]?.body).toEqual({
      doc_ids: ["doc-1"],
      delete_file: false,
      delete_llm_cache: false,
    });
  });

  it("rejects an empty document id", async () => {
    const stub = testClient(() => jsonResponse({}), ENABLED);
    const { remove } = makeWriteTools(stub);
    await expect(
      remove.execute({ documentId: "" }, makeExec()),
    ).rejects.toBeInstanceOf(LightRagError);
    expect(stub.calls).toHaveLength(0);
  });
});
