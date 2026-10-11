/**
 * Asset preparation and reference auditing (§17.1).
 *
 * Assets reach a document two ways: the caller names a file in the workspace,
 * or it inlines bytes as a data URI. Both are copied into the bundle's
 * `assets/` directory under a name the pipeline chooses, so the rendered
 * document never depends on a path outside the artifact, and the Markdown
 * references are rewritten to match.
 *
 * Before a renderer runs, every image reference in the source is accounted
 * for: a missing local file, a reference that leaves the assets directory, or
 * a remote URL (which the renderer would fetch from the network) is an error,
 * not a silent drop.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ResolvedDocumentsConfig } from "../config.js";
import { DocumentError, asDocumentError } from "../errors.js";
import { assertBytesWithinBudget } from "../security/limits.js";
import {
  assertInsideRoot,
  assertRelativeAssetReference,
  resolveInsideRoot,
  sanitizeFilename,
  sanitizeStem,
} from "../security/paths.js";
import {
  describeBytes,
  isAllowedAssetMimeType,
  mimeTypeForFilename,
  mimeTypeOfBytes,
} from "../security/file-types.js";
import type { DocumentAssetInput, DocumentWarning } from "../types.js";
import { allowedInputRoots, type ResolvedDocumentScope } from "./scope.js";

export interface PreparedAsset {
  readonly id: string;
  /** Name inside the bundle's `assets/` directory. */
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: number;
  /** How the caller referred to this asset, for reference rewriting. */
  readonly references: readonly string[];
}

export interface PreparedAssets {
  readonly assets: readonly PreparedAsset[];
  readonly warnings: readonly DocumentWarning[];
}

const DATA_URI = /^data:([A-Za-z0-9.+/-]+);base64,([\s\S]*)$/u;
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tif",
};
/** Only a plain token can follow the dot: anything else is caller text. */
const SAFE_EXTENSION = /^[A-Za-z0-9]{1,8}$/u;

function extensionFor(
  mediaType: string,
  fallbackName: string | undefined,
): string {
  const mapped = EXTENSION_BY_MIME[mediaType];
  if (mapped !== undefined) return mapped;
  const fromName =
    fallbackName === undefined
      ? undefined
      : path.extname(fallbackName).slice(1);
  return fromName === undefined || !SAFE_EXTENSION.test(fromName)
    ? "bin"
    : fromName;
}

function decodeBase64(payload: string, id: string): Buffer {
  const compact = payload.replace(/\s+/gu, "");
  try {
    const buffer = Buffer.from(compact, "base64");
    if (buffer.length === 0) throw new Error("empty payload");
    return buffer;
  } catch (error) {
    throw new DocumentError(
      "INVALID_ASSET",
      `asset "${id}" is not valid base64`,
      {
        cause: error,
        details: { asset: id },
      },
    );
  }
}

