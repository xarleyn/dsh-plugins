/**
 * Typed domain errors of the dsh-lightrag tools.
 *
 * Every failure the model can observe carries a stable machine-readable
 * `code`; the message is the human-facing explanation and the `hint` is the
 * one-line operator action that usually resolves it. Codes are never reused
 * for a different meaning, because a deployment's runbook and this table are
 * meant to be read together.
 */

export type LightRagErrorCode =
  /** The model sent an argument the tool cannot use. */
  | "invalid-argument"
  /** The configured endpoint refused the connection or did not resolve. */
  | "unreachable"
  /** The server rejected the API key (401/403). */
  | "unauthorized"
  /** The document is not in the knowledge base (404). */
  | "not-found"
  /** The server is throttling requests (429). */
  | "rate-limited"
  /** The server answered 5xx, or a status the plugin has no better code for. */
  | "server-error"
  /** The per-request budget elapsed before the server answered. */
  | "timeout"
  /** The answer was not the LightRAG API this plugin speaks. */
  | "bad-response"
  /** The request exceeded the server's body cap (413) or the local byte cap. */
  | "too-large"
  /** A write tool was called while `writes.enabled` is false. */
  | "disabled";

/** One-line operator action for each failure mode (SPEC §4.4). */
export const LIGHTRAG_ERROR_HINTS: Record<LightRagErrorCode, string> = {
  "invalid-argument": "Correct the argument and retry.",
  unreachable:
    "Check that the LightRAG service is running and that `endpoint` names it as seen from the host.",
  unauthorized:
    "Set `apiKey` (or LIGHTRAG_API_KEY) to the key the server was started with.",
  "not-found":
    "Check the document id with dsh_lightrag_documents; a 404 from a health check usually means `endpoint` names something that is not a LightRAG server.",
  "rate-limited": "Retry later, or lower the request rate.",
  "server-error":
    "Read the LightRAG server logs; the request itself was well formed.",
  timeout: "Raise `timeoutMs`, or check the server's load.",
  "bad-response":
    "Point `endpoint` at a LightRAG server; something else answered this origin.",
  "too-large": "Send less text: split the insert, or lower what is requested.",
  disabled: "Enable `writes.enabled` in the plugin configuration first.",
};

export class LightRagError extends Error {
  readonly code: LightRagErrorCode;
  /** One-line operator action; also appended to `message`. */
  readonly hint: string;

  constructor(
    code: LightRagErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    const hint = LIGHTRAG_ERROR_HINTS[code];
    super(`dsh-lightrag (${code}): ${message} Hint: ${hint}`, options);
    this.name = "LightRagError";
    this.code = code;
    this.hint = hint;
  }

  /** Narrow an unknown thrown value to this error type. */
  static from(error: unknown): LightRagError | undefined {
    return error instanceof LightRagError ? error : undefined;
  }
}
