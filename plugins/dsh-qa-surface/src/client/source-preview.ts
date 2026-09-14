/**
 * Panel copy for a refused source preview. The Host answers with the shared
 * `(reason: <code>)` marker, so the panel can say what actually happened
 * instead of telling every audience that a file which is present moved away.
 */

/** The `(reason: <code>)` marker the Host folds into preview wire failures. */
const PREVIEW_REASON_MARKER = /\(reason: ([a-z-]+)\)/u;

function failureMessage(failure: unknown): string {
  const message = (failure as { readonly message?: unknown } | undefined)
    ?.message;
  return typeof message === "string" ? message : String(failure ?? "");
}

/** The sentence behind one failed preview request, keyed by the Host reason. */
export function sourcePreviewFailureCopy(failure: unknown): string {
  const reason = PREVIEW_REASON_MARKER.exec(failureMessage(failure))?.[1];
  if (reason === "outside-roots") {
    return "Этот файл лежит вне каталогов, доступных для предпросмотра: открыть можно рабочую папку чата, общие каталоги только для чтения и вложения.";
  }
  if (reason === "not-evidence") {
    return "Источник больше не входит в доказательства этого чата — открой его из ответа заново.";
  }
  return "Не удалось открыть источник. Возможно, файл был перемещён или больше недоступен.";
}
