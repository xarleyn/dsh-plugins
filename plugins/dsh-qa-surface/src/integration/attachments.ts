import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PromptContentPart } from "@deepseek-ai/dsh-api-session-controller";
import type { DocumentsFace } from "@yadsh/dsh-documents";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { QA_PDF_MEDIA_TYPE, QA_WORD_MEDIA_TYPE } from "../shared/documents.js";
import {
  QaIntegrationAttachmentError,
  type QaFileAttachment,
} from "./contract.js";

/**
 * Bringing a ticket's attachments into the prompt.
 *
 * An image rides the prompt inline, because that is what the harness carries.
 * A file does not: `PromptContentPart` names one as an opaque receipt minted by
 * the harness's own upload service, which an external caller has no session to
 * reach — and that service is what stores the copy the model later reads with
 * its file tools. The bridge's non-image attachments are therefore read *here*
 * and arrive as text: a text file is decoded, a document is extracted through
 * the deployment's own document pipeline (the same runtime, providers and
 * limits the `document_*` tools use), and the result joins the prompt as one
 * more text part.
 *
 * That is a deliberate trade. It costs the fidelity of a format the pipeline
 * cannot read — such a request is refused with the bridge's own fallback signal
 * rather than answered with a question the model cannot see the attachment for.
 * It buys a path that works in every deployment shape: nothing is written into
 * a shared workspace, the staging directory is temporary and removed after the
 * extraction, and no second converter is grown inside this plugin.
 */

/**
 * Plain-text formats the bridge sends; their bytes *are* the content, so
 * decoding them needs no pipeline and cannot fail on a deployment.
 */
export const QA_INTEGRATION_TEXT_MEDIA_TYPES: readonly string[] = Object.freeze(
  ["text/plain", "text/csv", "text/markdown"],
);

/**
 * Documents the deployment's pipeline is asked to extract. PDF and the OOXML
 * family are what the bridge's own filter lets through; whether a particular
 * one is readable is the pipeline's answer, not a list kept here.
 */
export const QA_INTEGRATION_DOCUMENT_MEDIA_TYPES: readonly string[] =
  Object.freeze([
    QA_PDF_MEDIA_TYPE,
    QA_WORD_MEDIA_TYPE,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]);

/** Total inlined attachment text per question, across every attachment. */
export const QA_INTEGRATION_MAX_ATTACHMENT_CHARS = 120_000;

/** No single attachment may claim the whole budget. */
export const QA_INTEGRATION_MAX_ATTACHMENT_CHARS_PER_FILE = 60_000;

/** A file name is a label in the prompt, not a path. */
export const QA_INTEGRATION_MAX_ATTACHMENT_NAME = 120;

/** Whether the bytes are the content: decoding needs only UTF-8. */
export function isIntegrationTextMediaType(mediaType: string): boolean {
  return QA_INTEGRATION_TEXT_MEDIA_TYPES.includes(
    mediaType.trim().toLowerCase(),
  );
}

/** Whether the attachment has to go through the document pipeline. */
export function isIntegrationDocumentMediaType(mediaType: string): boolean {
  return QA_INTEGRATION_DOCUMENT_MEDIA_TYPES.includes(
    mediaType.trim().toLowerCase(),
  );
}

/**
 * Drop every C0/C1 control character and DEL.
 *
 * Spelled as a code-point filter rather than a character class: a name is a
 * log field and a prompt heading, and a newline smuggled through one of those
 * would let the caller forge lines in either.
 */
function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
}

/**
 * Reduce a caller-supplied file name to the label a prompt can carry.
 *
 * The name arrives from another system and is used as a log field, a heading in
 * the prompt and the file name of one temporary file — so directory parts,
 * traversal, control characters and an unbounded length all have to go before
 * it is any of those. An empty result is named by its media type.
 * @param raw - the name the caller sent.
 * @param mediaType - its media type, for the fallback name.
 * @returns a safe, non-empty label.
 */
export function safeAttachmentName(raw: string, mediaType: string): string {
  const base = stripControlCharacters(path.basename(raw.replace(/\\/gu, "/")))
    .replace(/^\.+/u, "")
    .trim();
  const bounded = base.slice(0, QA_INTEGRATION_MAX_ATTACHMENT_NAME);
  if (bounded !== "") return bounded;
  const subtype = mediaType.split("/")[1] ?? "file";
  return `attachment.${subtype.replace(/[^a-z0-9.]/giu, "")}`;
}

/** A human-readable size for the prompt's heading. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} КБ`;
  const megabytes = bytes / (1024 * 1024);
  return `${String(Math.round(megabytes * 10) / 10).replace(".", ",")} МБ`;
}

/**
 * Whether a text attachment is actually text.
 *
 * A NUL byte in the head of a file is the cheapest reliable signal that the
 * caller labelled something binary as text; decoding it would put replacement
 * characters in the prompt and call it the document's content.
 */
function looksLikeText(bytes: Buffer): boolean {
  return !bytes.subarray(0, 8192).includes(0);
}

/** Cut extracted text to the budget, on a line or word boundary where possible. */
function boundText(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const head = text.slice(0, budget);
  const at = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
  return `${(at > 0 ? head.slice(0, at) : head).trimEnd()}…`;
}

