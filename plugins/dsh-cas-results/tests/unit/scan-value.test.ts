/** Unit tests for the recursive value scanner (SPEC §12, §27, AC1). */

import { afterEach, describe, expect, it } from "vitest";

import { transformValue, type TransformPolicy } from "../../src/transform/scan-value.js";
import { isCasMarkerText } from "../../src/transform/marker.js";
import { buildStore, cleanupTempRoots, makeText, tempRoot, TINY_PNG_BYTES } from "../fixtures/store-fixtures.js";
import { parseCasRef } from "../../src/cas/hash.js";

const encoder = new TextEncoder();

afterEach(async () => {
  await cleanupTempRoots();
});

function policy(overrides: Partial<TransformPolicy> = {}): TransformPolicy {
  return {
    toolName: "bash",
    thresholds: { textBytes: 1_024, htmlBytes: 512, logBytes: 1_024 },
    base64: { enabled: true, minChars: 128, requireStrongDetection: true },
    preview: { maxChars: 512, keepHeadLines: 5, keepTailLines: 5, keepPatterns: ["error"] },
    previewStyle: "auto",
    ...overrides,
  };
}

describe("transformValue", () => {
  it("offloads an oversized nested string and preserves the value shape", async () => {
    const store = buildStore(await tempRoot());
    const stdout = makeText(4_096);
    const value = { stdout, stderr: "clean", code: 0 };
    const outcome = await transformValue(value, policy(), store, "bash");

    expect(outcome.changed).toBe(true);
    expect(outcome.objectsStored).toBe(1);
    const next = outcome.value as { stdout: string; stderr: string; code: number };
    expect(next.stderr).toBe("clean");
    expect(next.code).toBe(0);
    expect(next.stdout).not.toBe(stdout);
    expect(isCasMarkerText(next.stdout)).toBe(true);
    expect(next.stdout).toContain("dsh_cas_retrieve");
    // The full original lives in the store.
    const hash = /sha256:([a-f0-9]{64})/.exec(next.stdout)?.[1] ?? "";
    const read = await store.read(hash);
    expect(Buffer.from(read.bytes).equals(encoder.encode(stdout))).toBe(true);
  });

  it("leaves small values byte-identical (SPEC §12)", async () => {
    const store = buildStore(await tempRoot());
    const value = { stdout: "tiny", nested: { list: ["a", "b"], flag: true, none: null, num: 1.5 } };
    const outcome = await transformValue(value, policy(), store, "bash");
    expect(outcome.changed).toBe(false);
    expect(outcome.value).toBe(value);
  });

  it("offloads multiple large fields as independent CAS objects", async () => {
    const store = buildStore(await tempRoot());
    const value = { stdout: makeText(4_096), response: { html: `<html><body>${makeText(4_096)}</body></html>` } };
    const outcome = await transformValue(value, policy(), store, "bash");
    expect(outcome.replacements).toHaveLength(2);
    const refs = outcome.replacements.map((replacement) => replacement.ref);
    expect(new Set(refs).size).toBe(2);
    const stats = await store.stats();
    expect(stats.objects).toBe(2);
  });

  it("classifies HTML with the lower htmlBytes threshold", async () => {
    const store = buildStore(await tempRoot());
    const html = `<html><body>${makeText(800, "h")}</body></html>`;
    const outcome = await transformValue({ html }, policy(), store, "web_fetch");
    expect(outcome.changed).toBe(true);
    expect(outcome.replacements[0]?.kind).toBe("html");
    expect(outcome.replacements[0]?.previewText).toContain("text/html");
  });

  it("decodes equivalent base64 representations of one PNG into a single binary object (SPEC AC5)", async () => {
    const store = buildStore(await tempRoot());
    const raw = Buffer.from(TINY_PNG_BYTES).toString("base64");
    const padded = raw + "====".slice(0, (4 - (raw.length % 4)) % 4);
    const dataUri = `data:image/png;base64,${raw}`;
    const first = await transformValue({ image: raw }, policy({ base64: { enabled: true, minChars: 64, requireStrongDetection: true } }), store, "screenshot");
    const second = await transformValue({ image: padded }, policy({ base64: { enabled: true, minChars: 64, requireStrongDetection: true } }), store, "screenshot");
    const third = await transformValue({ image: dataUri }, policy({ base64: { enabled: true, minChars: 64, requireStrongDetection: true } }), store, "screenshot");
    expect(first.changed && second.changed && third.changed).toBe(true);
    const refs = [first, second, third].map((outcome) => outcome.replacements[0]?.ref);
    expect(new Set(refs).size).toBe(1);
    expect(first.replacements[0]?.kind).toBe("binary");
    const read = await store.read(parseCasRef(refs[0] as string));
    expect(Buffer.from(read.bytes).equals(Buffer.from(TINY_PNG_BYTES))).toBe(true);
  });

  it("skips its own markers to stay idempotent (SPEC §21, AC9)", async () => {
    const store = buildStore(await tempRoot());
    const marker = "[dsh-cas-results: 20480B log → 512B preview; sha256=" + "a".repeat(64) + "; use dsh_cas_retrieve]";
    const outcome = await transformValue({ out: marker }, policy(), store, "bash");
    expect(outcome.changed).toBe(false);
    expect(outcome.value).toEqual({ out: marker });
  });

  it("keeps Unicode, CRLF and NUL-containing payloads exact (SPEC §31)", async () => {
    const store = buildStore(await tempRoot());
    const weird = `unicode ✓ 中文 🚀\r\ncrlf\r\nnul\u0000inside${makeText(2_048)}`;
    const outcome = await transformValue({ data: weird }, policy(), store, "bash");
    const hash = /sha256:([a-f0-9]{64})/.exec(outcome.replacements[0]?.previewText ?? "")?.[1] ?? "";
    const read = await store.read(hash);
    expect(Buffer.from(read.bytes).equals(encoder.encode(weird))).toBe(true);
  });

  it("honors per-tool preview style overrides", async () => {
    const store = buildStore(await tempRoot());
    const value = { out: makeLogText(4_096) };
    const forced = await transformValue(value, policy({ previewStyle: "text" }), store, "bash");
    expect(forced.replacements[0]?.kind).toBe("text");
  });
});

function makeLogText(bytes: number): string {
  const lines: string[] = [];
  let written = 0;
  let index = 0;
  while (written < bytes) {
    const line = `2026-08-30T18:00:00.000Z ${index % 10 === 0 ? "ERROR" : "INFO"} entry ${index}`;
    lines.push(line);
    written += line.length + 1;
    index += 1;
  }
  return lines.join("\n");
}
