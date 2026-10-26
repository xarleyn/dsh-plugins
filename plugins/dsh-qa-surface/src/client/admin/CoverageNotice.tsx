import type { QaQualityMetrics } from "../../types.js";

/** A missing journal cannot be presented as a conversation with no answers. */
export function CoverageNotice({
  metrics,
}: {
  readonly metrics: QaQualityMetrics;
}) {
  const coverage = metrics.coverage;
  if (coverage === undefined || coverage.complete) return null;
  return (
    <p
      className="dsh-qa-admin__empty"
      data-testid="qa-admin-coverage-notice"
      role="status"
    >
      Прочитаны журналы {coverage.readConversations} из{" "}
      {coverage.totalConversations} разговоров. Счётчик ответов неполный; доля
      оценённых ответов пока не рассчитана. Оценки пользователей учтены
      полностью. Нажмите «Обновить», чтобы продолжить чтение.
    </p>
  );
}
