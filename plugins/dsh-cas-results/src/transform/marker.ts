/**
 * Deterministic model-facing markers for offloaded results (SPEC §18-§19).
 *
 * Markers are cheap, LLM-independent and deterministic. The complete SHA-256
 * always appears in the marker and in the retrieval hint; nothing in the
 * marker depends on locale or clock.
 */

import type { CasKind } from "../cas/types.js";

export const CAS_MARKER_PREFIX = "[dsh-cas-results:";

export function isCasMarkerText(value: string): boolean {
  return value.startsWith(CAS_MARKER_PREFIX) || value.startsWith("[dsh-cas-results]");
}

/** Fixed-precision byte formatting; deterministic across sessions. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = "B";
  for (const candidate of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = candidate;
  }
  return `${roundToOne(value)} ${unit}`;
}

function roundToOne(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

export interface MarkerHeaderInput {
  readonly sizeBytes: number;
  readonly previewBytes: number;
  readonly kind: CasKind;
  readonly mediaType: string;
  readonly ref: string;
}

/** Compact single-line marker as recommended by SPEC §19. */
export function formatMarkerHeader(input: MarkerHeaderInput): string {
  const hash = input.ref.replace(/^sha256:/, "");
  if (input.kind === "binary") {
    return `${CAS_MARKER_PREFIX} binary payload offloaded; ${input.sizeBytes}B decoded; sha256=${hash}; use dsh_cas_retrieve]\ntype: ${input.mediaType}`;
  }
  return `${CAS_MARKER_PREFIX} ${input.sizeBytes}B ${input.kind} → ${input.previewBytes}B preview; sha256=${hash}; use dsh_cas_retrieve]\ntype: ${input.mediaType}`;
}

/** Explicit retrieval hint appended to every marker (SPEC §19). */
export function formatRetrieveHint(ref: string): string {
  return `Full content:\ndsh_cas_retrieve(ref="${ref}")`;
}

/** Marker-only representation used for binary payloads (SPEC §18). */
export function buildBinaryMarker(input: Omit<MarkerHeaderInput, "previewBytes">): string {
  const header = formatMarkerHeader({ ...input, previewBytes: 0 });
  return `${header}\n${formatRetrieveHint(input.ref)}`;
}

/** Human-readable offload summary used by logs and stats messages. */
export function formatOffloadSummary(sizeBytes: number, previewBytes: number): string {
  return `${formatBytes(sizeBytes)} → ${formatBytes(previewBytes)} preview`;
}
