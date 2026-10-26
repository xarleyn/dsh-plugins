import type {
  QaFormAnswer,
  QaFormItem as Item,
  QaFormAttachment,
  QaFormUpload,
} from "../../forms/types.js";

interface Props {
  item: Item;
  answer: QaFormAnswer | null;
  files: QaFormAttachment[];
  uploads: QaFormUpload[];
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
/** Input requirements are separate from file requirements, including in the labels. */
export function QaFormItem(props: Props) {
  const { item, answer, disabled } = props,
    a = item.answer;
  const required = a?.required || item.files.requirement === "required";
  const choice = a && "options" in a ? a : undefined;
  const selected = answer && "selected" in answer ? answer.selected : [];
  const other =
    answer && "other_text" in answer ? (answer.other_text ?? "") : "";
  const inputId = `qa-form-answer-${item.id}`;
  return (
    <fieldset className="dsh-qa-form__item" disabled={disabled}>
      <legend>
        {item.title}{" "}
        <small>
          {required ? "Обязательно" : "Необязательно — можно оставить пустым"}
        </small>
      </legend>
      {item.description && <p>{item.description}</p>}
      {a && (
        <p className="dsh-qa-form__hint">
          {a.required ? "Ответ обязателен." : "Ответ можно оставить пустым."}{" "}
          {"min_length" in a && a.min_length
            ? `Минимум ${a.min_length} символов.`
            : ""}
        </p>
      )}
      {a && (a.type === "text" || a.type === "textarea") && (
        <label htmlFor={inputId}>
          <span className="dsh-qa-form__hint">Ваш ответ</span>
          {a.type === "textarea" ? (
            <textarea
              id={inputId}
              rows={3}
              placeholder={a.placeholder}
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
            <label key={o.value}>
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
              <span>
                {o.label}
                {o.recommended ? " · Рекомендуется" : ""}
                {o.description && <small>{o.description}</small>}
              </span>
            </label>
          ))}
          {choice.allow_other && (
            <label>
              Свой вариант
              <input
                type="text"
                value={other}
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
            <button type="button" onClick={() => props.onAnswer(null)}>
              Очистить ответ
            </button>
          )}
        </div>
      )}
      {item.files.requirement !== "none" && (
        <div
          className="dsh-qa-form__files"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!disabled)
              for (const f of Array.from(e.dataTransfer.files))
                props.onUpload(f);
          }}
        >
          <p>
            {item.files.requirement === "required"
              ? `Приложите ${item.files.min_count}–${item.files.max_count} файлов.`
              : `Файлы необязательны, до ${item.files.max_count}.`}{" "}
            {item.files.accept.join(", ")} · до{" "}
            {Math.floor(item.files.max_file_size_bytes / 1048576)} МиБ
          </p>
          <label>
            Добавить файлы или перетащить сюда
            <input
              type="file"
              multiple
              accept={item.files.accept.join(",")}
              onChange={(e) => {
                for (const f of Array.from(e.target.files ?? []))
                  props.onUpload(f);
                e.target.value = "";
              }}
            />
          </label>
          <ul>
            {props.files.map((f) => (
              <li key={f.attachment_id}>
                <span>
                  {f.name} · {f.size_bytes} Б · версия {f.version} · Готов
                </span>
                <button type="button" onClick={() => props.onOpen(f)}>
                  Открыть
                </button>
                <label>
                  Заменить
                  <input
                    type="file"
                    aria-label={`Заменить ${f.name}`}
                    accept={
                      item.files.requirement === "none"
                        ? ""
                        : item.files.accept.join(",")
                    }
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
                <button type="button" onClick={() => props.onRemove(f)}>
                  Убрать из пункта
                </button>
              </li>
            ))}
          </ul>
          {props.uploads
            .filter((u) => !["ready", "cancelled"].includes(u.state))
            .map((u) => (
              <div key={u.id} role="status">
                <span>
                  {u.name} ·{" "}
                  {u.state === "failed"
                    ? "Ошибка загрузки"
                    : "Передача и проверка…"}
                </span>
                {u.state === "failed" && (
                  <label>
                    Повторить: выберите файл
                    <input
                      type="file"
                      aria-label={`Повторить загрузку ${u.name}`}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          props.onCancel(u);
                          props.onUpload(f, u.target);
                        }
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
            ))}
        </div>
      )}
    </fieldset>
  );
}
