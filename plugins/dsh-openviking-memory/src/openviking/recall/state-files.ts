/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
//
// The on-disk memos one recall turn leaves behind: where a deployment is
// remembered as lacking a server capability. One reason to change — the state
// layout — and nothing to do with what is asked of the memory backend.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { StateRecord } from "./types.js";

const LEGACY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export function stateFile(name: string): string {
  const override = String(process.env.OPENVIKING_STATE_DIR || "").trim();
  return override
    ? join(override, name)
    : join(homedir(), ".openviking", "state", name);
}

async function readJsonFile(path: string): Promise<StateRecord | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as StateRecord;
  } catch {
    return null;
  }
}

async function writeJsonFile(
  path: string,
  value: Record<string, unknown>,
): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, path);
  } catch {
    /* best effort */
  }
}

/**
 * Hooks are one-shot processes, so "this server has no context face" has to be
 * remembered on disk or every turn pays for a rejected request.
 */
export async function isContextFaceLegacy(
  path: string = stateFile("context-face.json"),
  now: number = Date.now(),
): Promise<boolean> {
  const cached = await readJsonFile(path);
  return Boolean(cached?.legacyUntil && Number(cached.legacyUntil) > now);
}

export async function markContextFaceLegacy(
  path: string = stateFile("context-face.json"),
  now: number = Date.now(),
): Promise<void> {
  await writeJsonFile(path, { legacyUntil: now + LEGACY_CACHE_TTL_MS });
}

/**
 * A `peer_scope` the server rejects is remembered the same way, but unlike the
 * context face this one is not a silent capability probe: dropping the field
 * widens recall from the caller's own peer to the whole user root, so doctor
 * reads this file back and warns.
 */
export function peerScopeMemoPath(): string {
  return stateFile("peer-scope.json");
}

export async function readPeerScopeDowngrade(
  path: string = peerScopeMemoPath(),
  now: number = Date.now(),
): Promise<StateRecord | null> {
  const cached = await readJsonFile(path);
  if (!cached?.legacyUntil || Number(cached.legacyUntil) <= now) return null;
  return cached;
}

export async function markPeerScopeDowngrade(
  scope: unknown,
  status: unknown,
  path: string = peerScopeMemoPath(),
  now: number = Date.now(),
): Promise<void> {
  await writeJsonFile(path, {
    legacyUntil: now + LEGACY_CACHE_TTL_MS,
    scope: String(scope || ""),
    status: Number(status) || 0,
    at: now,
  });
}
