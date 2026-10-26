import { z } from "zod";
import { QaFormError } from "./errors.js";
import type {
  QaFormAnswer,
  QaFormAnswerSpec,
  QaFormFieldError,
  QaFormPolicy,
  QaFormRecord,
} from "./types.js";

export const formAnswerParser = z.union([
  z.object({ type: z.enum(["text", "textarea"]), text: z.string() }).strict(),
  z
    .object({
      type: z.enum(["single_select", "multi_select"]),
      selected: z.array(z.string()),
      other_text: z.string().optional(),
    })
    .strict(),
]);
/** Requiredness is checked at navigation/submit; invalid supplied values fail even if optional. */
export function normalizeFormAnswer(
  spec: QaFormAnswerSpec | undefined,
  raw: unknown,
  policy: Readonly<QaFormPolicy>,
  requireComplete = false,
): QaFormAnswer | null {
  const invalid = () => {
    throw new QaFormError("INVALID_ANSWER", "Check the answer and its limits.");
  };
  if (raw === undefined || raw === null) {
    if (requireComplete && spec?.required) invalid();
    return null;
  }
  if (spec === undefined) return invalid();
  const parsed = formAnswerParser.safeParse(raw);
  if (!parsed.success || parsed.data.type !== spec.type) return invalid();
  const a = parsed.data;
  if ("text" in a && (spec.type === "text" || spec.type === "textarea")) {
    const text = a.text.trim(),
      length = Array.from(text).length;
    if (length === 0) {
      if (requireComplete && spec.required) invalid();
      return null;
    }
    if (
      length < (spec.min_length ?? 0) ||
      length >
        Math.min(spec.max_length ?? policy.maxTextLength, policy.maxTextLength)
    )
      return invalid();
    return { type: a.type, text };
  }
  if (!("selected" in a) || !("options" in spec)) return invalid();
  const other = a.other_text?.trim() ?? "";
  if (
    other &&
    (!spec.allow_other || Array.from(other).length > policy.maxTextLength)
  )
    return invalid();
  if (
    new Set(a.selected).size !== a.selected.length ||
    a.selected.some((v) => !spec.options.some((o) => o.value === v))
  )
    return invalid();
  const count = a.selected.length + (other ? 1 : 0);
  if (count === 0) {
    if (requireComplete && spec.required) return invalid();
    return null;
  }
  if (
    spec.type === "single_select"
      ? count !== 1
      : count < (spec.min_selected ?? 1) ||
        count >
          (spec.max_selected ??
            spec.options.length + (spec.allow_other ? 1 : 0))
  )
    return invalid();
  return {
    type: a.type,
    selected: a.selected,
    ...(other ? { other_text: other } : {}),
  };
}

export function validateForm(
  record: QaFormRecord,
  policy: Readonly<QaFormPolicy>,
  stepId?: string,
): QaFormFieldError[] {
  const errors: QaFormFieldError[] = [];
  for (const step of record.schema.steps) {
    if (stepId !== undefined && step.id !== stepId) continue;
    for (const item of step.items) {
      const error = (
        component: "answer" | "files",
        code: string,
        message: string,
      ) =>
        errors.push({
          step_id: step.id,
          item_id: item.id,
          component,
          code,
          message,
        });
      try {
        normalizeFormAnswer(item.answer, record.answers[item.id], policy, true);
      } catch {
        error(
          "answer",
          "ANSWER_INVALID",
          `Ответьте на вопрос «${item.title}» и проверьте ограничения.`,
        );
      }
      const f = item.files,
        active = record.attachments[item.id] ?? [];
      if (
        record.uploads.some(
          (u) =>
            u.item_id === item.id &&
            ["pending", "uploading", "failed"].includes(u.state),
        )
      )
        error(
          "files",
          "UPLOAD_UNRESOLVED",
          "Дождитесь загрузки, повторите её или уберите файл.",
        );
      if (f.requirement === "none") {
        if (active.length)
          error(
            "files",
            "FILES_NOT_ALLOWED",
            "Файлы для этого пункта запрещены.",
          );
      } else {
        if (active.length < (f.requirement === "required" ? f.min_count : 0))
          error(
            "files",
            "REQUIRED_FILES_MISSING",
            `Приложите файлы к пункту «${item.title}».`,
          );
        if (
          active.length > f.max_count ||
          new Set(active.map((a) => a.sha256)).size !== active.length ||
          active.some(
            (a) =>
              a.size_bytes <= 0 ||
              a.size_bytes >
                Math.min(f.max_file_size_bytes, policy.maxFileSizeBytes) ||
              !f.accept.some((ext) => a.name.toLowerCase().endsWith(ext)) ||
              !policy.allowedExtensions.some((ext) =>
                a.name.toLowerCase().endsWith(ext),
              ),
          )
        )
          error(
            "files",
            "FILES_INVALID",
            "Проверьте форматы, размеры и количество файлов.",
          );
      }
    }
  }
  return errors;
}
