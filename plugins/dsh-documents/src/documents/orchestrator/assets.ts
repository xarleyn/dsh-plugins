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
  assertRelativeAssetReference,
  resolveInsideRoot,
  sanitizeFilename,
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

function extensionFor(
  mediaType: string,
  fallbackName: string | undefined,
): string {
  const mapped = EXTENSION_BY_MIME[mediaType];
  if (mapped !== undefined) return mapped;
  const fromName =
    fallbackName === undefined ? undefined : path.extname(fallbackName);
  return fromName === undefined || fromName === "" ? "bin" : fromName.slice(1);
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

    const fileName = sanitizeFilename(
      asset.filename ??
        (asset.path === undefined ? id : path.basename(asset.path)),
      id,
      `.${extensionFor(mediaType, asset.filename)}`,
    );
    await writeFile(path.join(options.assetsDir, fileName), bytes);
    // Two spellings reach the stored file: the declared path (rewritten to the
    // stored name) and the asset id, so a source that references
    // `assets/<id>.<ext>` lands on the same file as one that references the
    // final name.
    const idReference = `assets/${id}${path.extname(fileName)}`;
    if (!references.includes(idReference)) references.push(idReference);
    prepared.push({ id, fileName, mediaType, bytes: bytes.length, references });
  }
  return { assets: prepared, warnings };
}

const IMAGE_REFERENCE = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/gu;

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

/**
 * Rewrite the image references that point at a provided asset to the bundle's
 * own `assets/<name>`, keeping every other reference untouched. Matching is
 * whole-reference (never a substring) and resolves relative spellings against
 * the workspace, so an absolute path and a workspace-relative path to the same
 * file both land on the same asset.
 */
export function rewriteAssetReferences(
  markdown: string,
  assets: readonly PreparedAsset[],
  options: { readonly roots: readonly string[] },
): string {
  if (assets.length === 0) return markdown;
  const index = referenceIndex(assets, options.roots);
  return markdown.replace(
    IMAGE_REFERENCE,
    (full: string, reference: string) => {
      const direct = index.get(normalizeReference(reference));
      if (direct !== undefined)
        return full.replace(reference, `assets/${direct}`);
      for (const root of options.roots) {
        const resolved = index.get(
          normalizeReference(path.resolve(root, reference)),
        );
        if (resolved !== undefined)
          return full.replace(reference, `assets/${resolved}`);
      }
      return full;
    },
  );
}

/**
 * Verify every image reference in the Markdown before a renderer can act on
 * it: local files must exist inside the assets directory, and remote URLs are
 * refused because the renderer would fetch them (§26.5).
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
  for (const match of markdown.matchAll(IMAGE_REFERENCE)) {
    const rawReference = match[1] ?? "";
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
