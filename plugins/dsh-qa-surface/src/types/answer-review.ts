/** Host-recorded review of one immutable assistant message. */
export interface QaAnswerReview {
  readonly documents?: readonly {
    readonly name: string;
    readonly sha256: string;
    readonly sourceSha256: readonly string[];
  }[];
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

/** Phase displayed above the input for the latest Host turn. */
export type QaComposerActivity =
  QaAnswerReview["status"] | "writing" | "stopped";