export async function prepareAssets(
  assets: readonly DocumentAssetInput[] | undefined,
  options: {
    readonly config: ResolvedDocumentsConfig;
    readonly scope: ResolvedDocumentScope;
    readonly assetsDir: string;
  },
): Promise<PreparedAssets> {
  if (assets === undefined || assets.length === 0) {
    return { assets: [], warnings: [] };
  }
  await mkdir(options.assetsDir, { recursive: true });
  const seenIds = new Set<string>();
  const prepared: PreparedAsset[] = [];
  const warnings: DocumentWarning[] = [];
  const maxBytes = options.config.limits.maxAssetBytes;

  for (const asset of assets) {
    const id = asset.id?.trim() ?? "";
    if (id === "") {
      throw new DocumentError(
        "INVALID_ASSET",
        "every asset needs a non-empty id",
      );
    }
    if (seenIds.has(id)) {
      throw new DocumentError(
        "INVALID_ASSET",
        `asset id "${id}" is used twice`,
        {
          details: { asset: id },
        },
      );
    }
    seenIds.add(id);
    if ((asset.path === undefined) === (asset.dataRef === undefined)) {
      throw new DocumentError(
        "INVALID_ASSET",
        `asset "${id}" must carry exactly one of path or dataRef`,
        { details: { asset: id } },
      );
    }

    let bytes: Buffer;
    let references: string[] = [];
    if (asset.path !== undefined) {
      const declared = asset.path.trim();
      let resolved: string | undefined;
      for (const root of allowedInputRoots(options.config, options.scope)) {
        try {
          resolved = await resolveInsideRoot(root, declared, `asset "${id}"`);
          break;
        } catch (error) {
          if (
            error instanceof DocumentError &&
            error.code === "PATH_NOT_ALLOWED"
          )
            continue;
          throw error;
        }
      }
      if (resolved === undefined) {
        throw new DocumentError(
          "PATH_NOT_ALLOWED",
          `asset "${id}" is outside the session workspace and configured document roots`,
          { details: { asset: id } },
        );
      }
      const details = await stat(resolved).catch(() => undefined);
      if (details === undefined || !details.isFile()) {
        throw new DocumentError(
          "INVALID_ASSET",
          `asset "${id}" does not exist`,
          {
            details: { asset: id },
          },
        );
      }
      assertBytesWithinBudget(details.size, maxBytes, `asset "${id}"`);
      bytes = await readFile(resolved).catch((error: unknown) => {
        throw asDocumentError(error, "INVALID_ASSET", id);
      });
      // Both separators: a source authored on one platform may spell the path
      // the other way, and the rewrite has to catch it either way.
      references = [declared, resolved, resolved.replace(/\\/gu, "/")];
    } else {
      const match = DATA_URI.exec((asset.dataRef ?? "").trim());
      if (match === null) {
        throw new DocumentError(
          "INVALID_ASSET",
          `asset "${id}" must be a base64 data URI`,
          { details: { asset: id } },
        );
      }
      bytes = decodeBase64(match[2] ?? "", id);
      assertBytesWithinBudget(bytes.length, maxBytes, `asset "${id}"`);
      if (asset.mimeType === undefined) {
        const declaredMime = match[1] ?? "";
        if (declaredMime.startsWith("image/")) {
          warnings.push({
            code: "METADATA_PARTIALLY_EXTRACTED",
            message: `asset "${id}" carries no mimeType; the data URI's type was used`,
            details: { asset: id },
          });
        }
      }
    }
    assertBytesWithinBudget(bytes.length, maxBytes, `asset "${id}"`);

    const declaredMime = asset.mimeType?.trim();
    const dataUriMime =
      asset.dataRef === undefined
        ? undefined
        : DATA_URI.exec(asset.dataRef.trim())?.[1];
    const mediaType =
      (declaredMime === undefined || declaredMime === ""
        ? undefined
        : declaredMime) ??
      (dataUriMime === undefined || dataUriMime === ""
        ? undefined
        : dataUriMime) ??
      mimeTypeOfBytes(bytes) ??
      (asset.filename === undefined
        ? undefined
        : mimeTypeForFilename(asset.filename)) ??
      "";
    if (mediaType === "") {
      throw new DocumentError(
        "INVALID_ASSET",
        `asset "${id}" has no recognizable media type`,
        { details: { asset: id, bytes: describeBytes(bytes) } },
      );
    }
    if (
      !isAllowedAssetMimeType(
        mediaType,
        options.config.limits.allowedAssetMimeTypes,
      )
    ) {
      throw new DocumentError(
        "INVALID_ASSET",
        `asset "${id}" has media type ${mediaType}, which this deployment does not accept`,
        { details: { asset: id, mediaType } },
      );
    }

    // The stored name is the pipeline's choice, never the caller's: the label
    // is cleaned by `sanitizeFilename`, whose fallback is cleaned as well, so
    // neither an id nor a filename can put a separator into the path.
    const fileName = sanitizeFilename(
      asset.filename ??
        (asset.path === undefined ? id : path.basename(asset.path)),
      id,
      `.${extensionFor(mediaType, asset.filename)}`,
    );
    const target = assertInsideRoot(
      options.assetsDir,
      path.join(options.assetsDir, fileName),
      `asset "${id}"`,
    );
    await writeFile(target, bytes);
    // Two spellings reach the stored file: the declared path (rewritten to the
    // stored name) and the asset id, so a source that references
    // `assets/<id>.<ext>` lands on the same file as one that references the
    // final name. The id enters as a cleaned stem, so this key can only ever
    // name a file inside the assets directory.
    const idStem = sanitizeStem(id);
    const idReference =
      idStem === "" ? undefined : `assets/${idStem}${path.extname(fileName)}`;
    if (idReference !== undefined && !references.includes(idReference))
      references.push(idReference);
    prepared.push({ id, fileName, mediaType, bytes: bytes.length, references });
  }
  return { assets: prepared, warnings };
}

/**
 * One place in the source where a renderer will look for an image, and the
 * characters that hold that spelling.
 *
 * An image can carry its target at the use site (`![alt](target)`) or in a link
 * reference definition (`![alt][id]` with `[id]: target`), and the shortcut and
 * collapsed forms borrow the alt text as the id. Reading only the inline
 * spelling is what let `![x][image]` with `[image]: https://host/x.png` pass an
 * audit that a renderer then acted on, so both are resolved to target spans
 * before anything is checked or rewritten.
 */
export interface TargetSpan {
  readonly target: string;
  readonly start: number;
  readonly end: number;
}

/**
 * A link reference definition at the start of a line: `[label]: target`, with
 * the `<target>` spelling accepted and a trailing title ignored. More than three
 * leading spaces means an indented code block, not a definition.
 */
