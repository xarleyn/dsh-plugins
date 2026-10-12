/** Host-recorded review of one immutable assistant message. */
export interface QaAnswerReview {
  readonly version: 1;
  readonly candidateSeq: number;
  readonly candidateHash: string;
  readonly requestSeq: number | null;
  readonly round: number;
  readonly status:
    | "reviewing"
    | "recovering"
    | "pass"
    | "revise"
    | "failure"
    | "cancelled"
    | "waived";
  readonly at: number;
}
