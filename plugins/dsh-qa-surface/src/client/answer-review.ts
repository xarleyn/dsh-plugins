import type { SessionEventLike } from "@deepseek-ai/dsh-api-session-controller/client";
import type {
  ConversationNodeDefinition,
  ConversationSnapshot,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { QaAnswerReview } from "../types/answer-review.js";

export const QA_REVIEW_NODE = "qa-answer-review";

declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "qa-answer-review": QaAnswerReview;
  }
}

const statuses = new Set([
  "reviewing",
  "recovering",
  "pass",
  "revise",
  "failure",
  "cancelled",
  "waived",
]);
const sequence = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Read only the gate's producer metadata; answer prose never supplies a verdict. */
export function readAnswerReview(
  event: SessionEventLike,
): QaAnswerReview | null {
  if (event.type !== "user/message") return null;
  const source = (
    event.data as { source?: { kind?: unknown; receipt?: unknown } } | null
  )?.source;
  if (
    source?.kind !== "answer-review-status" ||
    source.receipt === null ||
    typeof source.receipt !== "object"
  )
    return null;
  return parseAnswerReview(source.receipt);
}

export function parseAnswerReview(receipt: unknown): QaAnswerReview | null {
  if (receipt === null || typeof receipt !== "object") return null;
  const value = receipt as Partial<QaAnswerReview>;
  if (
    value.version !== 1 ||
    !sequence(value.candidateSeq) ||
    !(value.requestSeq === null || sequence(value.requestSeq)) ||
    typeof value.candidateHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.candidateHash) ||
    !sequence(value.round) ||
    typeof value.at !== "number" ||
    !Number.isFinite(value.at) ||
    value.at < 0 ||
    typeof value.status !== "string" ||
    !statuses.has(value.status)
  )
    return null;
  return value as QaAnswerReview;
}

function requireReview(event: SessionEventLike): QaAnswerReview {
  const value = readAnswerReview(event);
  if (value === null) throw new Error("Invalid answer review receipt");
  return value;
}

/** One current result per human request, with the latest answer's anchor. */
export const answerReviewConversationDefinition: ConversationNodeDefinition<QaAnswerReview> =
  {
    kind: QA_REVIEW_NODE,
    target: "chat",
    match(event) {
      const receipt = readAnswerReview(event);
      return receipt === null
        ? null
        : {
            id: String(receipt.requestSeq ?? receipt.candidateSeq),
            role: "start",
          };
    },
    start: (_context, match) => requireReview(match.event),
    update: (_context, match) => requireReview(match.event),
    buildViewNode(context) {
      if (context.state === undefined) return null;
      const anchor = context.matches.at(-1);
      return {
        key: context.key,
        id: context.id,
        kind: QA_REVIEW_NODE,
        target: "chat",
        anchorSeq: anchor?.event.seq ?? 0,
        location: anchor?.location ?? { kind: "unresolved" },
        visibility: "visible",
        data: context.state,
      };
    },
  };

export function answerReviewsOf(
  snapshot: ConversationSnapshot | undefined,
): ReadonlyMap<number, QaAnswerReview> {
  const receipts = new Map<number, QaAnswerReview>();
  for (const node of snapshot?.views.get("chat")?.nodes?.values() ?? []) {
    if (node.kind === QA_REVIEW_NODE) {
      const receipt = parseAnswerReview(node.data);
      if (receipt !== null) receipts.set(receipt.candidateSeq, receipt);
    }
  }
  return receipts;
}
