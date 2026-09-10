/**
 * Recursive result-value scanner and offloader (SPEC §12, §27).
 *
 * The scanner traverses JSON-like canonical tool values, finds string fields
 * over their candidate threshold (or confident base64 payloads), stores the
 * payload in the CAS and replaces the string with a bounded deterministic
 * preview that keeps the value's shape. Existing CAS markers are detected and
 * never re-processed.
 *
 * The critical sequence is: store first, build preview second, replace last
 * (SPEC §30 Phase 2). Any thrown storage error propagates to the integration
 * boundary, which fails open with the original result.
 */

import { Buffer } from "node:buffer";

import type { CasKind, CasStore } from "../cas/types.js";
import { buildPreviewBody } from "../preview/index.js";
import type { PreviewOptions } from "../preview/options.js";
import { classifyText } from "./classify.js";
import { decodeBase64Candidate, type Base64DetectionOptions } from "./base64.js";
import { buildBinaryMarker, formatMarkerHeader, formatRetrieveHint, isCasMarkerText } from "./marker.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | readonly JsonValue[];

export type PreviewStyle = "auto" | "text" | "log" | "html";

export interface TransformPolicy {
  readonly toolName: string;
  readonly thresholds: { textBytes: number; htmlBytes: number; logBytes: number };
  readonly base64: Base64DetectionOptions;
  readonly preview: PreviewOptions;
  readonly previewStyle: PreviewStyle;
}

export interface ValueReplacement {
  readonly path: string;
  readonly ref: string;
  readonly kind: CasKind;
  readonly originalBytes: number;
  readonly reused: boolean;
  readonly previewText: string;
}

export interface TransformOutcome {
  readonly changed: boolean;
  readonly value: JsonValue;
  readonly replacements: readonly ValueReplacement[];
  readonly stringsScanned: number;
  readonly objectsStored: number;
  readonly casHits: number;
  readonly physicalBytesWritten: number;
  readonly logicalBytesOffloaded: number;
}

const MAX_DEPTH = 32;
const MAX_STRINGS_SCANNED = 4096;
const MAX_REPLACEMENTS = 64;

export async function transformValue(
  value: JsonValue,
  policy: TransformPolicy,
  store: CasStore,
  firstTool: string | undefined,
): Promise<TransformOutcome> {
  const context: {
    stringsScanned: number;
    replacements: ValueReplacement[];
    objectsStored: number;
    casHits: number;
    physicalBytesWritten: number;
    logicalBytesOffloaded: number;
  } = {
    stringsScanned: 0,
    replacements: [],
    objectsStored: 0,
    casHits: 0,
    physicalBytesWritten: 0,
    logicalBytesOffloaded: 0,
  };

  const transformed = await walk(value, policy, store, firstTool, context, 0, "$");
  return {
    changed: context.replacements.length > 0,
    value: transformed,
    replacements: context.replacements,
    stringsScanned: context.stringsScanned,
    objectsStored: context.objectsStored,
    casHits: context.casHits,
    physicalBytesWritten: context.physicalBytesWritten,
    logicalBytesOffloaded: context.logicalBytesOffloaded,
  };
}

async function walk(
  value: JsonValue,
  policy: TransformPolicy,
  store: CasStore,
  firstTool: string | undefined,
  context: { stringsScanned: number; replacements: ValueReplacement[]; objectsStored: number; casHits: number; physicalBytesWritten: number; logicalBytesOffloaded: number },
  depth: number,
  path: string,
): Promise<JsonValue> {
  if (typeof value === "string") {
    context.stringsScanned += 1;
    if (context.stringsScanned > MAX_STRINGS_SCANNED || isCasMarkerText(value)) return value;
    const replacement = await offloadString(value, policy, store, firstTool, context, path);
    return replacement ?? value;
  }
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const next: JsonValue[] = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      next[index] = await walk(value[index] as JsonValue, policy, store, firstTool, context, depth + 1, `${path}[${index}]`);
      if (next[index] !== value[index]) changed = true;
    }
    return changed ? next : value;
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const next: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = await walk(child as JsonValue, policy, store, firstTool, context, depth + 1, `${path}.${key}`);
      if (next[key] !== child) changed = true;
    }
    return changed ? next : value;
  }
  return value;
}

async function offloadString(
  value: string,
  policy: TransformPolicy,
  store: CasStore,
  firstTool: string | undefined,
  context: { replacements: ValueReplacement[]; objectsStored: number; casHits: number; physicalBytesWritten: number; logicalBytesOffloaded: number },
  path: string,
): Promise<string | null> {
  if (context.replacements.length >= MAX_REPLACEMENTS) return null;

  // Binary/base64 payloads (SPEC §11) take precedence over text handling.
  const binary = decodeBase64Candidate(value, policy.base64);
  if (binary !== null) {
    const object = await store.put({
      payload: binary.bytes,
      kind: "binary",
      mediaType: binary.mediaType,
      encoding: "binary",
      firstTool,
    });
    const previewText = buildBinaryMarker({
      sizeBytes: binary.bytes.length,
      kind: "binary",
      mediaType: binary.mediaType,
      ref: object.ref,
    });
    recordReplacement(context, {
      path,
      ref: object.ref,
      kind: "binary",
      originalBytes: binary.bytes.length,
      reused: object.reused,
      previewText,
    });
    return previewText;
  }

  const byteLength = Buffer.byteLength(value, "utf8");
  const classified = classifyText(value);
  const kind: Exclude<CasKind, "binary"> = policy.previewStyle === "auto" ? classified.kind : policy.previewStyle;
  const threshold =
    kind === "html" ? policy.thresholds.htmlBytes
    : kind === "log" ? policy.thresholds.logBytes
    : policy.thresholds.textBytes;
  if (byteLength < threshold) return null;

  const payload = Buffer.from(value, "utf8");
  const object = await store.put({
    payload,
    kind,
    mediaType: kind === "html" ? "text/html" : kind === "log" ? "text/log" : "text/plain",
    encoding: "utf8",
    firstTool,
  });
  const previewText = buildTextPreview(value, kind, byteLength, object.ref, policy.preview);
  recordReplacement(context, {
    path,
    ref: object.ref,
    kind,
    originalBytes: byteLength,
    reused: object.reused,
    previewText,
  });
  return previewText;
}

function buildTextPreview(
  value: string,
  kind: Exclude<CasKind, "binary">,
  sizeBytes: number,
  ref: string,
  options: PreviewOptions,
): string {
  const body = buildPreviewBody(kind, value, options);
  const header = formatMarkerHeader({
    sizeBytes,
    previewBytes: Buffer.byteLength(body, "utf8"),
    kind,
    mediaType: kind === "html" ? "text/html" : kind === "log" ? "text/log" : "text/plain",
    ref,
  });
  return `${header}\n\n${body}\n\n${formatRetrieveHint(ref)}`;
}

function recordReplacement(
  context: { replacements: ValueReplacement[]; objectsStored: number; casHits: number; physicalBytesWritten: number; logicalBytesOffloaded: number },
  replacement: ValueReplacement,
): void {
  context.replacements.push(replacement);
  context.logicalBytesOffloaded += replacement.originalBytes;
  if (replacement.reused) {
    context.casHits += 1;
  } else {
    context.objectsStored += 1;
    // Physical size equals the logical payload until the store reports the
    // committed representation; the caller reconciles via store stats.
    context.physicalBytesWritten += replacement.originalBytes;
  }
}
