/**
 * Shared plumbing of the document providers.
 *
 * Providers report what they wrote through {@link verifyOutput}: a backend
 * that exits 0 but leaves no file behind is a failure, and one that leaves an
 * empty file is a failure too — the caller must never be handed a path that
 * looks like an artifact and is not.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

/**
 * `--metadata-file=…` for the document's title and metadata, or nothing.
 *
 * A backend decodes its own command line in its own locale, while it always
 * decodes the files it is handed as UTF-8. Text that rides argv therefore
 * depends on the locale of the image: where no UTF-8 locale is set, every byte
 * above 0x7F of `--metadata=title=…` reaches the backend as a replacement
 * character and the generated document opens with a title of U+FFFDs over an
 * otherwise intact body. Document text is not put in argv at all — it goes into
 * a YAML file in the job's work directory, which the orchestrator removes with
 * the rest of the intermediates (§13).
 */
export async function metadataArguments(
  workDir: string,
  fileName: string,
  title: string | undefined,
  metadata: Readonly<Record<string, string>> | undefined,
): Promise<string[]> {
  const entries: Record<string, string> = { ...metadata };
  if (title !== undefined) entries["title"] = title;
  const lines: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    const cleanKey = key.replace(/[^A-Za-z0-9_-]+/gu, "-").slice(0, 40);
    if (cleanKey === "") continue;
    // A YAML scalar stays on one line, so a value cannot forge the next entry.
    /* eslint-disable-next-line no-control-regex -- newlines and NULs must not survive into a scalar */
    const cleanValue = value.replace(/[\r\n\u0000]+/gu, " ").slice(0, 4_000);
    // Both halves are quoted: a key made of digits would otherwise be read as
    // a number, and Pandoc wants the keys of a metadata map for its own type.
    lines.push(`${JSON.stringify(cleanKey)}: ${JSON.stringify(cleanValue)}`);
  }
  if (lines.length === 0) return [];
  const filePath = path.join(workDir, fileName);
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return [`--metadata-file=${filePath}`];
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
