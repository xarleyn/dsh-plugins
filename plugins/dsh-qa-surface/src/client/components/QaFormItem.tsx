import { useRef } from "react";
import { useQaFileDrop } from "../use-qa-file-drop.js";
import type {
  QaFormAnswer,
  QaFormItem as Item,
  QaFormAttachment,
  QaFormUpload,
  QaFormFieldError,
} from "../../forms/types.js";

interface Props {
  item: Item;
  answer: QaFormAnswer | null;
  files: QaFormAttachment[];
  uploads: QaFormUpload[];
  errors?: QaFormFieldError[];
  disabled: boolean;
  onAnswer(answer: QaFormAnswer | null): void;
  onUpload(
    file: File,
    target?: { attachment_id: string; version: number },
  ): void;
  onRemove(file: QaFormAttachment): void;
  onCancel(upload: QaFormUpload): void;
  onOpen(file: QaFormAttachment): void;
}

export function formFileSize(bytes: number): string {
  const unit = bytes >= 1048576 ? "МБ" : bytes >= 1024 ? "КБ" : "Б";
  const value = bytes / (unit === "МБ" ? 1048576 : unit === "КБ" ? 1024 : 1);
  return `${new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

/** Each item's answers, file requirements and validation stay in one visual group. */
export function QaFormItem(props: Props) {
  const fileZone = useRef<HTMLDivElement>(null);
  const { item, answer, disabled } = props,
    a = item.answer;
  const required = a?.required || item.files.requirement === "required";
  const choice = a && "options" in a ? a : undefined;
  const selected = answer && "selected" in answer ? answer.selected : [];
  const other =
    answer && "other_text" in answer ? (answer.other_text ?? "") : "";
  const inputId = `qa-form-answer-${item.id}`;
  const helpId = `${inputId}-help`,
    errorId = `${inputId}-errors`;
  const errors = props.errors ?? [];
  const answerHelp =
    a && (a.type === "text" || a.type === "textarea")
      ? [
          a.min_length ? `От ${a.min_length} символов` : "",
          a.max_length ? `До ${a.max_length} символов` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : choice?.type === "multi_select"
        ? `Выберите ${choice.min_selected ?? (choice.required ? 1 : 0)}${choice.max_selected ? `–${choice.max_selected}` : " или больше"} вариантов`
        : choice
          ? "Выберите один вариант"
          : "";
  const filePolicy = item.files.requirement === "none" ? undefined : item.files;
  const pending = props.uploads.filter(
    (u) => u.state === "pending" || u.state === "uploading",
  ).length;
  const full =
    filePolicy !== undefined &&
    props.files.length + pending >= filePolicy.max_count;
  useQaFileDrop({
    element: fileZone,
    canDrop: () => !disabled && !full,
    onFiles: (files) => {
      for (const file of files) props.onUpload(file);
    },
  });
  return (
    <fieldset
      className="dsh-qa-form__item"
      disabled={disabled}
      aria-describedby={errors.length ? errorId : undefined}
    >
      <legend className="dsh-qa-form__item-title title-4">
        <span>{item.title}</span>
        <span className="dsh-qa-form__badge caption-5">
          {required ? "Обязательно" : "Необязательно"}
        </span>
      </legend>
      {item.description && (
        <p className="dsh-qa-form__description">{item.description}</p>
      )}
      {a && (
        <p id={helpId} className="dsh-qa-form__hint">
          {[answerHelp, !a.required ? "Ответ можно оставить пустым" : ""]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {a && (a.type === "text" || a.type === "textarea") && (
        <label className="dsh-qa-form__answer" htmlFor={inputId}>
          <span className="dsh-qa-sr-only">{item.title}</span>
          {a.type === "textarea" ? (
            <textarea
              id={inputId}
              rows={3}
              placeholder={a.placeholder}
              aria-describedby={helpId}
              aria-invalid={
                errors.some((e) => e.component === "answer") || undefined
              }
              value={answer && "text" in answer ? answer.text : ""}
              onChange={(e) =>
                props.onAnswer({ type: a.type, text: e.target.value })
              }
            />
          ) : (
            <input
              id={inputId}
              type="text"
              placeholder={a.placeholder}
              aria-describedby={helpId}
              aria-invalid={
                errors.some((e) => e.component === "answer") || undefined
              }
              value={answer && "text" in answer ? answer.text : ""}
              onChange={(e) =>
                props.onAnswer({ type: a.type, text: e.target.value })
              }
            />
          )}
        </label>
      )}
      {choice && (
        <div className="dsh-qa-form__choices">
          {choice.options.map((o) => (
            <label
              key={o.value}
              className={`dsh-qa-form__choice${selected.includes(o.value) ? " is-selected" : ""}`}
            >
              <input
                type={choice.type === "single_select" ? "radio" : "checkbox"}
                name={inputId}
                checked={selected.includes(o.value)}
                onChange={(e) =>
                  props.onAnswer({
                    type: choice.type,
                    selected:
                      choice.type === "single_select"
                        ? [o.value]
                        : e.target.checked
                          ? [...selected, o.value]
                          : selected.filter((v) => v !== o.value),
                    ...(choice.type === "multi_select" && other
                      ? { other_text: other }
                      : {}),
                  })
                }
              />
              <span className="dsh-qa-form__choice-copy">
                <span className="title-4">
                  {o.label}
                  {o.recommended && (
                    <span className="dsh-qa-form__recommended caption-5">
                      Рекомендуется
                    </span>
                  )}
                </span>
                {o.description && (
                  <span className="dsh-qa-form__hint">{o.description}</span>
                )}
              </span>
            </label>
          ))}
          {choice.allow_other && (
            <label className="dsh-qa-form__other">
              <span className="title-4">Свой вариант</span>
              <input
                type="text"
                value={other}
                placeholder="Укажите свой вариант"
                onChange={(e) =>
                  props.onAnswer({
                    type: choice.type,
                    selected:
                      choice.type === "single_select" && e.target.value
                        ? []
                        : selected,
                    other_text: e.target.value,
                  })
                }
              />
            </label>
          )}
          {!choice.required && (
            <button
              type="button"
              className="dsh-qa-form__text-button"
              onClick={() => props.onAnswer(null)}
            >
              Очистить ответ
            </button>
          )}
        </div>
      )}
      {filePolicy && (
        <div ref={fileZone} className="dsh-qa-form__files">
          <div className="dsh-qa-form__file-heading">
            <span className="title-4">
              {filePolicy.requirement === "required"
                ? "Обязательные файлы"
                : "Дополнительные файлы"}
            </span>
            <span className="dsh-qa-form__badge caption-5">
              {props.files.length} из {filePolicy.max_count}
            </span>
          </div>
          <p className="dsh-qa-form__hint">
            {filePolicy.requirement === "required"
              ? filePolicy.max_count === 1
                ? "Прикрепите один файл, чтобы продолжить."
                : `Прикрепите от ${filePolicy.min_count} до ${filePolicy.max_count} файлов.`
              : "Можно продолжить без вложений."}
          </p>
          <p className="dsh-qa-form__hint">
            {filePolicy.accept.join(", ")} · до{" "}
            {formFileSize(filePolicy.max_file_size_bytes)} на файл
          </p>
          <div className="dsh-qa-form__dropzone">
            <label
              className={`dsh-qa-form__picker${full ? " is-disabled" : ""}`}
            >
              <span>
                {filePolicy.max_count === 1
                  ? "Прикрепить файл"
                  : "Прикрепить файлы"}
              </span>
              <input
                type="file"
                aria-label={`Прикрепить файлы: ${item.title}`}
                disabled={full}
                multiple={filePolicy.max_count > 1}
                accept={filePolicy.accept.join(",")}
                onChange={(e) => {
                  for (const f of Array.from(e.target.files ?? []))
                    props.onUpload(f);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="dsh-qa-form__hint">
              {full
                ? "Лимит достигнут. Файл можно заменить или убрать."
                : "или перетащите файлы в этот блок"}
            </span>
          </div>
          {props.files.length > 0 && (
            <ul className="dsh-qa-form__file-list">
              {props.files.map((f) => (
                <li key={f.attachment_id} className="dsh-qa-form__file-row">
                  <div className="dsh-qa-form__file-copy">
                    <span className="title-4">{f.name}</span>
                    <span className="dsh-qa-form__hint">
                      {formFileSize(f.size_bytes)} · Загружен · Версия{" "}
                      {f.version}
                    </span>
                  </div>
                  <div className="dsh-qa-form__file-actions">
                    <button type="button" onClick={() => props.onOpen(f)}>
                      Открыть
                    </button>
                    <label className="dsh-qa-form__picker dsh-qa-form__picker--small">
                      <span>Заменить</span>
                      <input
                        type="file"
                        aria-label={`Заменить ${f.name}`}
                        accept={filePolicy.accept.join(",")}
                        onChange={(e) => {
                          const next = e.target.files?.[0];
                          if (next)
                            props.onUpload(next, {
                              attachment_id: f.attachment_id,
                              version: f.version,
                            });
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      aria-label={`Убрать ${f.name} из пункта`}
                      onClick={() => props.onRemove(f)}
                    >
                      Убрать
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {props.uploads
            .filter((u) => !["ready", "cancelled"].includes(u.state))
            .map((u) => (
              <div key={u.id} className="dsh-qa-form__upload" role="status">
                <span className="title-4">{u.name}</span>
                <span className="dsh-qa-form__hint">
                  {u.state === "failed"
                    ? "Не удалось загрузить файл"
                    : "Передача и проверка…"}
                </span>
                <div className="dsh-qa-form__file-actions">
                  {u.state === "failed" && (
                    <label className="dsh-qa-form__picker dsh-qa-form__picker--small">
                      <span>Повторить загрузку</span>
                      <input
                        type="file"
                        aria-label={`Повторить загрузку ${u.name}`}
                        accept={filePolicy.accept.join(",")}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            props.onCancel(u);
                            props.onUpload(f, u.target);
                          }
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  <button type="button" onClick={() => props.onCancel(u)}>
                    {u.state === "failed"
                      ? "Убрать загрузку"
                      : "Отменить загрузку"}
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
      {errors.length > 0 && (
        <div id={errorId} className="dsh-qa-form__field-errors">
          {errors.map((e) => (
            <p key={`${e.component}:${e.code}`}>{e.message}</p>
          ))}
        </div>
      )}
    </fieldset>
  );
}
