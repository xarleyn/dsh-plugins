/**
 * The conversion cache (§44 of the source-issue plan).
 *
 * The promises the cache has to keep are: a repeat with the same inputs does
 * not touch the backend, a change of any input-visible setting does, a stored
 * entry whose files are gone or altered is a miss rather than a wrong answer,
 * and a hit is still a complete artifact — bundle, manifest, provenance. The
 * tests below pin exactly those, because a cache that is fast but occasionally
 * wrong is worse than no cache at all.
 */

import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { CacheStore } from "../src/documents/cache/store.js";
import { DocumentError } from "../src/documents/errors.js";
import { docxBytes, pdfBytes } from "./helpers/document-fixtures.js";
import { stubProviderSet } from "./helpers/document-providers.js";

import {
  runtime,
  scope,
  stub,
  writeInput,
} from "./documents-convert.helpers.js";

/** Read a manifest as a loose record; the shape is asserted elsewhere. */
async function manifestOf(manifestPath: string): Promise<
  Record<string, unknown> & {
    cache?: { hit?: boolean; sourceArtifactId?: string };
    outputs?: { sha256?: string }[];
  }
> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as never;
}

function artifactRootOf(workspace: string): string {
  return path.join(workspace, ".qa", "artifacts", "documents");
}

async function cacheEntries(workspace: string): Promise<string[]> {
  return (
    await readdir(path.join(artifactRootOf(workspace), ".cache")).catch(
      () => [] as string[],
    )
  ).filter((name) => name.endsWith(".json"));
}