/** One attachment as the prompt carries it: a heading and the readable content. */
function attachmentBlock(input: {
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly text: string;
  readonly truncated: boolean;
}): PromptContentPart {
  const heading = `--- ${input.name} (${input.mediaType}, ${formatBytes(input.bytes)}) ---`;
  const note = input.truncated
    ? "\n\n[…текст сокращён, показано начало файла]"
    : "";
  return {
    type: "text",
    text:
      input.text === ""
        ? `${heading}\n[файл прочитан, но не содержит текста]`
        : `${heading}\n${input.text}${note}`,
  };
}

/** What the extraction needs from the Host, as a port. */
export interface QaAttachmentDependencies {
  /** The document pipeline, or undefined on a deployment without it. */
  readonly documents: DocumentsFace | undefined;
  /** The chat the prompt belongs to; the pipeline records artifacts against it. */
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly logger: PluginLogger;
  /** Total inlined characters for this question. */
  readonly maxChars?: number;
}

/**
 * Extract one document through the deployment's pipeline.
 *
 * The pipeline takes a path, not bytes, so the attachment is written to a
 * temporary directory created for this one extraction, and that directory is
 * the workspace root the conversion is scoped to. An unconfigured deployment
 * therefore keeps the conversion's artifacts beside the input — inside the
 * directory `finally` removes — while a deployment that configured its own
 * artifact root keeps them under it, where its own retention sweep already
 * governs them. Either way nothing lands in a workspace the deployment shares.
 */
async function extractDocumentText(
  file: QaFileAttachment,
  name: string,
  deps: QaAttachmentDependencies,
): Promise<string> {
  const documents = deps.documents;
  if (documents === undefined) {
    throw new QaIntegrationAttachmentError(
      name,
      "unavailable",
      "this deployment has no document pipeline",
    );
  }
  let directory: string;
  try {
    directory = await mkdtemp(
      path.join(tmpdir(), "qa-integration-attachment-"),
    );
  } catch (error) {
    // A Host whose temporary directory cannot be written cannot read the
    // attachment either. That is the caller's own answer — repeat the question
    // without it — and not a 5xx: a bridge would retry a 5xx forever against
    // the same broken directory.
    deps.logger.warn("integration.attachment-unreadable", {
      name,
      mediaType: file.mediaType,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new QaIntegrationAttachmentError(
      name,
      "unavailable",
      `could not stage ${name} for extraction`,
    );
  }
  try {
    const input = path.join(directory, name);
    await writeFile(input, file.bytes, { mode: 0o600 });
    const extracted = await documents.toMarkdown(
      { file: input },
      {
        workspaceRoot: directory,
        sessionId: deps.sessionId,
        signal: deps.signal,
      },
    );
    return extracted.markdown;
  } catch (error) {
    if (error instanceof QaIntegrationAttachmentError) throw error;
    deps.logger.warn("integration.attachment-unreadable", {
      name,
      mediaType: file.mediaType,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new QaIntegrationAttachmentError(
      name,
      "unsupported",
      `the document pipeline could not read ${name}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

/**
 * Turn the request's file attachments into prompt text parts.
 *
 * The parts are appended after the question, in the order the caller sent them,
 * and the question itself is untouched. A file the Host cannot read refuses the
 * whole request: answering with the question but not its attachments would hand
 * the model a question about material it never received, which is exactly what
 * the bridge's 415 fallback exists to avoid.
 *
 * @param files - the non-image attachments of one request.
 * @param deps - pipeline, session and budgets.
 * @returns one text part per readable attachment, plus a note when the budget cut the list.
 */
export async function attachmentPromptParts(
  files: readonly QaFileAttachment[],
  deps: QaAttachmentDependencies,
): Promise<readonly PromptContentPart[]> {
  if (files.length === 0) return [];
  const total = deps.maxChars ?? QA_INTEGRATION_MAX_ATTACHMENT_CHARS;
  const parts: PromptContentPart[] = [];
  let remaining = total;
  let dropped = 0;
  for (const file of files) {
    if (remaining <= 0) {
      dropped += 1;
      continue;
    }
    const mediaType = file.mediaType.trim().toLowerCase();
    const name = safeAttachmentName(file.name, mediaType);
    let text: string;
    if (isIntegrationTextMediaType(mediaType)) {
      if (!looksLikeText(file.bytes)) {
        throw new QaIntegrationAttachmentError(
          name,
          "unsupported",
          `${name} is not text`,
        );
      }
      text = file.bytes.toString("utf8");
    } else {
      text = await extractDocumentText(file, name, deps);
    }
    const budget = Math.min(
      remaining,
      QA_INTEGRATION_MAX_ATTACHMENT_CHARS_PER_FILE,
    );
    const bounded = boundText(text.trim(), budget);
    remaining -= bounded.length;
    parts.push(
      Object.freeze(
        attachmentBlock({
          name,
          mediaType,
          bytes: file.bytes.length,
          text: bounded,
          truncated: bounded.length < text.trim().length,
        }),
      ),
    );
  }
  if (dropped > 0) {
    parts.push({
      type: "text",
      text: `[${String(dropped)} вложений не показано: исчерпан предел текста вложений]`,
    });
  }
  return Object.freeze(parts);
}

/** Re-exported so the runner does not reach into the contract for one name. */
export { QaIntegrationAttachmentError };
