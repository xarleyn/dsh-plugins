import type { QaQueueStatus } from "../../types.js";

/** A queued turn belongs to the Host and starts without resending the question. */
export function QaRequestWait({
  status,
}: {
  readonly status: QaQueueStatus | null;
}) {
  if (status?.managed !== true || status.waiting !== true) return null;
  const estimate = status.estimatedWaitMs;
  return (
    <div
      className="dsh-qa-request-wait"
      data-testid="qa-request-wait"
      role="status"
      aria-live="polite"
    >
      <span className="dsh-qa-request-wait__spinner" aria-hidden="true" />
      <span>
        Запрос в очереди
        {status.position == null
          ? ""
          : ` · Место в очереди: ${String(status.position)}`}
        {estimate == null
          ? ""
          : estimate < 60000
            ? " · Примерное ожидание — меньше минуты"
            : ` · Примерное ожидание — ${String(Math.ceil(estimate / 60000))} мин`}
      </span>
    </div>
  );
}
