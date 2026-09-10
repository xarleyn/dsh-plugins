/**
 * Shared test fixtures: temporary store roots, fake clocks, and prebuilt
 * payload constants used across the unit and integration suites.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FilesystemCasStore } from "../../src/cas/filesystem-store.js";
import type { CompressionMode } from "../../src/cas/compression.js";
import { silentPluginLogger } from "../../src/logging.js";
import { CasCounters } from "../../src/observability/counters.js";
import type { ResolvedCasResultsConfig } from "../../src/config.js";
import { resolveCasResultsConfig } from "../../src/config.js";

const roots: string[] = [];

/** Create a unique temporary directory, removed automatically after the run. */
export async function tempRoot(prefix = "dsh-cas-results-test-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

export async function cleanupTempRoots(): Promise<void> {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
}

export function buildStore(root: string, compression: CompressionMode = "none"): FilesystemCasStore {
  let tick = 0;
  return new FilesystemCasStore(root, {
    compression,
    now: () => new Date(1_700_000_000_000 + (tick += 1) * 1_000),
  });
}

/** A deterministic fake payload of the requested byte size. */
export function makeText(bytes: number, seed = "line"): string {
  const lines: string[] = [];
  let written = 0;
  let index = 0;
  while (written < bytes) {
    const line = `${seed}-${String(index).padStart(6, "0")} ${"x".repeat(40)}`;
    lines.push(line);
    written += line.length + 1;
    index += 1;
  }
  return lines.join("\n");
}

export function makeLog(bytes: number): string {
  const lines: string[] = [];
  let written = 0;
  let index = 0;
  while (written < bytes) {
    const level = index % 25 === 0 ? "ERROR" : index % 17 === 0 ? "WARN" : "INFO";
    const line = `2026-08-30T18:42:0${index % 10}.000Z ${level} worker ${index}: doing work ${"y".repeat(30)}`;
    lines.push(line);
    written += line.length + 1;
    index += 1;
  }
  return lines.join("\n");
}

/** 1x1 transparent PNG (67 bytes) for base64/binary suites. */
export const TINY_PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export function testConfig(overrides: Partial<ResolvedCasResultsConfig> = {}): ResolvedCasResultsConfig {
  return { ...resolveCasResultsConfig({}), ...overrides };
}

export function newCounters(): CasCounters {
  return new CasCounters();
}

export { silentPluginLogger };
