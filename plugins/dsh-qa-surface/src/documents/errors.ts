/**
 * Typed failures of the document pipeline.
 *
 * Every failure the agent can observe carries a stable machine-readable code
 * (§24) and the backend that produced it. Backend output is never forwarded
 * verbatim: {@link sanitizeBackendOutput} strips ANSI escapes, collapses
 * whitespace, replaces absolute paths with the placeholder the operator can
 * recognize as "inside the sandbox" and caps the length, so a converter's
 * stderr cannot leak the deployment's layout or the document's content into a
 * model request.
 */

export const DOCUMENT_ERROR_CODES = [
  "INVALID_INPUT",
  "UNSUPPORTED_FORMAT",
  "UNSUPPORTED_CONVERSION",
  "INPUT_TOO_LARGE",
  "DOCUMENT_TOO_LARGE",
  "FILE_NOT_FOUND",
  "TEMPLATE_NOT_FOUND",
  "INVALID_TEMPLATE",
  "INVALID_ASSET",
  "PATH_NOT_ALLOWED",
  "ENCRYPTED_DOCUMENT",
  "MACRO_ENABLED_DOCUMENT",
  "OCR_FAILED",
  "EXTRACTION_FAILED",
  "RENDER_FAILED",
  "CONVERSION_FAILED",
  "BACKEND_UNAVAILABLE",
  "BACKEND_TIMEOUT",
  "BACKEND_FAILED",
  "ARTIFACT_WRITE_FAILED",
] as const;

export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

/** Retryability per code: only transient backend conditions ask for a retry. */
const RETRYABLE: ReadonlySet<DocumentErrorCode> = new Set<DocumentErrorCode>([
  "BACKEND_UNAVAILABLE",
  "BACKEND_TIMEOUT",
  "BACKEND_FAILED",
]);

export interface DocumentErrorFields {
  readonly backend?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

export class DocumentError extends Error {
  readonly code: DocumentErrorCode;
  readonly retryable: boolean;
  readonly backend: string | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: DocumentErrorCode,
    message: string,
    fields: DocumentErrorFields = {},
  ) {
    super(`document pipeline (${code}): ${message}`, { cause: fields.cause });
    this.name = "DocumentError";
    this.code = code;
    this.retryable = fields.retryable ?? RETRYABLE.has(code);
    this.backend = fields.backend;
    this.details = fields.details;
  }

  /** The structured form the manifest and the logs carry (§24). */
  toShape(): {
    readonly code: DocumentErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly backend?: string;
    readonly details?: Readonly<Record<string, unknown>>;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.backend === undefined ? {} : { backend: this.backend }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/* eslint-disable no-control-regex -- escape and control sequences are the point */
const ANSI_PATTERN = /\u001B\[[0-9;]*[A-Za-z]/gu;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
/* eslint-enable no-control-regex */
// Anchored at a word start and requiring a second separator, so prose such as
// "and/or" survives while `/tmp/qa-documents/job-1/output.docx` does not.
const ABSOLUTE_PATH_PATTERN =
  /(?<=^|\s)(?:[A-Za-z]:[\\/]|\/)(?:[^\s"'`()[\]{},;]+[\\/])+[^\s"'`()[\]{},;]*/gu;
const DEFAULT_BACKEND_MESSAGE_MAX = 2_000;

/**
 * Make a backend's diagnostic text safe to show: no escapes, no absolute
 * paths, one line per statement, at most `max` characters.
 */
export function sanitizeBackendOutput(
  text: string,
  max: number = DEFAULT_BACKEND_MESSAGE_MAX,
): string {
  const cleaned = text
    .replace(ANSI_PATTERN, "")
    .replace(CONTROL_PATTERN, "")
    .replace(/\r\n?/gu, "\n")
    .replace(ABSOLUTE_PATH_PATTERN, "<path>")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("; ")
    .replace(/\s{2,}/gu, " ");
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/** Wrap any thrown value into a {@link DocumentError} without losing its code. */
export function asDocumentError(
  error: unknown,
  fallbackCode: DocumentErrorCode,
  backend?: string,
): DocumentError {
  if (error instanceof DocumentError) return error;
  const message =
    error instanceof Error
      ? sanitizeBackendOutput(error.message)
      : sanitizeBackendOutput(String(error));
  return new DocumentError(
    fallbackCode,
    message === "" ? "the operation failed" : message,
    {
      ...(backend === undefined ? {} : { backend }),
      cause: error,
    },
  );
}
