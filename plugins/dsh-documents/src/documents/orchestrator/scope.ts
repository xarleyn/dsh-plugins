/**
 * Job scope: where an operation reads from and writes to.
 *
 * Artifacts live in the session workspace by default
 * (`<cwd>/.qa/artifacts/documents/<artifact-id>`), which is what makes a QA
 * deployment's per-user workspaces isolate document bundles for free (§40).
 * A deployment may pin `documents.storage.root` to a shared volume instead, in
 * which case the session workspace stays the only place inputs are read from.
 * Inputs may additionally come from explicitly configured roots (§26.2).
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { ArtifactStore } from "../artifacts/store.js";
import type { ResolvedDocumentsConfig } from "../config.js";
import { DocumentError, asDocumentError } from "../errors.js";
import { assertBytesWithinBudget } from "../security/limits.js";
import {
  canonicalizeForContainment,
  isInsideRoot,
  resolveInsideRoot,
} from "../security/paths.js";
import {
  loadTemplateRegistry,
  type TemplateRegistry,
} from "../templates/registry.js";

/** What the caller (a tool) knows about the session. */
export interface DocumentScope {
  readonly workspaceRoot: string;
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
}

export interface ResolvedDocumentScope {
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
  readonly store: ArtifactStore;
  readonly templates: TemplateRegistry;
}

/** Artifact root of one workspace: configured root, else the workspace itself. */
export function defaultArtifactRoot(
  config: ResolvedDocumentsConfig,
  workspaceRoot: string,
): string {
  return (
    config.storage.root ??
    path.join(workspaceRoot, ".qa", "artifacts", "documents")
  );
}

async function probeManifest(candidate: string): Promise<boolean> {
  const details = await stat(path.join(candidate, "manifest.yml")).catch(
    () => undefined,
  );
  return details?.isFile() === true;
}

/**
 * Template roots to probe, in order. An explicitly configured root is
 * authoritative; a deployment that configures none gets the two conventional
 * workspace directories.
 */
export function templateCandidateRoots(
  config: ResolvedDocumentsConfig,
  workspaceRoot: string,
): string[] {
  if (config.templates.root !== null) return [config.templates.root];
  return [
    path.join(workspaceRoot, "document-templates"),
    path.join(workspaceRoot, "templates"),
  ];
}

/** Load the first candidate root that carries a registry manifest. */
export async function loadScopeTemplates(
  config: ResolvedDocumentsConfig,
  workspaceRoot: string,
): Promise<TemplateRegistry> {
  for (const candidate of templateCandidateRoots(config, workspaceRoot)) {
    if (await probeManifest(candidate))
      return await loadTemplateRegistry(candidate);
  }
  return await loadTemplateRegistry(undefined);
}

export async function resolveDocumentScope(
  config: ResolvedDocumentsConfig,
  scope: DocumentScope,
): Promise<ResolvedDocumentScope> {
  if (
    typeof scope.workspaceRoot !== "string" ||
    scope.workspaceRoot.trim() === ""
  ) {
    // Fail closed: an empty root would silently resolve to the host process's
    // working directory and grant artifacts access to it.
    throw new DocumentError(
      "INVALID_INPUT",
      "the document scope requires a session working directory",
    );
  }
  const workspaceRoot = await canonicalizeForContainment(scope.workspaceRoot);
  const artifactRoot = await canonicalizeForContainment(
    defaultArtifactRoot(config, workspaceRoot),
  );
  return {
    workspaceRoot,
    artifactRoot,
    ...(scope.sessionId === undefined ? {} : { sessionId: scope.sessionId }),
    ...(scope.signal === undefined ? {} : { signal: scope.signal }),
    store: new ArtifactStore({ root: artifactRoot }),
    templates: await loadScopeTemplates(config, workspaceRoot),
  };
}

/** Roots an input file may be read from, most specific first. */
export function allowedInputRoots(
  config: ResolvedDocumentsConfig,
  scope: ResolvedDocumentScope,
): string[] {
  return [
    scope.workspaceRoot,
    scope.artifactRoot,
    ...config.storage.allowedInputRoots,
  ];
}

/**
 * Resolve a caller-supplied input path. The file must exist inside one of the
 * allowed roots — traversal, symlinks out of the root and absolute paths to
 * unrelated directories are all refused (§26.2).
 */
export async function resolveInputPath(
  config: ResolvedDocumentsConfig,
  scope: ResolvedDocumentScope,
  requested: string,
  label: string,
): Promise<string> {
  let lastError: unknown;
  for (const root of allowedInputRoots(config, scope)) {
    try {
      const resolved = await resolveInsideRoot(root, requested, label);
      const details = await stat(resolved).catch(() => undefined);
      if (details === undefined || !details.isFile()) {
        throw new DocumentError("FILE_NOT_FOUND", `${label} does not exist`);
      }
      return resolved;
    } catch (error) {
      lastError = error;
      if (error instanceof DocumentError && error.code === "FILE_NOT_FOUND")
        continue;
      if (error instanceof DocumentError && error.code === "PATH_NOT_ALLOWED")
        continue;
      throw error;
    }
  }
  if (lastError instanceof DocumentError) {
    throw new DocumentError(
      "FILE_NOT_FOUND",
      `${label} is not a file inside the session workspace or a configured document root`,
      { details: { label } },
    );
  }
  throw asDocumentError(lastError, "FILE_NOT_FOUND");
}

/** Read an input file under a byte budget. */
export async function readInputBytes(
  filePath: string,
  config: ResolvedDocumentsConfig,
  label: string,
): Promise<Buffer> {
  const details = await stat(filePath).catch(() => undefined);
  if (details === undefined) {
    throw new DocumentError("FILE_NOT_FOUND", `${label} does not exist`);
  }
  assertBytesWithinBudget(details.size, config.limits.maxInputBytes, label);
  const bytes = await readFile(filePath).catch((error: unknown) => {
    throw asDocumentError(error, "FILE_NOT_FOUND", label);
  });
  assertBytesWithinBudget(bytes.length, config.limits.maxInputBytes, label);
  return bytes;
}

/** Ensure the artifact root exists and is writable, failing with a clear code. */
export async function ensureArtifactRoot(
  scope: ResolvedDocumentScope,
): Promise<void> {
  try {
    await scope.store.ensureDir(".");
  } catch (error) {
    throw asDocumentError(error, "ARTIFACT_WRITE_FAILED");
  }
}

export function assertInsideArtifactRoot(
  scope: ResolvedDocumentScope,
  target: string,
  label: string,
): string {
  if (!isInsideRoot(scope.artifactRoot, path.resolve(target))) {
    throw new DocumentError(
      "PATH_NOT_ALLOWED",
      `${label} is outside the artifact root`,
    );
  }
  return target;
}
