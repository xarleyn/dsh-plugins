/**
 * QA-facing copy for provider failures, keyed by the stable failure code the
 * host records on retry and turn-end events. Raw provider messages never
 * reach these rows — they can carry stack traces and local paths — so every
 * text here derives from the code alone.
 */

/** Short cause label used inside the retry row copy. */
function failureCause(code: string | undefined): string {
  switch (code) {
    case "TRANSPORT":
      return "обрыв связи";
    case "STREAM_CLOSED":
      return "поток оборвался";
    case "TIMEOUT":
      return "таймаут провайдера";
    case "RATE_LIMIT":
      return "лимит запросов";
    case "SERVER":
      return "ошибка провайдера";
    case "EMPTY_RESPONSE":
      return "пустой ответ";
    case undefined:
      return "сбой";
    default:
      return `сбой (${code})`;
  }
}

/** Terminal turn-failure row shown after the work group. */
export function turnErrorCopy(code: string | undefined): string {
  switch (code) {
    case "TRANSPORT":
    case "STREAM_CLOSED":
    case "TIMEOUT":
      return "Обрыв связи с провайдером. Ответ не сохранился — отправь запрос ещё раз.";
    case "RATE_LIMIT":
      return "Провайдер ограничил частоту запросов — попытки исчерпаны. Попробуй ещё раз через минуту.";
    case "QUOTA":
      return "Квота провайдера исчерпана — сообщи оператору стенда.";
    case "AUTH":
      return "Провайдер отклонил доступ (ключ или права) — сообщи оператору стенда.";
    case "SERVER":
      return "Провайдер вернул ошибку сервера — попытки исчерпаны. Попробуй ещё раз позже.";
    default:
      return "Помощнику не удалось завершить ответ.";
  }
}

export interface RetryCopySource {
  readonly mode: "normal" | "always";
  readonly retry: number;
  readonly maxRetries?: number;
  readonly delayMs: number;
  readonly retryState: "scheduled" | "started" | "cancelled";
  readonly failureCode?: string;
}

/** Work-group row for one host-scheduled model-request retry. */
export function retryWorkCopy(node: RetryCopySource): string {
  const attempt =
    node.mode === "normal" && typeof node.maxRetries === "number"
      ? `${node.retry} из ${node.maxRetries}`
      : `${node.retry} (без лимита)`;
  switch (node.retryState) {
    case "scheduled": {
      const seconds = Math.max(1, Math.round(node.delayMs / 1_000));
      return `Сбой запроса к провайдеру (${failureCause(node.failureCode)}) — повторная попытка ${attempt} через ${seconds} с`;
    }
    case "started":
      return `Сбой запроса к провайдеру (${failureCause(node.failureCode)}) — повторная попытка ${attempt} выполняется`;
    case "cancelled":
      return `Повторная попытка ${attempt} отменена (ход прерван)`;
  }
}
