/**
 * The offline pending queue, driven directly against a fresh directory.
 *
 * `src/openviking/pending-queue.ts` is a self-contained module whose location
 * and bounds all come from the environment, so nothing here goes through the
 * runtime: the ordering, claim and retry rules are observable on disk, and the
 * replay rules are observable through the injected `fetchJSON`.
 *
 * Timestamps are fixed offsets from one base so ordering assertions never race
 * the wall clock, while still staying inside the default seven-day TTL that
 * `replayPending`'s closing `cleanStale()` enforces.
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach } from "vitest";

import { type PendingEntry } from "../src/openviking/pending-queue.js";

/** Ordering base: far enough in the past to be explicit, far inside the TTL. */
export const BASE = Date.now() - 60_000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const ENV_KEYS = [
  "OPENVIKING_PENDING_DIR",
  "OPENVIKING_PENDING_MAX_RETRIES",
  "OPENVIKING_PENDING_TTL_DAYS",
  "OPENVIKING_PENDING_REPLAY_LIMIT",
] as const;

export const savedEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

export let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ov-pending-"));
  process.env.OPENVIKING_PENDING_DIR = dir;
  delete process.env.OPENVIKING_PENDING_MAX_RETRIES;
  delete process.env.OPENVIKING_PENDING_TTL_DAYS;
  delete process.env.OPENVIKING_PENDING_REPLAY_LIMIT;
});

afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dir, { recursive: true, force: true });
  dir = "";
});

/** Queue files as they are listed on disk (claimed `.processing` ones excluded). */
export async function queueFiles(): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith(".json"));
}

export async function readEntry(filename: string): Promise<PendingEntry> {
  return JSON.parse(
    await readFile(join(dir, filename), "utf-8"),
  ) as PendingEntry;
}
