import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { QaAccounts } from "../accounts/store.js";
import {
  parseServiceToken,
  type QaServiceTokenScope,
} from "../accounts/service-token.js";
import type { QaSourceReference } from "../provenance/types.js";
import type { ResolvedQaSurfaceConfig } from "../types.js";
import { boundAnswer } from "./answer.js";
import { QaIntegrationAttachmentError } from "./attachments.js";
import {
  QaIntegrationError,
  type QaAskAnswer,
  type QaAskRequest,
  type QaHealth,
  type QaIntegrationRunner,
} from "./contract.js";

/**
 * The integration API's brain: credential, budget, and one answered turn.
 *
 * The service owns everything that must be identical for every transport —
 * who is allowed to ask, how often, how many at once, what a refusal means and
 * how an answered turn is shaped into the contract. The HTTP layer owns bytes
 * and status codes, the runner owns sessions and agents. That split is what
 * lets the mechanics be tested without a web server, a model or a database.
 *
 * Two limits, deliberately different in kind. Concurrency (`maxConcurrent`)
 * protects the deployment: a bridge that fires a hundred questions must not
 * open a hundred agent turns. Rate (`requestsPerMinute`) protects the account:
 * one token cannot spend the deployment's whole budget. Both refuse with 429,
 * which the bridge already retries.
 */

/** The bridge publishes a handful of citations; more is noise in a Jira note. */
export const QA_INTEGRATION_MAX_CITATIONS = 5;

const MINUTE_MS = 60_000;

/**
 * One citation string per source, in the bridge's own style: the document plus
 * where in it the evidence sits, so a reader can open the right page.
 *
 * @param sources - the turn's evidence, best first.
 * @returns bounded citation strings.
 */
export function sourceCitations(
  sources: readonly QaSourceReference[],
): readonly string[] {
  const citations: string[] = [];
  for (const source of sources) {
    if (citations.length >= QA_INTEGRATION_MAX_CITATIONS) break;
    const location = source.locations?.[0];
    const base = source.uri ?? source.path ?? source.title;
    let citation = base;
    if (location !== undefined) {
      if (location.anchor !== undefined && location.anchor !== "") {
        citation = `${base}#${location.anchor}`;
      } else if (location.lineStart !== undefined) {
        citation =
          location.lineEnd === undefined ||
          location.lineEnd === location.lineStart
            ? `${base}:${String(location.lineStart)}`
            : `${base}:${String(location.lineStart)}-${String(location.lineEnd)}`;
      }
    }
    if (citation === "" || citations.includes(citation)) continue;
    citations.push(citation);
  }
  return Object.freeze(citations);
}

/** Who a presented credential turned out to be. */
export interface QaIntegrationIdentity {
  readonly tokenId: string;
  readonly userId: string;
  readonly scopes: readonly QaServiceTokenScope[];
}

export interface QaIntegrationServiceOptions {
  getConfig(): ResolvedQaSurfaceConfig;
  /** The accounts store, or undefined while accounts are disabled. */
  accounts(): QaAccounts | undefined;
  runner: QaIntegrationRunner;
  logger: PluginLogger;
  /** Package version the health payload reports. */
  version: string;
  now?(): number;
}

export class QaIntegrationService {
  private readonly deps: QaIntegrationServiceOptions;
  private readonly now: () => number;
  private readonly startedAt: number;
  /** Recent request timestamps per token id, pruned to the rolling minute. */
  private readonly recent = new Map<string, number[]>();
  private inFlight = 0;

