import type { QaSkillDiagnostic, QaSkillDiagnosticCode } from "../../types.js";

/**
 * Audience-facing copy for the settings dialog. The Host sends stable codes
 * and never Russian prose, so every message a user reads is written here.
 */

/** One message per diagnostic code; `detail` carries the offending value. */
export function diagnosticMessage(diagnostic: QaSkillDiagnostic): string {
  const detail = diagnostic.detail ?? "";
  return DIAGNOSTIC_COPY[diagnostic.code](detail);
}

const DIAGNOSTIC_COPY: Record<
  QaSkillDiagnosticCode,
  (detail: string) => string
> = {
  "name-required": () => "Укажите название навыка.",
  "name-invalid": () =>
    "Название может содержать только строчные латинские буквы, цифры и дефисы (до 64 символов).",
  "name-mismatch": (detail) =>
    `В файле указано имя «${detail}». Сохраните навык, чтобы имя файла и каталога совпали.`,
  "description-required": () =>
    "Добавьте описание: по нему ассистент понимает, когда применять навык.",
  "description-too-long": (detail) =>
    `Описание длиннее ${detail} символов — ассистент увидит только начало.`,
  "when-to-use-too-long": (detail) =>
    `Поле «Когда использовать» длиннее ${detail} символов.`,
  "field-type-invalid": (detail) =>
    detail === ""
      ? "Одно из полей имеет неподдерживаемый тип и не будет сохранено."
      : `Поле «${detail}» имеет неподдерживаемый тип и не будет сохранено.`,
  "invocation-never": () =>
    "Навык сейчас недоступен ни ассистенту, ни вам: включите хотя бы один вариант.",
  "invocation-invalid": (detail) =>
    `Поле «${detail}» должно быть true или false.`,
  "invocation-legacy-key": (detail) =>
    `Поле «${detail}» устарело и мешает DSH прочитать навык. Замените его на disable-model-invocation.`,
  "allowed-tools-invalid": () =>
    "Поле allowed-tools заполнено в неподдерживаемом формате. Перечислите инструменты через пробел.",
  "tool-name-invalid": (detail) =>
    `Редактор не распознал имена инструментов: ${detail}.`,
  "tool-unavailable": (detail) =>
    `Инструмент ${detail} сейчас недоступен в этой конфигурации. Он останется в файле.`,
  "tools-too-many": (detail) =>
    `В одном навыке можно указать не больше ${detail} инструментов.`,
  "file-too-large": (detail) =>
    `Файл навыка превышает предел ${detail} байт. Сократите инструкции.`,
  "frontmatter-missing": () =>
    "В файле нет блока frontmatter: без него DSH не увидит навык. Сохранение создаст его.",
  "frontmatter-invalid": (detail) =>
    detail === ""
      ? "Не удалось разобрать frontmatter файла."
      : `Не удалось разобрать frontmatter файла: ${detail}.`,
  "skill-file-missing": () =>
    "Файл SKILL.md отсутствует. Сохранение создаст его заново.",
  "unknown-field": (detail) =>
    `Поле «${detail}» незнакомо редактору и сохраняется как есть.`,
  "resource-unsupported": (detail) =>
    `Файл «${detail}» редактор не изменяет и сохраняет как есть.`,
};

/** Wire-safe failure reasons the Host may answer with. */
const REASON_COPY: Record<string, string> = {
  "auth-required": "Сессия истекла. Войдите заново.",
  "skills-disabled": "Навыки отключены на этом стенде.",
  "skill-not-found":
    "Навык не найден: возможно, его удалили или переименовали.",
  "skill-exists": "Навык с таким названием уже есть.",
  "skill-conflict":
    "Навык был изменён в другом месте. Перезагрузите текущую версию или сохраните копию.",
  "skill-name-invalid":
    "Название может содержать только строчные латинские буквы, цифры и дефисы.",
  "skill-invalid": "Не удалось сохранить навык: проверьте поля ниже.",
  "storage-unavailable":
    "Хранилище навыков недоступно. Обратитесь к администратору стенда.",
  "workspace-unavailable":
    "Рабочий каталог вашего аккаунта недоступен. Обратитесь к администратору стенда.",
};

const REASON_MARKER = /\(reason: ([a-z-]+)\)/u;
const GENERIC_FAILURE = "Не удалось выполнить действие. Попробуйте ещё раз.";

/**
 * Turn one remote refusal into copy. The Host folds domain failures into a
 * `(reason: <code>)` marker on the wire message; anything else — a transport
 * fault, an unknown code — reads as the generic failure.
 */
export function skillFailureCopy(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { readonly message: unknown }).message)
      : typeof error === "string"
        ? error
        : "";
  const reason = REASON_MARKER.exec(message)?.at(1);
  if (reason === undefined) return GENERIC_FAILURE;
  return REASON_COPY[reason] ?? GENERIC_FAILURE;
}

/** Whether a failure is the optimistic-concurrency refusal. */
export function isSkillConflict(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { readonly message: unknown }).message)
      : typeof error === "string"
        ? error
        : "";
  return REASON_MARKER.exec(message)?.at(1) === "skill-conflict";
}

export const SKILLS_EMPTY_COPY = {
  title: "У вас пока нет навыков.",
  body: "Навык — это набор инструкций, который помогает ассистенту стабильно выполнять повторяющиеся задачи.",
  action: "Создать первый навык",
} as const;

export const SKILLS_TOOLS_HINT =
  "Инструменты, которые использует этот навык. Они не предоставляют дополнительных разрешений.";

export const SKILLS_DESCRIPTION_HINT =
  "Кратко опишите, что делает навык и в каких ситуациях его стоит использовать.";

export const SKILLS_NAME_HINT =
  "Строчные латинские буквы, цифры и дефисы. Например: jira-investigation.";

export const SKILLS_BEHAVIOUR_HINT =
  "«Автоматически» значит, что ассистент может применить навык сам, когда задача совпадёт с описанием. Содержимое навыка не хранится в контексте постоянно.";
