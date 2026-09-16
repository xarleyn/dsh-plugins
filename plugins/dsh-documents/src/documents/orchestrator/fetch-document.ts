/**
 * `document_from_url` orchestration (§9, §34).
 *
 * Retrieval is not this subsystem's business: the URL is fetched through the
 * deployment's web provider, which owns the rules, credentials, address policy
 * and size caps. What this operation adds is durability — the fetched text is
 * written into an artifact bundle with a manifest that names the source URL, so
 * a later conversion (or an operator looking for the file) has something to
 * point at instead of a line in the conversation.
 *
 * A response that is not text is refused here rather than half-stored: a
 * document behind an unsupported format reaches the model as the fetch
 * provider's own explanation, which names the format.
 */

import path from "node:path";

import {
  buildManifest,
  outputRecord,
  writeManifest,
} from "../artifacts/manifest.js";
import { sha256Hex } from "../artifacts/store.js";
import { DocumentError } from "../errors.js";
import { normalizeExtractedMarkdown } from "../markdown/normalize.js";
import { sanitizeFilename } from "../security/paths.js";
import type {
  DocumentFromUrlInput,
  DocumentFromUrlResult,
  DocumentWarning,
} from "../types.js";
import {
  ensureArtifactRoot,
  resolveDocumentScope,
  type DocumentScope,
} from "./scope.js";
import type {
  DocumentFetchSource,
  DocumentRuntimeDeps,
} from "./runtime-deps.js";

/** Retrieval result as the web seam reports it. */
type FetchedSource = Awaited<ReturnType<DocumentFetchSource>>;

/** Provider the manifest names when the text came from the web layer. */
const FETCH_BACKEND = "web-fetch";

/** Parse and validate the URL before anything else touches it. */
export function normalizeSourceUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new DocumentError(
      "INVALID_INPUT",
      `"${trimmed}" is not an absolute URL`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new DocumentError(
      "INVALID_INPUT",
      `the source URL must be http(s); "${url.protocol}" is not supported`,
    );
  return url.toString();
}

/** Filename hint taken from the source URL; the manifest records it. */
function filenameFromUrl(url: string): string | undefined {
  try {
    const segments = new URL(url).pathname
      .split("/")
      .filter((segment) => segment.length > 0);
    const last = segments[segments.length - 1];
    if (last === undefined) return undefined;
    const decoded = decodeURIComponent(last);
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export async function fromUrl(
  deps: DocumentRuntimeDeps,
  input: DocumentFromUrlInput,
  scopeInput: DocumentScope,
): Promise<DocumentFromUrlResult> {
  const config = deps.config;
  const started = Date.now();
  const sourceUrl = normalizeSourceUrl(input.url);
  const fetchSource = deps.fetchSource;
  if (fetchSource === undefined) {
    throw new DocumentError(
      "BACKEND_UNAVAILABLE",
      "this deployment has no web fetch provider, so online sources cannot be read",
    );
  }
  const scope = await resolveDocumentScope(config, scopeInput);
  await ensureArtifactRoot(scope);

  let response: FetchedSource;
  try {
    response = await fetchSource(sourceUrl, scope.signal);
  } catch (error) {
    // A pipeline error already carries its code and the operator-facing text.
    if (error instanceof DocumentError) throw error;
    // The fetch layer's message is the useful one ("... is not extracted",
    // "no rule matches", "timed out"): pass it through instead of inventing a
    // second vocabulary for the same failure.
    throw new DocumentError(
      "EXTRACTION_FAILED",
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }

  if (response.body.kind !== "text") {
    throw new DocumentError(
      "UNSUPPORTED_FORMAT",
      `${sourceUrl} returned an HTML page, not a document; read pages with the web fetch tool and create documents from their text`,
    );
  }

  const warnings: DocumentWarning[] = [];
  const raw = normalizeExtractedMarkdown(response.body.content);
  warnings.push(...raw.warnings);
  const maxChars = config.limits.maxMarkdownChars;
  const truncated = raw.markdown.length > maxChars;
  if (truncated) {
    warnings.push({
      code: "MARKDOWN_TRUNCATED",
      message: `the source is ${raw.markdown.length} characters; the artifact keeps the first ${maxChars}`,
      details: { chars: raw.markdown.length, kept: maxChars },
    });
  }
  const text = truncated ? raw.markdown.slice(0, maxChars) : raw.markdown;
  if (response.truncated) {
    warnings.push({
      code: "MARKDOWN_TRUNCATED",
      message:
        "the fetch provider capped the response, so the stored text may be shorter than the source",
    });
  }

  const { artifactId } = await scope.store.create(deps.now().getTime());
  const markdownName = sanitizeFilename(input.outputFilename, "source", ".md");
  const written = await scope.store.write(
    path.join(artifactId, markdownName),
    text,
  );
  const sourceFilename = filenameFromUrl(sourceUrl);
  const manifest = buildManifest({
    artifactId,
    operation: "document_from_url",
    createdAt: deps.now().toISOString(),
    input: {
      format: "md",
      sha256: sha256Hex(Buffer.from(text, "utf8")),
      ...(sourceFilename === undefined ? {} : { filename: sourceFilename }),
      bytes: Buffer.byteLength(text, "utf8"),
    },
    outputs: [
      outputRecord({
        format: "md",
        path: written.path,
        mediaType: "text/markdown",
        size: written.size,
        sha256: written.sha256,
        status: "created",
      }),
    ],
    backends: { fetch: { provider: FETCH_BACKEND } },
    warnings,
    scope: {
      ...(scope.sessionId === undefined ? {} : { sessionId: scope.sessionId }),
      workspace: scope.workspaceRoot,
    },
  });
  const manifestPath = await writeManifest(scope.store, artifactId, manifest);

  const inlineLimit = config.extraction.maxInlineChars;
  const inline = text.length > inlineLimit ? text.slice(0, inlineLimit) : text;
  if (inline.length < text.length) {
    warnings.push({
      code: "MARKDOWN_TRUNCATED",
      message: `the response carries the first ${inlineLimit} characters; the artifact keeps the whole source`,
      details: { chars: text.length, inline: inlineLimit },
    });
  }

  deps.logger.info("documents.from_url", {
    artifactId,
    sourceUrl: new URL(sourceUrl).origin,
    statusCode: response.statusCode,
    chars: text.length,
    durationMs: Date.now() - started,
    status: "ok",
  });

  return {
    artifactId,
    markdown: inline,
    markdownPath: written.path,
    sourceUrl,
    truncated: truncated || response.truncated,
    backend: FETCH_BACKEND,
    warnings,
    manifestPath,
  };
}