  constructor(deps: QaIntegrationServiceOptions) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
  }

  /** Requests currently inside `ask`; the console shows this as load. */
  get busy(): number {
    return this.inFlight;
  }

  /**
   * Resolve a bearer credential to its token, or refuse.
   *
   * A malformed, unknown, expired, revoked or disabled-account token is one
   * answer — 401 — because telling them apart would let an unauthenticated
   * caller enumerate token ids. A valid token missing the scope is 403: the
   * caller proved who it is, and the refusal is about rights, not identity.
   */
  authenticate(
    authorization: string | undefined,
    required: QaServiceTokenScope | null,
  ): QaIntegrationIdentity {
    const token = bearerToken(authorization);
    if (token === null) {
      throw new QaIntegrationError(
        "unauthorized",
        "a Bearer integration token is required",
      );
    }
    const accounts = this.deps.accounts();
    if (accounts === undefined) {
      throw new QaIntegrationError(
        "unavailable",
        "QA accounts are not enabled on this deployment",
      );
    }
    // The shape check happens before the store: a foreign credential must not
    // even reach a database lookup.
    if (parseServiceToken(token) === null) {
      throw new QaIntegrationError("unauthorized", "the token is not accepted");
    }
    const verified = accounts.verifyServiceToken(token);
    if (verified === null) {
      throw new QaIntegrationError(
        "unauthorized",
        "the token is expired, revoked or unknown",
      );
    }
    if (required !== null && !verified.scopes.includes(required)) {
      throw new QaIntegrationError(
        "forbidden",
        `the token lacks the ${required} scope`,
      );
    }
    return Object.freeze({
      tokenId: verified.tokenId,
      userId: verified.userId,
      scopes: verified.scopes,
    });
  }

  /**
   * Answer one question, or refuse before a turn is ever opened.
   *
   * @param authorization - the raw `Authorization` header value.
   * @param request - the parsed body.
   * @param signal - the request's own lifetime; a dropped connection stops the wait.
   * @returns the answer the bridge publishes.
   */
  async ask(
    authorization: string | undefined,
    request: QaAskRequest,
    signal: AbortSignal,
  ): Promise<QaAskAnswer> {
    const config = this.deps.getConfig();
    if (!config.integration.enabled) {
      throw new QaIntegrationError(
        "unavailable",
        "the QA integration API is disabled on this deployment",
      );
    }
    const identity = this.authenticate(authorization, "ask");
    this.assertRate(identity.tokenId);
    if (this.inFlight >= config.integration.maxConcurrent) {
      throw new QaIntegrationError(
        "busy",
        "too many integration requests are being answered right now",
      );
    }

    const started = this.now();
    const deadline = new AbortController();
    const timer = setTimeout(() => {
      deadline.abort(new Error("integration request timed out"));
    }, config.integration.requestTimeoutMs);
    const combined = AbortSignal.any([signal, deadline.signal]);
    let chatId: string | null = request.sessionId;
    this.inFlight += 1;
    try {
      const turn = await this.deps.runner.run({
        userId: identity.userId,
        chatId: request.sessionId,
        message: request.message,
        attachments: request.attachments,
        ticketKey: request.context.ticketKey,
        signal: combined,
        onChat: (id) => {
          chatId = id;
        },
      });
      this.deps.logger.info("integration.answered", {
        tokenId: identity.tokenId,
        chatId: turn.chatId,
        ticketKey: request.context.ticketKey,
        attachments: request.attachments.length,
        ms: this.now() - started,
      });
      if (turn.interrupted) {
        // A cancelled or failed turn does commit a partial message. Publishing
        // it as "the answer" would put a truncated answer in front of a
        // customer; the bridge's escalation path is exactly for this.
        return this.escalated(turn.chatId, "turn interrupted");
      }
      const answer = boundAnswer(
        turn.answer.trim(),
        config.integration.maxAnswerCharacters,
      );
      if (answer === "") {
        return this.escalated(turn.chatId, "the assistant produced no answer");
      }
      if (answer.length < turn.answer.trim().length) {
        // The caller publishes into a comment with its own budget, so an
        // over-long answer is cut here, at a boundary it can read, instead of
        // there, mid-sentence and unannounced.
        this.deps.logger.warn("integration.answer_truncated", {
          tokenId: identity.tokenId,
          chatId: turn.chatId,
          published: answer.length,
        });
      }
      return Object.freeze({
        chatId: turn.chatId,
        answer,
        sources: sourceCitations(turn.sources),
        // "high" is deliberately never claimed: no model-side judgment backs
        // it, and a field that always says high teaches the operator to
        // ignore it.
        confidence: "medium" as const,
        escalate: false,
        reason: "",
      });
    } catch (error) {
      if (deadline.signal.aborted) {
        // The bridge's contract is a 90-second answer. Escalating with the
        // chat id keeps the still-running turn reachable: a retry that
        // started a new chat would orphan the answer being written.
        this.deps.logger.warn("integration.timeout", {
          tokenId: identity.tokenId,
          chatId,
          ms: this.now() - started,
        });
        return this.escalated(chatId ?? "", "the request timed out");
      }
      if (signal.aborted) {
        throw new QaIntegrationError("unavailable", "the request was dropped");
      }
      if (error instanceof QaIntegrationAttachmentError) {
        // The caller's own fallback signal: repeat the question without the
        // attachment it sent. Answering anyway would publish an answer to a
        // question the model never saw the material for.
        this.deps.logger.warn("integration.attachment-refused", {
          tokenId: identity.tokenId,
          chatId,
          name: error.attachment,
          reason: error.reason,
        });
        throw new QaIntegrationError("unsupported-media", error.message, {
          cause: error,
        });
      }
      this.deps.logger.error("integration.failed", {
        tokenId: identity.tokenId,
        chatId,
        message: error instanceof Error ? error.message : String(error),
      });
      // No answer was produced and no chat may even exist: this is a Host
      // failure, not an answer, so the bridge retries rather than escalating.
      throw new QaIntegrationError("unavailable", "the QA assistant failed", {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      this.inFlight -= 1;
    }
  }

  /**
   * Liveness and routing facts for the bridge's own UI.
   * @param authorization - the raw `Authorization` header value.
   * @returns the health payload; `ok` is true whenever it is answered at all.
   */
  async health(authorization: string | undefined): Promise<QaHealth> {
    this.authenticate(authorization, null);
    let models: readonly string[] = [];
    try {
      models = await this.deps.runner.models();
    } catch (error) {
      // A deployment with no routable provider is still a live deployment:
      // the health answer is owed, and the missing catalog is not a failure.
      this.deps.logger.warn("integration.models-unavailable", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return Object.freeze({
      ok: true,
      version: this.deps.version,
      models: Object.freeze([...models]),
      uptimeS: Math.max(0, Math.floor((this.now() - this.startedAt) / 1000)),
    });
  }

  /** One refusal shaped as an answer: empty text, escalated, no citations. */
  private escalated(chatId: string, reason: string): QaAskAnswer {
    return Object.freeze({
      chatId,
      answer: "",
      sources: Object.freeze([]),
      confidence: "low" as const,
      escalate: true,
      reason,
    });
  }

  /** Refuse with `rate-limited` once a token spends its minute's budget. */
  private assertRate(tokenId: string): void {
    const limit = this.deps.getConfig().integration.requestsPerMinute;
    const cutoff = this.now() - MINUTE_MS;
    const kept = (this.recent.get(tokenId) ?? []).filter((at) => at > cutoff);
    if (kept.length >= limit) {
      this.recent.set(tokenId, kept);
      throw new QaIntegrationError(
        "rate-limited",
        "this token exceeded its requests-per-minute budget",
      );
    }
    kept.push(this.now());
    this.recent.set(tokenId, kept);
  }
}

/**
 * The credential in one `Authorization` value, or null.
 *
 * `Bearer` is matched case-insensitively, as HTTP authentication schemes are,
 * and the token itself is never trimmed: whitespace inside a credential is
 * part of it, and accepting a padded variant would accept a token the store
 * never minted.
 * @param authorization - the raw header, when the caller sent one.
 * @returns the token, or null.
 */
export function bearerToken(authorization: string | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const match = /^Bearer[ \t]+(\S+)$/iu.exec(authorization.trim());
  return match?.[1] ?? null;
}