const REFERENCE_DEFINITION =
  /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(?:<([^>]*)>|(\S+))/gimu;

/** Whether the character at `index` is escaped by an odd run of backslashes. */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && text[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/**
 * For every opening delimiter, the index of the `closing` that matches it,
 * honouring nesting and backslash escapes. One pass over the source: the
 * content budget is megabytes, and re-scanning from each `![` would turn a
 * document full of unclosed brackets into a quadratic sweep.
 */
function matchedOpeners(
  text: string,
  opening: string,
  closing: string,
): Map<number, number> {
  const stack: number[] = [];
  const pairs = new Map<number, number>();
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === opening) stack.push(index);
    else if (char === closing) {
      const open = stack.pop();
      if (open !== undefined) pairs.set(open, index);
    }
  }
  return pairs;
}

/** How CommonMark compares a reference label: case-free, spaces collapsed. */
function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * Every definition written for a label, in source order. CommonMark keeps the
 * first and ignores the rest, but the audit reads them all: a source that hides
 * a remote target behind a benign duplicate must not be judged by whichever
 * spelling the renderer happened to pick.
 */
function referenceDefinitions(markdown: string): Map<string, TargetSpan[]> {
  const definitions = new Map<string, TargetSpan[]>();
  for (const match of markdown.matchAll(REFERENCE_DEFINITION)) {
    const label = normalizeLabel(match[1] ?? "");
    const bracketed = match[2];
    const target = bracketed ?? match[3] ?? "";
    if (label === "" || target === "") continue;
    // The target ends the match except in the `<...>` spelling, whose closing
    // bracket is part of the match but not of the destination.
    const start =
      match.index +
      match[0].length -
      target.length -
      (bracketed === undefined ? 0 : 1);
    const span = { target, start, end: start + target.length };
    const existing = definitions.get(label);
    if (existing === undefined) definitions.set(label, [span]);
    else existing.push(span);
  }
  return definitions;
}

/**
 * The destination of an inline `(...)`: the `<...>` form verbatim, otherwise up
 * to the first space or `"` that ends the title, with balanced parentheses kept
 * as part of the path. `offset` is where the destination begins inside `inner`.
 */
function parseInlineTarget(
  inner: string,
): { readonly value: string; readonly offset: number } | undefined {
  const indent = inner.length - inner.trimStart().length;
  const body = inner.trim();
  if (body === "") return undefined;
  if (body.startsWith("<")) {
    const close = body.indexOf(">");
    if (close < 1) return undefined;
    const value = body.slice(1, close);
    return value === "" ? undefined : { value, offset: indent + 1 };
  }
  let index = 0;
  let depth = 0;
  while (index < body.length) {
    const char = body[index] ?? "";
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (depth === 0 && /\s/u.test(char)) break;
    if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
    index += 1;
  }
  const value = body.slice(0, index);
  return value === "" ? undefined : { value, offset: indent };
}

/**
 * Every image target the source offers a renderer, in source order and each
 * span pointing at the text to replace. A reference use with no definition is
 * literal text and is not a target.
 */
export function collectImageTargets(markdown: string): TargetSpan[] {
  const definitions = referenceDefinitions(markdown);
  const brackets = matchedOpeners(markdown, "[", "]");
  const parentheses = matchedOpeners(markdown, "(", ")");
  const targets: TargetSpan[] = [];
  const claimed = new Set<string>();
  let cursor = 0;
  while (cursor < markdown.length) {
    const start = markdown.indexOf("![", cursor);
    if (start === -1) break;
    // Resuming just after `![` rather than past the whole reference keeps a
    // nested spelling (`![![a](x.png)](y.png)`) in reach of the audit: the
    // renderer may ignore it, but the audit never misses a target.
    cursor = start + 2;
    if (isEscaped(markdown, start)) continue;
    const labelEnd = brackets.get(start + 1);
    if (labelEnd === undefined) continue;
    const altText = markdown.slice(start + 2, labelEnd);
    // A renderer accepts up to three spaces between the alt text and the
    // target, so `![a] [b]` and `![a] (b.png)` are references, not a shortcut
    // plus stray text. Newlines are not bridged: they end the reference.
    let next = labelEnd + 1;
    for (let gap = 0; gap < 3 && next < markdown.length; gap += 1) {
      const char = markdown[next];
      if (char !== " " && char !== "\t") break;
      next += 1;
    }
    if (markdown[next] === "(") {
      const close = parentheses.get(next);
      if (close === undefined) continue;
      const parsed = parseInlineTarget(markdown.slice(next + 1, close));
      if (parsed !== undefined && parsed.value !== "") {
        const from = next + 1 + parsed.offset;
        targets.push({
          target: parsed.value,
          start: from,
          end: from + parsed.value.length,
        });
      }
      continue;
    }
    let label = altText;
    if (markdown[next] === "[") {
      // Full reference: the label is inside the second bracket pair; the
      // collapsed form (`![alt][]`) borrows the alt text.
      const close = brackets.get(next);
      if (close === undefined) continue;
      const inner = markdown.slice(next + 1, close);
      if (inner.trim() !== "") label = inner;
    }
    const key = normalizeLabel(label);
    if (key === "" || claimed.has(key)) continue;
    const definition = definitions.get(key);
    if (definition === undefined) continue;
    claimed.add(key);
    targets.push(...definition);
  }
  return targets;
}

