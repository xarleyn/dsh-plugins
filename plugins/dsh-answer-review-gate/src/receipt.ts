import { createUserMessage } from "@deepseek-ai/dsh-llm";

export type ReviewStatus =
  | "reviewing"
  | "recovering"
  | "pass"
  | "revise"
  | "failure"
  | "cancelled"
  | "waived";

/** Metadata about one immutable answer version, never a copy of its content. */
export interface ReviewReceipt {
  readonly version: 1;
  readonly candidateSeq: number;
  readonly candidateHash: string;
  readonly requestSeq: number | null;
  readonly round: number;
  readonly status: ReviewStatus;
  readonly at: number;
}

export const REVIEW_STATUS_SOURCE = "answer-review-status";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "answer-review-status": {
      readonly kind: typeof REVIEW_STATUS_SOURCE;
      readonly form: "notice";
      readonly summary: string;
      readonly receipt: ReviewReceipt;
    };
  }
}

/** A standard producer notice remains readable by older Host log readers. */
export function reviewStatusNotice(receipt: ReviewReceipt) {
  return createUserMessage({
    content: [
      { type: "text", text: `Independent answer review: ${receipt.status}.` },
    ],
    source: {
      kind: REVIEW_STATUS_SOURCE,
      form: "notice",
      summary: "Independent answer review status",
      receipt,
    },
  });
}
