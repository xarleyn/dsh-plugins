/**
 * Artifact bundle storage (§18, §47).
 *
 * One directory per operation:
 *
 * ```text
 * <root>/<artifact-id>/
 *   manifest.json
 *   source.md
 *   input/original.pdf
 *   assets/
 *   output.docx
 *   extracted.md
 * ```
 *
 * Everything the store writes goes through a root-relative path that is
 * validated first, and every file lands atomically (temp file + rename) so a
 * crashed host never leaves a half-written artifact that a later read would
 * trust. Job temp directories live under `<root>/.tmp` and are removed on both
 * success and failure (§47).
 */

import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { DocumentError, asDocumentError } from "../errors.js";
import { assertInsideRoot } from "../security/paths.js";
import { createArtifactId, isArtifactId } from "./ids.js";

export interface FileFingerprint {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function sha256OfFile(filePath: string): Promise<string> {
  return sha256Hex(await readFile(filePath));
}

export interface ArtifactStoreOptions {
  /** Directory the bundles live in; created on demand. */
  readonly root: string;
}

export class ArtifactStore {
  readonly root: string;

  constructor(options: ArtifactStoreOptions) {
    this.root = path.resolve(options.root);
  }

  /** Absolute path of a root-relative artifact member, containment checked. */
  path(relativePath: string): string {
    return assertInsideRoot(
      this.root,
      path.resolve(this.root, relativePath),
      "artifact path",
    );
  }

  artifactDir(artifactId: string): string {
    if (!isArtifactId(artifactId)) {
      throw new DocumentError(
        "INVALID_INPUT",
        `"${artifactId}" is not an artifact id`,
      );
    }
    return this.path(artifactId);
  }

  /** Prepare a fresh bundle directory and return its id. */
  async create(
    now: number = Date.now(),
  ): Promise<{ artifactId: string; dir: string }> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const artifactId = createArtifactId(now);
      const dir = this.artifactDir(artifactId);
      try {
        await mkdir(dir, { recursive: false });
        return { artifactId, dir };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw asDocumentError(error, "ARTIFACT_WRITE_FAILED");
        }
      }
    }
    throw new DocumentError(
      "ARTIFACT_WRITE_FAILED",
      "unable to allocate an artifact directory",
    );
  }

  async ensureDir(relativePath: string): Promise<string> {
    const target = this.path(relativePath);
    await mkdir(target, { recursive: true });
    return target;
  }

  /** Atomically write a root-relative member. */
  async write(
    relativePath: string,
    data: string | Buffer,
  ): Promise<FileFingerprint> {
    const target = this.path(relativePath);
    const payload = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const temp = `${target}.tmp-${randomBytes(6).toString("hex")}`;
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(temp, payload);
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw asDocumentError(error, "ARTIFACT_WRITE_FAILED");
    }
    return { path: target, size: payload.length, sha256: sha256Hex(payload) };
  }

  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.path(relativePath));
  }

  async fingerprint(relativePath: string): Promise<FileFingerprint> {
    const target = this.path(relativePath);
    const details = await stat(target);
    return {
      path: target,
      size: details.size,
      sha256: await sha256OfFile(target),
    };
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await stat(this.path(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  /** Job-scoped temp directory: never an artifact, always removed (§47). */
  async createWorkDir(jobId: string): Promise<string> {
    const dir = this.path(path.join(".tmp", jobId));
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async removeWorkDir(dir: string): Promise<void> {
    if (!path.resolve(dir).startsWith(this.path(".tmp"))) return;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  /** Bundle directories, newest first, with their modification time. */
  async list(): Promise<
    { artifactId: string; dir: string; modifiedAt: Date }[]
  > {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch {
      return [];
    }
    const artifacts: { artifactId: string; dir: string; modifiedAt: Date }[] =
      [];
    for (const name of names) {
      if (!isArtifactId(name)) continue;
      const dir = this.path(name);
      try {
        const details = await stat(dir);
        if (!details.isDirectory()) continue;
        artifacts.push({ artifactId: name, dir, modifiedAt: details.mtime });
      } catch {
        continue;
      }
    }
    return artifacts.sort((left, right) =>
      left.modifiedAt < right.modifiedAt ? 1 : -1,
    );
  }

  /** Retention sweep (§41): drop bundles older than `maxAgeDays`. */
  async cleanup(options: {
    readonly maxAgeDays: number;
    readonly now?: Date;
  }): Promise<{ removed: string[] }> {
    const cutoff =
      (options.now ?? new Date()).getTime() - options.maxAgeDays * 86_400_000;
    const removed: string[] = [];
    for (const artifact of await this.list()) {
      if (artifact.modifiedAt.getTime() >= cutoff) continue;
      await rm(artifact.dir, { recursive: true, force: true }).catch(
        () => undefined,
      );
      removed.push(artifact.artifactId);
    }
    const tempRoot = this.path(".tmp");
    const tempNames = await readdir(tempRoot).catch(() => [] as string[]);
    for (const name of tempNames) {
      const dir = path.join(tempRoot, name);
      const details = await stat(dir).catch(() => undefined);
      if (details === undefined || details.mtime.getTime() >= cutoff) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    return { removed };
  }
}
