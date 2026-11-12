/** Operator-owned policy, shared by the Host resolver and settings controls. */
export interface QaFileWritePolicy {
  readonly blockedExtensions: readonly string[];
  readonly message: string;
}

export const QA_FILE_WRITE_EXTENSION_PATTERN =
  /^\s*\.?[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\s*$/iu;

export const DEFAULT_QA_FILE_WRITE_POLICY: QaFileWritePolicy = Object.freeze({
  blockedExtensions: Object.freeze([".py", ".pyw"]),
  message:
    "Запись файлов этого типа запрещена настройками QA. Не создавайте и не запускайте обходные скрипты. Используйте доступные инструменты для работы с документами и таблицами; если нужной операции нет, сообщите об ограничении.",
});

/** Normalize exact suffixes; wildcard and path rules are deliberately unsupported. */
export function resolveFileWritePolicy(
  input?: Partial<QaFileWritePolicy>,
): QaFileWritePolicy {
  const extensions =
    input?.blockedExtensions ?? DEFAULT_QA_FILE_WRITE_POLICY.blockedExtensions;
  if (!Array.isArray(extensions) || extensions.length > 100)
    throw new Error(
      "tools.fileWritePolicy.blockedExtensions must be an array of at most 100 extensions",
    );
  const normalized = extensions.map((value: unknown) => {
    if (
      typeof value !== "string" ||
      !QA_FILE_WRITE_EXTENSION_PATTERN.test(value) ||
      value.length > 64
    )
      throw new Error(
        "tools.fileWritePolicy.blockedExtensions must contain extensions such as .py, without paths or wildcards",
      );
    const extension = value.trim().toLowerCase();
    return extension.startsWith(".") ? extension : `.${extension}`;
  });
  const message = input?.message ?? DEFAULT_QA_FILE_WRITE_POLICY.message;
  if (
    typeof message !== "string" ||
    message.trim() === "" ||
    message.length > 4000
  )
    throw new Error(
      "tools.fileWritePolicy.message must be non-empty and at most 4000 characters",
    );
  return Object.freeze({
    blockedExtensions: Object.freeze([...new Set(normalized)]),
    message: message.trim(),
  });
}
