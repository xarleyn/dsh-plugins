import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { DocumentSubject } from "./document-evidence.js";
import type { ReviewIssue, ReviewVerdict } from "./types.js";

export type ReviewStatus =
  | "reviewing"
  | "recovering"
  | "pass"
  | "revise"
  | "failure"
  | "cancelled"
  | "waived";

export interface ReviewReceiptDetails {
  readonly summary: string;
  readonly issues: readonly Pick<
    ReviewIssue,
    "severity" | "claim" | "problem" | "requiredFix"
  >[];
  readonly omittedIssues: number;
}

/** Metadata and the displayable verdict about one immutable answer version. */
export interface ReviewReceipt {
  readonly details?: ReviewReceiptDetails;
  readonly documents?: readonly DocumentSubject[];
  readonly version: 1;
  readonly candidateSeq: number;
  readonly candidateHash: string;
  readonly requestSeq: number | null;
  readonly round: number;
  readonly status: ReviewStatus;
  readonly at: number;
}

const MAX_RECEIPT_ISSUES = 16;
const MAX_RECEIPT_TEXT = 2_000;

function receiptText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_RECEIPT_TEXT
    ? trimmed
    : `${trimmed.slice(0, MAX_RECEIPT_TEXT).trimEnd()}…`;
}

/** Keep the verdict separate from model context and bounded for chat history. */
export function reviewReceiptDetails(
  verdict: ReviewVerdict,
): ReviewReceiptDetails {
  return {
    summary: receiptText(verdict.summary),
    issues: verdict.issues.slice(0, MAX_RECEIPT_ISSUES).map((issue) => ({
      severity: issue.severity,
      claim: receiptText(issue.claim),
      problem: receiptText(issue.problem),
      requiredFix: receiptText(issue.requiredFix),
    })),
    omittedIssues: Math.max(0, verdict.issues.length - MAX_RECEIPT_ISSUES),
  };
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
      {
        type: "text",
        text: receipt.documents?.length
          ? `Independent document review: ${receipt.status}. ${receipt.documents.map((d) => `${d.name} (SHA-256 ${d.sha256})`).join(", ")}`
          : `Independent answer review: ${receipt.status}.`,
      },
    ],
    source: {
      kind: REVIEW_STATUS_SOURCE,
      form: "notice",
      summary: "Independent answer review status",
      receipt,
    },
  });
}