function normalizeReference(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
}

/** Any spelling of a provided asset's location, mapped to its stored name. */
function referenceIndex(
  assets: readonly PreparedAsset[],
  roots: readonly string[],
): Map<string, string> {
  const index = new Map<string, string>();
  const remember = (raw: string, fileName: string): void => {
    const candidates = [normalizeReference(raw)];
    for (const root of roots) {
      candidates.push(
        normalizeReference(
          path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw),
        ),
      );
    }
    for (const candidate of candidates) {
      if (candidate !== "" && !index.has(candidate))
        index.set(candidate, fileName);
    }
  };
  for (const asset of assets) {
    for (const reference of asset.references)
      remember(reference, asset.fileName);
  }
  return index;
}

/** Which provided asset a written target names, if any. */
function storedNameFor(
  rawTarget: string,
  index: Map<string, string>,
  roots: readonly string[],
): string | undefined {
  const direct = index.get(normalizeReference(rawTarget));
  if (direct !== undefined) return direct;
  for (const root of roots) {
    const resolved = index.get(
      normalizeReference(path.resolve(root, rawTarget)),
    );
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

/**
 * Rewrite the image references that point at a provided asset to the bundle's
 * own `assets/<name>`, keeping every other reference untouched. Matching is
 * whole-reference (never a substring) and resolves relative spellings against
 * the workspace, so an absolute path and a workspace-relative path to the same
 * file both land on the same asset. A reference-style image is rewritten at its
 * definition, which is where its target is written.
 */
export function rewriteAssetReferences(
  markdown: string,
  assets: readonly PreparedAsset[],
  options: { readonly roots: readonly string[] },
): string {
  if (assets.length === 0) return markdown;
  const index = referenceIndex(assets, options.roots);
  let output = markdown;
  // Splicing backwards keeps the offsets of the spans still to come valid.
  for (const span of [...collectImageTargets(markdown)].sort(
    (left, right) => right.start - left.start,
  )) {
    const stored = storedNameFor(span.target, index, options.roots);
    if (stored === undefined) continue;
    output =
      output.slice(0, span.start) + `assets/${stored}` + output.slice(span.end);
  }
  return output;
}

/**
 * Verify every image reference in the Markdown before a renderer can act on
 * it: local files must exist inside the assets directory, and remote URLs are
 * refused because the renderer would fetch them (§26.5). Inline, collapsed,
 * shortcut and full reference spellings are all audited against this one rule,
 * since a renderer resolves them to the same destination.
 */
export async function auditAssetReferences(
  markdown: string,
  options: {
    readonly assetsDir: string;
    readonly assets: readonly PreparedAsset[];
  },
): Promise<readonly DocumentWarning[]> {
  const warnings: DocumentWarning[] = [];
  const prepared = new Set(options.assets.map((asset) => asset.fileName));
  for (const { target: rawReference } of collectImageTargets(markdown)) {
    // A scheme with an authority is a remote fetch; an absolute path (which on
    // Windows starts with a drive letter and therefore looks like a scheme) is
    // not, and is caught by the containment check below.
    if (
      /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(rawReference) ||
      rawReference.startsWith("//")
    ) {
      throw new DocumentError(
        "INVALID_ASSET",
        `the source references the remote image "${rawReference}"; remote images are never fetched — add it through assets instead`,
        { details: { reference: rawReference } },
      );
    }
    const reference = assertRelativeAssetReference(
      rawReference.replace(/^\.\//u, ""),
    );
    const fileName = path.basename(reference);
    const target = path.resolve(options.assetsDir, reference);
    const insideAssets =
      path.relative(options.assetsDir, target).split(path.sep)[0] !== "..";
    if (!insideAssets) {
      throw new DocumentError(
        "INVALID_ASSET",
        `the source references "${rawReference}", which leaves the assets directory`,
        { details: { reference: rawReference } },
      );
    }
    if (prepared.has(fileName)) continue;
    const details = await stat(target).catch(() => undefined);
    if (details?.isFile() === true) continue;
    throw new DocumentError(
      "INVALID_ASSET",
      `the source references "${rawReference}", but no such asset was provided`,
      { details: { reference: rawReference } },
    );
  }
  return warnings;
}
