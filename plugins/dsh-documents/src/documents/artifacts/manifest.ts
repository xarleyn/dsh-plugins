/**
 * Manifest construction and persistence (§19).
 *
 * The manifest is the source of truth about an artifact: which operation,
 * which backends and versions, which template (and its hash), which files came
 * out, which warnings were raised, and which session/workspace the bundle
 * belongs to. Logical reproducibility rests on it, because byte-level
 * reproducibility of DOCX/PDF cannot be promised (§31).
 */

import path from "node:path";

import { DocumentError, asDocumentError } from "../errors.js";
import type {
  BackendInfo,
  DocumentCacheRecord,
  DocumentFileResult,
  DocumentFormat,
  DocumentManifest,
  DocumentWarning,
} from "../types.js";
import type { ArtifactStore } from "./store.js";

export const MANIFEST_FILE = "manifest.json";
export const MANIFEST_SCHEMA_VERSION = 1 as const;

export interface BuildManifestInput {
  readonly artifactId: string;
  readonly operation: DocumentManifest["operation"];
  readonly createdAt: string;
  readonly input: DocumentManifest["input"];
  readonly outputs: DocumentManifest["outputs"];
  readonly template?: string;
  readonly templateSha256?: string;
  readonly backends: Readonly<Record<string, BackendInfo>>;
  readonly warnings: readonly DocumentWarning[];
  readonly scope: DocumentManifest["scope"];
  /** Set when the outputs were materialized from a cache entry. */
  readonly cache?: DocumentCacheRecord;
}

export function buildManifest(input: BuildManifestInput): DocumentManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    artifactId: input.artifactId,
    operation: input.operation,
    createdAt: input.createdAt,
    input: input.input,
    outputs: input.outputs,
    ...(input.template === undefined ? {} : { template: input.template }),
    ...(input.templateSha256 === undefined
      ? {}
      : { templateSha256: input.templateSha256 }),
    backends: input.backends,
    warnings: input.warnings,
    scope: input.scope,
    ...(input.cache === undefined ? {} : { cache: input.cache }),
  };
}

export async function writeManifest(
  store: ArtifactStore,
  artifactId: string,
  manifest: DocumentManifest,
): Promise<string> {
  const written = await store.write(
    path.join(artifactId, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return written.path;
}

export async function readManifest(
  store: ArtifactStore,
  artifactId: string,
): Promise<DocumentManifest> {
  const raw = await store
    .read(path.join(artifactId, MANIFEST_FILE))
    .catch((error: unknown) => {
      throw asDocumentError(error, "FILE_NOT_FOUND", "artifact store");
    });
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as DocumentManifest;
    if (parsed.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
      throw new Error(
        `unsupported manifest schema ${String(parsed.schemaVersion)}`,
      );
    }
    return parsed;
  } catch (error) {
    throw new DocumentError(
      "INVALID_INPUT",
      `the artifact manifest of ${artifactId} is unreadable`,
      { cause: error },
    );
  }
}

/** Project a tool-level file result onto the manifest's output record. */
export function outputRecord(
  file: DocumentFileResult,
): DocumentManifest["outputs"][number] {
  return {
    format: file.format,
    path: path.basename(file.path),
    sha256: file.sha256,
    size: file.size,
    status: file.status,
    ...(file.error === undefined ? {} : { error: file.error }),
  };
}

export function formatOfOperation(
  operation: DocumentManifest["operation"],
): DocumentFormat | "unknown" {
  return operation === "document_create" ? "md" : "unknown";
}
