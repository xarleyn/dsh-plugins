/**
 * Shared plumbing of the document providers.
 *
 * Providers report what they wrote through {@link verifyOutput}: a backend
 * that exits 0 but leaves no file behind is a failure, and one that leaves an
 * empty file is a failure too — the caller must never be handed a path that
 * looks like an artifact and is not.
 */

import { readFile, stat } from "node:fs/promises";

import { DocumentError, sanitizeBackendOutput } from "../errors.js";
import type { BackendInfo, DocumentWarning } from "../types.js";

export type ProviderFailureCode =
  "RENDER_FAILED" | "CONVERSION_FAILED" | "EXTRACTION_FAILED";

export interface VerifiedOutput {
  readonly path: string;
  readonly size: number;
}

export async function verifyOutput(
  outputPath: string,
  backend: string,
  code: ProviderFailureCode,
): Promise<VerifiedOutput> {
  const details = await stat(outputPath).catch(() => undefined);
  if (details === undefined || !details.isFile()) {
    throw new DocumentError(
      code,
      `${backend} reported success but produced no output`,
      { backend },
    );
  }
  if (details.size === 0) {
    throw new DocumentError(code, `${backend} produced an empty file`, {
      backend,
    });
  }
  return { path: outputPath, size: details.size };
}

/** `--metadata=key=value` pairs, sanitized of control characters. */
export function metadataArguments(
  metadata: Readonly<Record<string, string>> | undefined,
): string[] {
  if (metadata === undefined) return [];
  const args: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    const cleanKey = key.replace(/[^A-Za-z0-9_-]+/gu, "-").slice(0, 40);
    if (cleanKey === "") continue;
    // Newlines would let a value impersonate the next CLI argument in a log;
    // argv itself is already structured, so collapsing is enough.
    /* eslint-disable-next-line no-control-regex -- newlines and NULs must not survive into a log */
    const cleanValue = value.replace(/[\r\n\u0000]+/gu, " ").slice(0, 4_000);
    args.push(`--metadata=${cleanKey}=${cleanValue}`);
  }
  return args;
}

/** First line of a `--version` run, reduced to the version token. */
export function parseVersionOutput(
  stdout: string,
  program: string,
): string | undefined {
  const firstLine = sanitizeBackendOutput(stdout.split(/\r?\n/u)[0] ?? "", 200);
  const match = /(\d+\.\d+(?:\.\d+)?)/u.exec(firstLine);
  if (match !== null) return match[1];
  return firstLine === "" || firstLine === program ? undefined : firstLine;
}

export function backendInfo(provider: string, version?: string): BackendInfo {
  return version === undefined ? { provider } : { provider, version };
}

/** Read a text output produced by a backend, with a bounded size. */
export async function readTextOutput(
  filePath: string,
  backend: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const details = await stat(filePath).catch(() => undefined);
  if (details === undefined) {
    throw new DocumentError(
      "EXTRACTION_FAILED",
      `${backend} produced no output`,
      {
        backend,
      },
    );
  }
  if (details.size > maxBytes) {
    const raw = await readFile(filePath);
    return {
      text: raw.subarray(0, maxBytes).toString("utf8"),
      truncated: true,
    };
  }
  return { text: await readFile(filePath, "utf8"), truncated: false };
}

export function truncationWarning(
  backend: string,
  contentType: string,
): DocumentWarning {
  return {
    code: "MARKDOWN_TRUNCATED",
    message: `the extracted ${contentType} exceeded the configured inline budget and was truncated`,
    backend,
  };
}
