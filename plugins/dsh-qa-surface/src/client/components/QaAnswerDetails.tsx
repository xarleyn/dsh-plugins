import type {
  QaAnswerReview,
  QaMessage,
  QaSource,
  QaTurnSources,
} from "../../types.js";
import { QaAnswerReviewStatus } from "./QaAnswerReviewStatus.js";

export type QaOpenAnswerSources = (
  sources: readonly QaSource[],
  complete: boolean,
  incompleteOrigins: QaTurnSources["incompleteOrigins"],
) => void;

/** Actions and review status share one wrapping line under the answer. */
export function QaAnswerDetails({
  message,
  onOpenSources,
  onOpenReview,
}: {
  readonly message: Extract<QaMessage, { role: "assistant" }>;
  readonly onOpenSources?: QaOpenAnswerSources | undefined;
  readonly onOpenReview?: ((review: QaAnswerReview) => void) | undefined;
}) {
  const sources = message.sources;
  const showSources = onOpenSources && sources && sources.length > 0;
  if (!showSources && !message.review) return null;
  return (
    <div className="dsh-qa-message__details">
      {showSources && (
        <button
          type="button"
          className="dsh-qa-message__detail-action"
          data-testid="qa-message-sources"
          onClick={() =>
            onOpenSources(
              sources,
              message.sourcesComplete ?? true,
              message.incompleteSourceOrigins,
            )
          }
        >
          Источники ({sources.length})
        </button>
      )}
      {message.review && (
        <QaAnswerReviewStatus review={message.review} onOpen={onOpenReview} />
      )}
    </div>
  );
}
