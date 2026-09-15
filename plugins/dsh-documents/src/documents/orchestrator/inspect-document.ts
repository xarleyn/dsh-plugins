/**
 * `document_inspect` orchestration (§11).
 *
 * A read-only pass over one file: what it is, how big it is, what it says
 * about itself, and what structure it holds. No artifact is created — the
 * operation answers a question, it does not make a document.
 */

import path from "node:path";

import { sha256Hex } from "../artifacts/store.js";
import { DocumentError } from "../errors.js";
import {
  mediaTypeOfDetected,
  readDocxFacts,
  readDocxMetadata,
  readPdfFacts,
} from "../inspect/facts.js";
import { markdownStructure } from "../markdown/normalize.js";
import { sniffDocument } from "../security/file-types.js";
import type {
  DocumentInspectInput,
  DocumentInspectResult,
  DocumentWarning,
} from "../types.js";
import {
  readInputBytes,
  resolveDocumentScope,
  resolveInputPath,
  type DocumentScope,
} from "./scope.js";
import type { DocumentRuntimeDeps } from "./runtime-deps.js";

export async function inspectDocument(
  deps: DocumentRuntimeDeps,
  input: DocumentInspectInput,
  scopeInput: DocumentScope,
): Promise<DocumentInspectResult> {
  const config = deps.config;
  if (typeof input.file !== "string" || input.file.trim() === "") {
    throw new DocumentError("INVALID_INPUT", "file must be a path");
  }
  const scope = await resolveDocumentScope(config, scopeInput);
  const inputPath = await resolveInputPath(config, scope, input.file, "file");
  const bytes = await readInputBytes(inputPath, config, "file");
  const sniffed = sniffDocument(bytes, inputPath);
  const warnings: DocumentWarning[] = [];
  const result: {
    filename: string;
    format: DocumentInspectResult["format"];
    mediaType: string;
    size: number;
    sha256: string;
    metadata?: NonNullable<DocumentInspectResult["metadata"]>;
    structure?: NonNullable<DocumentInspectResult["structure"]>;
    encrypted?: boolean;
    macroEnabled?: boolean;
    warnings: DocumentWarning[];
  } = {
    filename: path.basename(inputPath),
    format: sniffed.format,
    mediaType:
      sniffed.mediaType === "application/octet-stream" ||
      sniffed.mediaType === "application/zip"
        ? mediaTypeOfDetected(sniffed.format)
        : sniffed.mediaType,
    size: bytes.length,
    sha256: sha256Hex(bytes),
    warnings,
  };

  if (sniffed.format === "pdf") {
    const facts = readPdfFacts(bytes);
    if (facts.encrypted) {
      // Reported, not refused: inspect exists to answer "what is this file",
      // and "an encrypted PDF" is a complete answer (§11).
      result.encrypted = true;
    }
    if (Object.keys(facts.metadata).length > 0) {
      result.metadata = facts.metadata;
    } else {
      warnings.push({
        code: "METADATA_PARTIALLY_EXTRACTED",
        message:
          "the document carries no readable document-information entries",
      });
    }
    result.structure = {
      ...(facts.pages === undefined ? {} : { pages: facts.pages }),
      ...(facts.images === undefined ? {} : { images: facts.images }),
    };
  } else if (sniffed.format === "docx" || sniffed.format === "docm") {
    const facts = readDocxFacts(bytes);
    const metadata = readDocxMetadata(bytes);
    if (Object.keys(metadata).length > 0) {
      result.metadata = metadata;
    } else {
      warnings.push({
        code: "METADATA_PARTIALLY_EXTRACTED",
        message: "the document carries no readable core properties",
      });
    }
    result.structure = { ...facts };
    if (sniffed.macroEnabled === true) result.macroEnabled = true;
  } else if (sniffed.format === "markdown") {
    const text = bytes.toString("utf8");
    result.structure = markdownStructure(text);
  } else {
    warnings.push({
      code: "METADATA_PARTIALLY_EXTRACTED",
      message: "the file is not a document format this pipeline recognizes",
    });
  }

  deps.logger.debug("documents.inspect", {
    format: sniffed.format,
    bytes: bytes.length,
  });
  return result;
}
