import type {
  QaFormCommand,
  QaFormResult,
  QaFormView,
} from "../forms/types.js";
import type { RemoteResult } from "./types.js";
import type { QaUploadCarrier } from "./account-upload.js";

/** Typert adds an outer transport result; domain refusals remain stable codes. */
export interface QaFormApi {
  list(
    token: string,
    session: string,
  ): Promise<RemoteResult<QaFormResult<QaFormView[]>>>;
  get(
    token: string,
    session: string,
    id: string,
  ): Promise<RemoteResult<QaFormResult<QaFormView>>>;
  mutate(
    token: string,
    session: string,
    command: QaFormCommand,
  ): Promise<RemoteResult<QaFormResult<QaFormView>>>;
  upload(
    token: string,
    session: string,
    id: string,
    file: File,
    signal: AbortSignal,
  ): Promise<void>;
  file(
    token: string,
    session: string,
    formId: string,
    resourceId: string,
  ): Promise<
    RemoteResult<
      QaFormResult<{ name: string; media_type: string; data: string }>
    >
  >;
}
export class QaFormClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function unwrapForm<T>(result: RemoteResult<QaFormResult<T>>): T {
  if (!result.ok)
    throw new QaFormClientError(
      "TRANSPORT_UNAVAILABLE",
      "Связь с сервером прервана. Изменения ещё не подтверждены.",
    );
  if (!result.value.ok)
    throw new QaFormClientError(
      result.value.error.code,
      result.value.error.message,
    );
  return result.value.value;
}
/** Same protected carrier and route as ordinary QA uploads; no fabricated percentage. */
export async function uploadQaFormFile(
  carrier: QaUploadCarrier | undefined,
  token: string,
  session: string,
  uploadId: string,
  file: File,
  signal: AbortSignal,
): Promise<void> {
  if (!carrier || !token)
    throw new QaFormClientError(
      "INTERACTION_UNAVAILABLE",
      "Загрузка файлов недоступна.",
    );
  const query = new URLSearchParams({
    sessionId: session,
    formUploadId: uploadId,
  });
  const response = await carrier.post({
    path: `api/qa-chat-upload?${query}`,
    body: file,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
    },
    signal,
  });
  const result: unknown = JSON.parse(response.body);
  if (
    response.status !== 200 ||
    typeof result !== "object" ||
    result === null ||
    !("ok" in result) ||
    result.ok !== true
  )
    throw new QaFormClientError(
      "UPLOAD_FAILED",
      "Не удалось загрузить файл. Проверьте сохранённое состояние, повторите или уберите загрузку.",
    );
}
