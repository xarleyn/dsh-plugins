/**
 * The integration API's wire contract: what an external application may post to
 * `/qa/api/ask`, what it gets back, and the refusal vocabulary the HTTP layer
 * maps onto status codes.
 *
 * The shape follows the ticket bridge specification the deployment was asked to
 * implement (issue #177): a Markdown `answer`, the `sources` that back it, a
 * `confidence` bucket, an `escalate` flag for "the assistant could not answer,
 * send it to a specialist", and a `reason` for the logs. `chat_id` is the DSH
 * session identity: sending it back as `session_id` continues the same
 * conversation, which is the whole point of the bridge keeping it.
 */

import type { QaSourceReference } from "../provenance/types.js";

/** Why one integration request was refused, in the bridge's own vocabulary. */
export type QaIntegrationReason =
  | "unauthorized"
  | "forbidden"
  | "invalid-request"
  | "unsupported-media"
  | "payload-too-large"
  | "rate-limited"
  | "busy"
  | "unavailable"
  | "timeout";

/**
 * HTTP status per refusal. The mapping is part of the contract, not a detail:
 * the bridge retries on 5xx and 429, falls back to a bodyless JSON request on
 * 415, and treats 401/403 as a configuration error it must not spin on.
 */
export const QA_INTEGRATION_STATUS: Readonly<
  Record<QaIntegrationReason, number>
> = Object.freeze({
  unauthorized: 401,
  forbidden: 403,
  "invalid-request": 400,
  "unsupported-media": 415,
  "payload-too-large": 413,
  "rate-limited": 429,
  busy: 429,
  unavailable: 503,
  timeout: 504,
});

/** One refusal, carrying the status the HTTP layer answers with. */
export class QaIntegrationError extends Error {
  readonly reason: QaIntegrationReason;

  constructor(
    reason: QaIntegrationReason,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "QaIntegrationError";
    this.reason = reason;
  }

  get status(): number {
    return QA_INTEGRATION_STATUS[this.reason];
  }
}

/** One image the caller attached, already bounded and decoded to base64. */
export interface QaInlineImageAttachment {
  readonly kind: "image";
  /** A raster media type; anything else is refused before it gets here. */
  readonly mediaType: string;
  /** base64 bytes, exactly as the harness prompt content carries them. */
  readonly data: string;
  readonly name?: string;
}

/**
 * One non-image file the caller attached, still as bytes.
 *
 * Files cannot ride a prompt the way images do: the harness carries a file as
 * an opaque receipt minted by its own upload service, which an external caller
 * has no session to reach. What the bridge sends instead is read on the Host —
 * text files decoded, documents extracted through the deployment's document
 * pipeline — and the resulting text joins the prompt, which is the same
 * material the model would have read out of the stored copy.
 */
export interface QaFileAttachment {
  readonly kind: "file";
  readonly mediaType: string;
  readonly name: string;
  /** Raw bytes, bounded by the configured per-attachment ceiling. */
  readonly bytes: Buffer;
}

/** One attachment of a parsed request, in the order the caller sent it. */
export type QaIntegrationAttachment =
  | QaInlineImageAttachment
  | QaFileAttachment;

/**
 * Why one attachment could not become prompt content, in the vocabulary the
 * service maps onto HTTP.
 *
 * `unsupported` is the bridge's own fallback signal (415): repeat the question
 * without attachments. `unavailable` is the same answer for a document the
 * deployment cannot read right now, and the two are deliberately distinct only
 * in the log — a caller sees one status either way.
 */
export type QaIntegrationAttachmentReason = "unsupported" | "unavailable";

/** One attachment the Host could not turn into prompt content. */
export class QaIntegrationAttachmentError extends Error {
  readonly reason: QaIntegrationAttachmentReason;

  constructor(
    readonly attachment: string,
    reason: QaIntegrationAttachmentReason,
    message: string,
  ) {
    super(message);
    this.name = "QaIntegrationAttachmentError";
    this.reason = reason;
  }
}

/** A parsed `POST /qa/api/ask` body, whichever encoding carried it. */
export interface QaAskRequest {
  /** The question; at least one non-whitespace character. */
  readonly message: string;
  /** Product version the bridge extracted from the ticket, when it knew one. */
  readonly version: string | null;
  /** The chat to continue, or null for a new one. */
  readonly sessionId: string | null;
  /** Ticket metadata the operator sees in the log line. */
  readonly context: QaAskContext;
  readonly attachments: readonly QaIntegrationAttachment[];
}

/** The ticket metadata the bridge sends along; all of it is optional. */
export interface QaAskContext {
  readonly ticketKey: string | null;
  readonly reporter: string | null;
  readonly reporterName: string | null;
}

/** A successful answer, in the exact shape the bridge publishes. */
export interface QaAskAnswer {
  readonly chatId: string;
  readonly answer: string;
  readonly sources: readonly string[];
  readonly confidence: "high" | "medium" | "low";
  /** True when the assistant produced nothing worth publishing. */
  readonly escalate: boolean;
  /** Why it escalated — for the bridge's log, never for a client. */
  readonly reason: string;
}

/** `GET /qa/api/health` payload; the bridge only needs `ok`. */
export interface QaHealth {
  readonly ok: boolean;
  readonly version: string;
  readonly models: readonly string[];
  readonly uptimeS: number;
}

/**
 * What one answered turn hands back to the service: the answer text, the
 * sources that back it and whether the turn was cut short. The runner owns the
 * session mechanics; nothing about sessions leaks into the wire contract.
 */
export interface QaIntegrationTurn {
  readonly chatId: string;
  readonly answer: string;
  readonly sources: readonly QaSourceReference[];
  /** True when the turn was cancelled or the log recorded an interruption. */
  readonly interrupted: boolean;
}

/** The one host capability the integration service needs, as a port. */
export interface QaIntegrationRunner {
  /**
   * Send one question into a chat and resolve once its turn has settled.
   *
   * Implementations must enforce that `userId` may use `chatId` — the service
   * has already checked the credential, and whoever owns session creation owns
   * the ownership boundary that goes with it.
   */
  run(input: {
    readonly userId: string;
    /** The chat to continue, or null for a new conversation. */
    readonly chatId: string | null;
    readonly message: string;
    readonly attachments: readonly QaIntegrationAttachment[];
    readonly ticketKey: string | null;
    readonly signal: AbortSignal;
    /**
     * Called as soon as the chat exists, before the turn settles. The service
     * needs the identity of a chat whose answer it may never see: a timed-out
     * question still has to hand the bridge a chat it can continue.
     */
    readonly onChat?: (chatId: string) => void;
  }): Promise<QaIntegrationTurn>;

  /** Model ids the deployment can route right now, for the health payload. */
  models(): Promise<readonly string[]>;
}
