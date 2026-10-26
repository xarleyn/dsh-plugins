import type { QaFormFieldError, QaFormResult } from "./types.js";

export class QaFormError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly revision?: number,
    readonly fields?: QaFormFieldError[],
  ) {
    super(message);
  }
}
/** Deliberately redact unexpected storage/Host exceptions at the wire boundary. */
export function formFailure(error: unknown): QaFormResult<never> {
  return {
    ok: false,
    error:
      error instanceof QaFormError
        ? {
            code: error.code,
            message: error.message,
            ...(error.revision === undefined
              ? {}
              : { form_revision: error.revision }),
            ...(error.fields === undefined
              ? {}
              : { field_errors: error.fields }),
          }
        : {
            code: "STORAGE_UNAVAILABLE",
            message:
              "Form storage is unavailable. Retry without discarding your draft.",
          },
  };
}
export function formAssert(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new QaFormError(code, message);
}
