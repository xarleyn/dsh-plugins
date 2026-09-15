/**
 * Copy shared by the provider cards: both render the same failure taxonomy and
 * the same timestamps, and only the provider-specific wording differs.
 */
export function dateTime(value: string | null): string {
  return value === null
    ? "ещё не проверялось"
    : new Date(value).toLocaleString("ru-RU");
}

export function failureCopy(
  copy: Readonly<Record<string, string>>,
  error: unknown,
): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { readonly message: unknown }).message)
      : String(error ?? "");
  const reason = /\(reason: ([A-Za-z]+)\)/u.exec(message)?.[1];
  const fallback = "Не удалось выполнить действие. Попробуйте ещё раз.";
  return reason === undefined ? fallback : (copy[reason] ?? fallback);
}