describe("conversion cache", () => {
  test("a repeated extraction reuses the stored Markdown instead of the backend", async () => {
    const source = await writeInput(
      "report.docx",
      docxBytes({ headings: ["H"] }),
    );
    const first = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    const second = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );

    expect(stub.calls.extract).toHaveLength(1);
    expect(second.files[0]?.path).not.toBe(first.files[0]?.path);
    expect(second.files[0]?.sha256).toBe(first.files[0]?.sha256);
    expect(await cacheEntries(scope().workspaceRoot)).toHaveLength(1);

    const manifest = await manifestOf(second.manifestPath);
    expect(manifest.cache).toMatchObject({
      hit: true,
      sourceArtifactId: first.artifactId,
    });
    expect(manifest.outputs?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("the materialized copy is byte-identical to the run that produced it", async () => {
    const source = await writeInput("report.pdf", pdfBytes({ pages: 2 }));
    const first = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    const second = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );

    const firstBytes = await readFile(first.files[0]?.path ?? "");
    const secondBytes = await readFile(second.files[0]?.path ?? "");
    expect(secondBytes.equals(firstBytes)).toBe(true);
    expect(stub.calls.extract).toHaveLength(1);
  });

  test("a changed option is a miss, not a stale hit", async () => {
    const source = await writeInput("report.docx", docxBytes());
    await runtime().convert({ file: source, targetFormat: "md" }, scope());
    await runtime().convert(
      { file: source, targetFormat: "md", options: { ocr: "force" } },
      scope(),
    );
    expect(stub.calls.extract).toHaveLength(2);
    expect(await cacheEntries(scope().workspaceRoot)).toHaveLength(2);
  });

  test("changed input bytes are a different entry", async () => {
    const source = await writeInput(
      "report.docx",
      docxBytes({ headings: ["One"] }),
    );
    await runtime().convert({ file: source, targetFormat: "md" }, scope());
    await writeFile(source, docxBytes({ headings: ["Two"] }));
    await runtime().convert({ file: source, targetFormat: "md" }, scope());
    expect(stub.calls.extract).toHaveLength(2);
  });

  test("a backend version change invalidates the entry", async () => {
    const versioned = stubProviderSet({ extractorVersion: () => "1.0" });
    const source = await writeInput("report.docx", docxBytes());
    await runtime({ providers: versioned }).convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    versioned.setExtractorVersion("2.0");
    await runtime({ providers: versioned }).convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    expect(versioned.calls.extract).toHaveLength(2);
  });

  test("a DOCX→PDF conversion is cached across runs", async () => {
    const source = await writeInput("report.docx", docxBytes());
    const first = await runtime().convert(
      { file: source, targetFormat: "pdf" },
      scope(),
    );
    const second = await runtime().convert(
      { file: source, targetFormat: "pdf" },
      scope(),
    );

    expect(stub.calls.convert).toHaveLength(1);
    expect(second.files[0]?.sha256).toBe(first.files[0]?.sha256);
    const manifest = await manifestOf(second.manifestPath);
    expect(manifest.cache?.hit).toBe(true);
  });

  test("a missing cached file turns the lookup into a fresh run", async () => {
    const source = await writeInput("report.docx", docxBytes());
    const first = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    // A retention sweep can remove the bundle the entry points at; delete one.
    await rm(path.dirname(first.manifestPath), {
      recursive: true,
      force: true,
    });
    const second = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    expect(stub.calls.extract).toHaveLength(2);
    const manifest = await manifestOf(second.manifestPath);
    expect(manifest.cache).toBeUndefined();
  });

  test("an entry whose recorded hash no longer matches is refused", async () => {
    const source = await writeInput("report.docx", docxBytes());
    const first = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    const [entryName] = await cacheEntries(scope().workspaceRoot);
    expect(entryName).toBeDefined();
    const entryPath = path.join(
      artifactRootOf(scope().workspaceRoot),
      ".cache",
      entryName!,
    );
    const entry = JSON.parse(await readFile(entryPath, "utf8")) as {
      outputs: { sha256: string }[];
    };
    entry.outputs[0]!.sha256 = "0".repeat(64);
    await writeFile(entryPath, JSON.stringify(entry));

    const second = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    expect(stub.calls.extract).toHaveLength(2);
    expect(await manifestOf(second.manifestPath)).not.toHaveProperty("cache");
    expect(second.files[0]?.sha256).toBe(first.files[0]?.sha256);

    // The stale entry is replaced by the fresh run, not left to be trusted.
    const refreshed = JSON.parse(await readFile(entryPath, "utf8")) as {
      outputs: { sha256: string }[];
    };
    expect(refreshed.outputs[0]?.sha256).not.toBe("0".repeat(64));
  });

  test("a torn entry file is a miss and does not fail the conversion", async () => {
    const source = await writeInput("report.docx", docxBytes());
    const first = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    const [entryName] = await cacheEntries(scope().workspaceRoot);
    expect(entryName).toBeDefined();
    await writeFile(
      path.join(artifactRootOf(scope().workspaceRoot), ".cache", entryName!),
      "{ not json",
    );
    const second = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    expect(stub.calls.extract).toHaveLength(2);
    expect(second.files[0]?.sha256).toBe(first.files[0]?.sha256);
  });

  test("caching can be switched off entirely", async () => {
    const source = await writeInput("report.docx", docxBytes());
    const off = { cache: { enabled: false } };
    await runtime({ config: off }).convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    await runtime({ config: off }).convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    expect(stub.calls.extract).toHaveLength(2);
    expect(await cacheEntries(scope().workspaceRoot)).toHaveLength(0);
  });

  test("a cached document_to_markdown reports what a run would, down to the pages", async () => {
    const source = await writeInput("long.pdf", pdfBytes({ pages: 5 }));
    const first = await runtime().toMarkdown({ file: source }, scope());
    const second = await runtime().toMarkdown({ file: source }, scope());

    expect(stub.calls.extract).toHaveLength(1);
    expect(second.markdown).toBe(first.markdown);
    expect(second.pages).toBe(first.pages);
    expect(second.backend).toBe(first.backend);
    expect(second.warnings.map((warning) => warning.code)).toEqual(
      first.warnings.map((warning) => warning.code),
    );
    expect(second.assets?.length ?? 0).toBe(first.assets?.length ?? 0);
  });

  test("the manifest of a hit names the bundle its bytes came from", async () => {
    const source = await writeInput("report.docx", docxBytes());
    const first = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    const second = await runtime().convert(
      { file: source, targetFormat: "md" },
      scope(),
    );
    const manifest = await manifestOf(second.manifestPath);
    expect(manifest.cache?.sourceArtifactId).toBe(first.artifactId);
    expect(manifest.artifact_id ?? manifest["artifactId"]).toBe(
      second.artifactId,
    );
  });

  test("the pipeline fingerprint changes when output-shaping settings change", async () => {
    const source = await writeInput("report.docx", docxBytes());
    await runtime().convert({ file: source, targetFormat: "md" }, scope());
    await runtime({
      config: { extraction: { extractTables: false } },
    }).convert({ file: source, targetFormat: "md" }, scope());
    expect(stub.calls.extract).toHaveLength(2);
  });

  test("a failed conversion leaves no entry behind", async () => {
    const failing = stubProviderSet({
      extractError: new DocumentError("EXTRACTION_FAILED", "docling is down"),
    });
    const source = await writeInput("report.docx", docxBytes());
    await expect(
      runtime({ providers: failing }).convert(
        { file: source, targetFormat: "md" },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
    expect(await cacheEntries(scope().workspaceRoot)).toHaveLength(0);
  });
});

describe("CacheStore budgets", () => {
  const entry = (key: string, accessedAt: string, bytes: number) => ({
    version: 1 as const,
    key,
    operation: "document_convert" as const,
    createdAt: accessedAt,
    accessedAt,
    hitCount: 0,
    bytes,
    outputs: [
      {
        artifactId: `doc_${"0".repeat(26)}`,
        outputName: "out.md",
        format: "md" as const,
        mediaType: "text/markdown",
        size: bytes,
        sha256: "a".repeat(64),
      },
    ],
    backends: [],
    warnings: [],
  });

  test("entries older than the horizon are dropped when a new one is written", async () => {
    const root = path.join(scope().workspaceRoot, "budget-age");
    const store = new CacheStore({
      root,
      maxAgeDays: 1,
      maxEntries: 10,
      maxBytes: 1_000_000,
    });
    await store.put(entry("old", "2020-01-01T00:00:00.000Z", 10));
    await store.put(entry("new", new Date().toISOString(), 10));
    expect(await store.get("old")).toBeUndefined();
    expect(await store.get("new")).toBeDefined();
  });

  test("the count budget evicts least-recently-accessed entries", async () => {
    const root = path.join(scope().workspaceRoot, "budget-count");
    const store = new CacheStore({
      root,
      maxAgeDays: 365,
      maxEntries: 2,
      maxBytes: 1_000_000,
    });
    const now = new Date().toISOString();
    await store.put(entry("a", "2026-01-01T00:00:00.000Z", 10));
    await store.put(entry("b", "2026-01-02T00:00:00.000Z", 10));
    await store.put(entry("c", now, 10));
    expect(await store.get("a")).toBeUndefined();
    expect(await store.get("b")).toBeDefined();
    expect(await store.get("c")).toBeDefined();
  });

  test("the byte budget evicts until the total fits", async () => {
    const root = path.join(scope().workspaceRoot, "budget-bytes");
    const store = new CacheStore({
      root,
      maxAgeDays: 365,
      maxEntries: 100,
      maxBytes: 25,
    });
    await store.put(entry("a", "2026-01-01T00:00:00.000Z", 10));
    await store.put(entry("b", "2026-01-02T00:00:00.000Z", 10));
    await store.put(entry("c", new Date().toISOString(), 10));
    expect(await store.get("a")).toBeUndefined();
    expect(await store.get("c")).toBeDefined();
  });

  test("a hit is recorded as one", async () => {
    const root = path.join(scope().workspaceRoot, "hit-counter");
    const store = new CacheStore({
      root,
      maxAgeDays: 365,
      maxEntries: 10,
      maxBytes: 1_000_000,
    });
    const first = entry("k", new Date().toISOString(), 10);
    await store.put(first);
    await store.refresh(
      (await store.get("k"))!,
      new Date("2026-09-21T10:00:00Z"),
    );
    const stored = await store.get("k");
    expect(stored?.hitCount).toBe(1);
    expect(stored?.accessedAt).toBe("2026-09-21T10:00:00.000Z");
  });
});
