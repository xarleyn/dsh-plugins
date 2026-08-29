/**
 * Local metadata repository (SPEC §39-§40).
 *
 * Layout below the metadata root (default `<$DSH_HOME>/cache/dsh-kv-persist`):
 *
 *   instances/<serverInstanceKey>/sessions/<snapshotDigest>.json
 *
 * Binary KV files never live here — they are owned by llama-server's
 * `--slot-save-path` (SPEC §17). All writes are atomic: temp file + rename
 * (SPEC §40), so a crash cannot leave half-written metadata that parses.
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KvMetadataIoError } from "../errors.js";
import type { SnapshotInvalidationReason } from "../errors.js";
import { parseManifest, createManifest } from "./manifest.js";
import type { SnapshotManifest } from "./manifest.js";
import { snapshotFilename } from "./naming.js";
import type { SnapshotIdentity } from "./fingerprint.js";

export interface RepositoryPutInput {
  readonly identity: SnapshotIdentity;
  readonly slotId: number;
  readonly sessionSeq: number | null;
  readonly tokens: number | null;
  readonly bytes: number | null;
  readonly now: string;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
  );
}

/** Manifest storage for one metadata root. */
export class SnapshotRepository {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  #sessionsDir(instanceKey: string): string {
    return join(this.root, "instances", instanceKey, "sessions");
  }

  #manifestPath(identity: SnapshotIdentity): string {
    const digest = snapshotFilename(identity).replace(/\.bin$/, "");
    return join(this.#sessionsDir(identity.serverInstanceKey), `${digest}.json`);
  }

  /** Load the manifest for an identity; null when none exists. */
  async load(identity: SnapshotIdentity): Promise<SnapshotManifest | null> {
    const path = this.#manifestPath(identity);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw new KvMetadataIoError(`cannot read manifest ${path}`, { cause: error });
    }
    try {
      return parseManifest(JSON.parse(text));
    } catch (error) {
      throw new KvMetadataIoError(`cannot parse manifest ${path}`, { cause: error });
    }
  }

  /** Create-or-update the manifest for an identity (atomic). */
  async put(input: RepositoryPutInput): Promise<SnapshotManifest> {
    const existing = await this.load(input.identity);
    const manifest: SnapshotManifest = existing
      ? {
          ...existing,
          updatedAt: input.now,
          slotId: input.slotId,
          sessionSeq: input.sessionSeq,
          tokens: input.tokens ?? existing.tokens,
          bytes: input.bytes ?? existing.bytes,
        }
      : {
          ...createManifest({
            identity: input.identity,
            slotId: input.slotId,
            snapshotFilename: snapshotFilename(input.identity),
            sessionSeq: input.sessionSeq,
            now: input.now,
          }),
          tokens: input.tokens,
          bytes: input.bytes,
        };
    await this.#write(manifest);
    return manifest;
  }

  /** Flip a manifest to invalid without deleting anything (SPEC §31). */
  async markInvalid(
    identity: SnapshotIdentity,
    reason: SnapshotInvalidationReason,
    now: string,
  ): Promise<void> {
    const existing = await this.load(identity);
    if (!existing || existing.state === "invalid") return;
    await this.#write({
      ...existing,
      state: "invalid",
      invalidReason: reason,
      updatedAt: now,
    });
  }

  /** Remove a manifest (purge, SPEC §11); binary cleanup is backend-owned. */
  async remove(identity: SnapshotIdentity): Promise<boolean> {
    const path = this.#manifestPath(identity);
    try {
      await rm(path, { force: false });
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw new KvMetadataIoError(`cannot remove manifest ${path}`, { cause: error });
    }
  }

  /** Flip every manifest of a session to invalid (SPEC §31). */
  async invalidateSession(
    sessionId: string,
    reason: SnapshotInvalidationReason,
    now: string,
  ): Promise<number> {
    let count = 0;
    for (const manifest of await this.#listSessionManifests(sessionId)) {
      if (manifest.state === "invalid") continue;
      await this.#write({
        ...manifest,
        state: "invalid",
        invalidReason: reason,
        updatedAt: now,
      });
      count += 1;
    }
    return count;
  }

  /** Remove every manifest of a session across routes and instances. */
  async removeSession(sessionId: string): Promise<number> {
    let count = 0;
    for (const manifest of await this.#listSessionManifests(sessionId)) {
      const identity: SnapshotIdentity = {
        sessionId: manifest.sessionId,
        provider: manifest.provider,
        model: manifest.model,
        backend: manifest.backend,
        serverInstanceKey: manifest.serverInstanceKey,
        compatibilityVersion: manifest.compatibilityVersion,
      };
      if (await this.remove(identity)) count += 1;
    }
    return count;
  }

  /** Every readable manifest of a session; unreadable entries are skipped. */
  async #listSessionManifests(sessionId: string): Promise<SnapshotManifest[]> {
    const result: SnapshotManifest[] = [];
    const instancesDir = join(this.root, "instances");
    let instanceKeys: string[];
    try {
      instanceKeys = await readdir(instancesDir);
    } catch (error) {
      if (isNotFoundError(error)) return result;
      throw new KvMetadataIoError(`cannot list ${instancesDir}`, { cause: error });
    }
    for (const instanceKey of instanceKeys) {
      const sessionsDir = join(instancesDir, instanceKey, "sessions");
      let files: string[];
      try {
        files = await readdir(sessionsDir);
      } catch (error) {
        if (isNotFoundError(error)) continue;
        throw new KvMetadataIoError(`cannot list ${sessionsDir}`, { cause: error });
      }
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const path = join(sessionsDir, file);
        try {
          const manifest = parseManifest(JSON.parse(await readFile(path, "utf8")));
          if (manifest.sessionId === sessionId) result.push(manifest);
        } catch {
          // Unreadable manifests are not session state; ignore here.
        }
      }
    }
    return result;
  }

  /**
   * Find a ready, runtime-compatible manifest for the identity; incompatible
   * manifests are marked invalid (SPEC §31) and ignored.
   */
  async findCompatible(identity: SnapshotIdentity): Promise<SnapshotManifest | null> {
    const manifest = await this.load(identity);
    if (!manifest) return null;
    const storedIdentity: SnapshotIdentity = {
      sessionId: manifest.sessionId,
      provider: manifest.provider,
      model: manifest.model,
      backend: manifest.backend,
      serverInstanceKey: manifest.serverInstanceKey,
      compatibilityVersion: manifest.compatibilityVersion,
    };
    const compatibleShape =
      storedIdentity.serverInstanceKey === identity.serverInstanceKey &&
      storedIdentity.provider === identity.provider &&
      storedIdentity.model === identity.model;
    if (!compatibleShape) return null;
    if (manifest.state !== "ready") return null;
    if (storedIdentity.compatibilityVersion !== identity.compatibilityVersion) {
      await this.markInvalid(identity, "MODEL_FINGERPRINT_CHANGED", new Date().toISOString());
      return null;
    }
    return manifest;
  }

  /** Aggregate manifest counts for the status API (SPEC §47). */
  async counts(): Promise<{ known: number; valid: number; invalid: number }> {
    const result = { known: 0, valid: 0, invalid: 0 };
    const instancesDir = join(this.root, "instances");
    let instanceKeys: string[];
    try {
      instanceKeys = await readdir(instancesDir);
    } catch (error) {
      if (isNotFoundError(error)) return result;
      throw new KvMetadataIoError(`cannot list ${instancesDir}`, { cause: error });
    }
    for (const instanceKey of instanceKeys) {
      const sessionsDir = join(instancesDir, instanceKey, "sessions");
      let files: string[];
      try {
        files = await readdir(sessionsDir);
      } catch (error) {
        if (isNotFoundError(error)) continue;
        throw new KvMetadataIoError(`cannot list ${sessionsDir}`, { cause: error });
      }
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        result.known += 1;
        try {
          const text = await readFile(join(sessionsDir, file), "utf8");
          const manifest = parseManifest(JSON.parse(text));
          if (manifest.state === "ready") result.valid += 1;
          else result.invalid += 1;
        } catch {
          result.invalid += 1;
        }
      }
    }
    return result;
  }

  async #write(manifest: SnapshotManifest): Promise<void> {
    const identity: SnapshotIdentity = {
      sessionId: manifest.sessionId,
      provider: manifest.provider,
      model: manifest.model,
      backend: manifest.backend,
      serverInstanceKey: manifest.serverInstanceKey,
      compatibilityVersion: manifest.compatibilityVersion,
    };
    const path = this.#manifestPath(identity);
    const tmpPath = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(tmpPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await rename(tmpPath, path);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => {});
      throw new KvMetadataIoError(`cannot write manifest ${path}`, { cause: error });
    }
  }
}

