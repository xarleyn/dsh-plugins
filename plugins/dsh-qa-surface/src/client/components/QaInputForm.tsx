import { useCallback, useEffect, useRef, useState } from "react";
import type {
  QaFormAnswer,
  QaFormAttachment,
  QaFormCommand,
  QaFormView,
} from "../../forms/types.js";
import { DEFAULT_FORM_POLICY } from "../../forms/schema.js";
import { validateForm } from "../../forms/validation.js";
import { QaFormClientError, unwrapForm, type QaFormApi } from "../forms.js";
import { QaFormItem, formFileSize } from "./QaFormItem.js";

interface Props {
  policy?: Readonly<import("../../forms/types.js").QaFormPolicy>;
  api: QaFormApi;
  session: string;
  token: string;
  form: QaFormView;
  canStop: boolean;
  onStop(): Promise<void>;
  onResume(id: string): void;
  onTakeover(active: boolean): void;
  onDismiss?(): void;
}

function stepTitle(title: string, index: number): string {
  return title.replace(new RegExp(`^\\s*${index + 1}[.)]\\s*`, "u"), "");
}
type Operation =
  | { action: "save"; answers: Record<string, unknown>; step: number }
  | { action: "submit" | "pause" }
  | {
      action: "begin_upload";
      item_id: string;
      name: string;
      size_bytes: number;
      target?: { attachment_id: string; version: number };
    }
  | { action: "cancel_upload"; upload_id: string }
  | {
      action: "remove";
      item_id: string;
      attachment_id: string;
      version: number;
    };

export function QaInputForm(props: Props) {
  const [record, setRecord] = useState(props.form),
    current = useRef(props.form);
  const [answers, setAnswers] = useState<Record<string, QaFormAnswer | null>>(
    props.form.answers,
  );
  const local = useRef(answers),
    dirty = useRef(false),
    conflict = useRef(false);
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [collapsed, setCollapsed] = useState(!props.form.waiting);
  const [hidden, setHidden] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [record.step]);
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const reveal = () => {
      const active = nav.querySelector<HTMLElement>("[aria-current=step]");
      if (!active) return;
      const row = nav.getBoundingClientRect(),
        button = active.getBoundingClientRect();
      const after = button.right - row.right + 16,
        before = button.left - row.left - 16;
      if (after > 0) nav.scrollLeft += after;
      else if (before < 0) nav.scrollLeft += before;
    };
    reveal();
    window.addEventListener("resize", reveal);
    return () => window.removeEventListener("resize", reveal);
  }, [record.step, record.status, collapsed]);
  const queue = useRef<Promise<unknown>>(Promise.resolve()),
    alive = useRef(true);
  const transfers = useRef(new Map<string, AbortController>());
  const previousWaiting = useRef(props.form.waiting);
  const [download, setDownload] = useState<{ url: string; name: string }>();
  const update = useCallback((r: QaFormView) => {
    if (!alive.current) return;
    current.current = r;
    setRecord(r);
    if (!dirty.current) {
      local.current = r.answers;
      setAnswers(r.answers);
    }
  }, []);
  useEffect(() => {
    if (record.waiting && !previousWaiting.current) setCollapsed(false);
    previousWaiting.current = record.waiting;
  }, [record.waiting]);
  useEffect(() => {
    alive.current = true;
    const active = transfers.current;
    return () => {
      alive.current = false;
      for (const a of active.values()) a.abort();
    };
  }, []);
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url);
    },
    [download],
  );
  useEffect(() => {
    props.onTakeover(record.status === "draft" && !collapsed);
    return () => props.onTakeover(false);
  }, [record.status, collapsed, props.onTakeover]);
  const report = useCallback((e: unknown) => {
    if (!alive.current) return;
    if (e instanceof QaFormClientError && e.code === "REVISION_CONFLICT")
      conflict.current = true;
    setError(
      e instanceof Error ? e.message : "Операция не подтверждена сервером.",
    );
  }, []);
  const mutate = useCallback(
    (op: Operation): Promise<QaFormView> => {
      const work = queue.current
        .catch(() => undefined)
        .then(async () => {
          if (conflict.current)
            throw new QaFormClientError(
              "REVISION_CONFLICT",
              "Форма изменилась в другом окне. Загрузите актуальное состояние перед повторным применением своих ответов.",
            );
          const command = {
            ...op,
            form_id: current.current.id,
            expected_revision: current.current.revision,
            mutation_id: crypto.randomUUID(),
          } as QaFormCommand;
          const r = unwrapForm(
            await props.api.mutate(props.token, props.session, command),
          );
          update(r);
          return r;
        });
      queue.current = work;
      return work;
    },
    [props.api, props.token, props.session, update],
  );
  const save = useCallback(
    async (step = current.current.step) => {
      if (!dirty.current && step === current.current.step)
        return current.current;
      const snapshot = local.current;
      setSaving(true);
      try {
        const r = await mutate({ action: "save", answers: snapshot, step });
        if (local.current === snapshot) dirty.current = false;
        if (alive.current) setError("");
        return r;
      } finally {
        if (alive.current) setSaving(false);
      }
    },
    [mutate],
  );
  useEffect(() => {
    if (!dirty.current || record.status !== "draft") return;
    const timer = setTimeout(() => {
      void save().catch(report);
    }, 650);
    return () => clearTimeout(timer);
  }, [answers, record.status, save, report]);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const r = unwrapForm(
          await props.api.get(props.token, props.session, props.form.id),
        );
        if (!stopped && !saving && r.revision >= current.current.revision) {
          if (
            dirty.current &&
            r.revision > current.current.revision &&
            transfers.current.size === 0
          ) {
            conflict.current = true;
            setError(
              "Форма изменилась в другом окне. Ваши несохранённые ответы сохранены в этом окне для повторного применения.",
            );
          }
          update(r);
        }
      } catch (e) {
        if (!stopped) report(e);
      }
    };
    const timer = setInterval(() => {
      void refresh();
    }, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [
    props.api,
    props.token,
    props.session,
    props.form.id,
    saving,
    update,
    report,
  ]);
  const action = (work: () => Promise<unknown>) => {
    void work().catch(report);
  };
  const open = (file: QaFormAttachment) =>
    action(async () => {
      const value = unwrapForm(
        await props.api.file(
          props.token,
          props.session,
          record.id,
          file.resource_id,
        ),
      );
      if (!alive.current) return;
      const bytes = Uint8Array.from(atob(value.data), (c) => c.charCodeAt(0));
      setDownload({
        url: URL.createObjectURL(new Blob([bytes], { type: value.media_type })),
        name: value.name,
      });
    });
  const upload = async (
    item: string,
    file: File,
    target?: { attachment_id: string; version: number },
  ) => {
    const r = await mutate({
      action: "begin_upload",
      item_id: item,
      name: file.name,
      size_bytes: file.size,
      ...(target ? { target } : {}),
    });
    const intent = r.uploads.at(-1)!;
    const abort = new AbortController();
    transfers.current.set(intent.id, abort);
    let failure: unknown;
    try {
      await props.api.upload(
        props.token,
        props.session,
        intent.id,
        file,
        abort.signal,
      );
    } catch (e) {
      failure = e;
    } finally {
      transfers.current.delete(intent.id);
    }
    if (!alive.current) return;
    const saved = unwrapForm(
      await props.api.get(props.token, props.session, r.id),
    );
    update(saved);
    if (saved.uploads.find((u) => u.id === intent.id)?.state === "ready") {
      setError("");
      return;
    }
    if (failure !== undefined) throw failure;
    throw new QaFormClientError(
      "UPLOAD_FAILED",
      "Загрузка не подтверждена сервером. Повторите её или уберите файл.",
    );
  };
  const step = record.schema.steps[record.step],
    review = step === undefined;
  const required = record.schema.steps
    .flatMap((s) => s.items)
    .filter((i) => i.answer?.required || i.files.requirement === "required");
  const fieldErrors = validateForm(
    { ...record, answers },
    props.policy ?? DEFAULT_FORM_POLICY,
  );
  const incomplete = new Set(fieldErrors.map((e) => e.item_id));
  const blocked = fieldErrors.some((e) => review || e.step_id === step?.id);
  const stop = () => {
    for (const a of transfers.current.values()) a.abort();
    void props.onStop().catch(report);
  };
  if (hidden) return null;
  if (record.status === "submitted")
    return (
      <section
        className="dsh-qa-form dsh-qa-form--summary"
        aria-label={record.schema.title}
      >
        <div>
          <strong className="title-3">{record.schema.title}</strong>
          <p className="dsh-qa-form__hint">
            Данные переданы агенту
            {record.submission?.submitted_at
              ? ` · ${new Date(record.submission.submitted_at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </p>
        </div>
        <button
          type="button"
          aria-label="Скрыть отправленную форму"
          onClick={() => {
            setHidden(true);
            props.onDismiss?.();
          }}
        >
          Скрыть
        </button>
      </section>
    );
  if (collapsed)
    return (
      <section className="dsh-qa-form dsh-qa-form--summary">
        <div>
          <strong className="title-3">{record.schema.title}</strong>
          <p className="dsh-qa-form__hint">
            Черновик сохранён. Сбор данных не завершён.
          </p>
        </div>
        <div className="dsh-qa-form__file-actions">
          <button type="button" onClick={() => setCollapsed(false)}>
            Открыть форму
          </button>
          {!record.waiting && (
            <button type="button" onClick={() => props.onResume(record.id)}>
              Продолжить с агентом
            </button>
          )}
        </div>
      </section>
    );
  return (
    <section className="dsh-qa-form" aria-label={record.schema.title}>
      <header>
        <div className="dsh-qa-form__heading">
          <strong className="title-3">{record.schema.title}</strong>
          {record.schema.description && (
            <p className="dsh-qa-form__description">
              {record.schema.description}
            </p>
          )}
        </div>
        <span className="dsh-qa-form__badge caption-5">
          {review
            ? "Проверка перед отправкой"
            : `Шаг ${record.step + 1} из ${record.schema.steps.length}`}
        </span>
      </header>
      <div className="dsh-qa-form__status" role="status">
        <span>
          Обязательные пункты:{" "}
          {required.filter((i) => !incomplete.has(i.id)).length} из{" "}
          {required.length}
        </span>
        <span>
          {saving
            ? "Сохранение…"
            : dirty.current
              ? "Есть несохранённые изменения"
              : "Черновик сохранён"}{" "}
        </span>
        <span>
          {record.waiting
            ? "Агент ожидает данные"
            : "Агент не ожидает — сохранённый черновик"}
        </span>
      </div>
      <nav aria-label="Шаги формы" ref={navigation}>
        {record.schema.steps.map((s, index) => (
          <button
            key={s.id}
            type="button"
            aria-current={index === record.step ? "step" : undefined}
            disabled={saving}
            onClick={() => action(() => save(index))}
          >
            <span className="dsh-qa-form__step-number">{index + 1}</span>
            <span>{stepTitle(s.title, index)}</span>
          </button>
        ))}
      </nav>
      <div className="dsh-qa-form__content" ref={content}>
        {error && (
          <div role="alert">
            <p>{error}</p>
            {conflict.current && (
              <button
                type="button"
                onClick={() =>
                  action(async () => {
                    await queue.current.catch(() => undefined);
                    const r = unwrapForm(
                      await props.api.get(
                        props.token,
                        props.session,
                        record.id,
                      ),
                    );
                    update(r);
                    conflict.current = false;
                    await save();
                  })
                }
              >
                Загрузить актуальное и повторить мои ответы
              </button>
            )}
          </div>
        )}
        {download && (
          <p>
            <a href={download.url} download={download.name}>
              Скачать {download.name}
            </a>{" "}
            <a href={download.url} target="_blank" rel="noopener noreferrer">
              Открыть файл
            </a>
          </p>
        )}
        {review ? (
          <div className="dsh-qa-form__review">
            <h3 className="title-3">Проверьте данные</h3>
            {record.schema.steps.map((s) => (
              <div key={s.id} className="dsh-qa-form__review-step">
                <h4 className="title-3">{s.title}</h4>
                {s.items.map((i) => {
                  const a = answers[i.id];
                  return (
                    <div key={i.id} className="dsh-qa-form__review-item">
                      <strong className="title-4">{i.title}</strong>
                      {i.answer && (
                        <p>
                          {a
                            ? "text" in a
                              ? a.text
                              : [
                                  ...a.selected.map((v) =>
                                    i.answer && "options" in i.answer
                                      ? (i.answer.options.find(
                                          (o) => o.value === v,
                                        )?.label ?? v)
                                      : v,
                                  ),
                                  a.other_text,
                                ]
                                  .filter(Boolean)
                                  .join(", ")
                            : "Ответ не указан"}
                        </p>
                      )}
                      {(record.attachments[i.id] ?? []).map((f) => (
                        <p key={f.resource_id}>
                          {f.name} · {formFileSize(f.size_bytes)} · версия{" "}
                          {f.version}
                        </p>
                      ))}
                      {!a &&
                        !record.attachments[i.id]?.length &&
                        !incomplete.has(i.id) && (
                          <p>Необязательный пункт оставлен пустым</p>
                        )}
                      {fieldErrors
                        .filter((e) => e.item_id === i.id)
                        .map((e) => (
                          <p
                            className="dsh-qa-form__field-errors"
                            key={`${e.component}:${e.code}`}
                          >
                            {e.message}
                          </p>
                        ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="dsh-qa-form__step">
            <div className="dsh-qa-form__step-heading">
              <h3 className="title-3">{stepTitle(step.title, record.step)}</h3>
              {step.description && (
                <p className="dsh-qa-form__description">{step.description}</p>
              )}
            </div>
            {step.items.map((item) => (
              <QaFormItem
                key={item.id}
                item={item}
                answer={answers[item.id] ?? null}
                files={record.attachments[item.id] ?? []}
                uploads={record.uploads.filter((u) => u.item_id === item.id)}
                errors={fieldErrors.filter((e) => e.item_id === item.id)}
                disabled={false}
                onAnswer={(answer) => {
                  dirty.current = true;
                  local.current = { ...local.current, [item.id]: answer };
                  setAnswers(local.current);
                }}
                onUpload={(file, target) =>
                  action(() => upload(item.id, file, target))
                }
                onCancel={(u) => {
                  transfers.current.get(u.id)?.abort();
                  action(() =>
                    mutate({ action: "cancel_upload", upload_id: u.id }),
                  );
                }}
                onRemove={(f) =>
                  action(() =>
                    mutate({
                      action: "remove",
                      item_id: item.id,
                      attachment_id: f.attachment_id,
                      version: f.version,
                    }),
                  )
                }
                onOpen={open}
              />
            ))}
          </div>
        )}
      </div>
      <footer>
        {blocked && (
          <p className="dsh-qa-form__hint">
            {review
              ? "Исправьте отмеченные пункты перед отправкой."
              : "Заполните обязательные поля и приложите нужные файлы этого шага."}
          </p>
        )}
        <div className="dsh-qa-form__actions">
          <div className="dsh-qa-form__navigation">
            <button
              type="button"
              disabled={record.step === 0 || saving}
              onClick={() => action(() => save(record.step - 1))}
            >
              Назад
            </button>
            <button
              type="button"
              className="dsh-qa-form__primary"
              disabled={saving || blocked}
              onClick={() =>
                action(async () => {
                  await save();
                  if (review) {
                    await mutate({ action: "submit" });
                  } else {
                    await save(record.step + 1);
                  }
                })
              }
            >
              {review
                ? (record.schema.submit_label ?? "Передать данные")
                : "Далее"}
            </button>
          </div>
          <div className="dsh-qa-form__secondary">
            <button
              type="button"
              onClick={() =>
                action(async () => {
                  await save();
                  await mutate({ action: "pause" });
                  setCollapsed(true);
                })
              }
            >
              Сохранить и выйти
            </button>
            {props.canStop && (
              <button type="button" onClick={stop}>
                Остановить
              </button>
            )}
          </div>
        </div>
      </footer>
    </section>
  );
}

/** Session/identity-keyed parent discards account-local state and aborts transfers on switch. */
export function QaInputForms(props: Omit<Props, "form">) {
  const [forms, setForms] = useState<QaFormView[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const dismissKey = `dsh-qa-surface:forms:hidden:${props.session}`;
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const saved: unknown = JSON.parse(
        sessionStorage.getItem(dismissKey) ?? "[]",
      );
      return new Set(
        Array.isArray(saved)
          ? saved.filter((id): id is string => typeof id === "string")
          : [],
      );
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const list = unwrapForm(
          await props.api.list(props.token, props.session),
        );
        if (active) {
          setForms(list);
          setLoadError(false);
        }
      } catch {
        if (active) setLoadError(true);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1500);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [props.api, props.token, props.session, retry]);
  const form = forms.find((r) => r.status === "draft") ?? forms[0];
  return (
    <>
      {loadError && (
        <div role="alert" className="dsh-qa-error">
          <span>
            Не удалось загрузить пошаговые формы. Проверьте соединение и
            повторите загрузку.
          </span>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Повторить загрузку форм
          </button>
        </div>
      )}
      {form && !dismissed.has(form.id) && (
        <QaInputForm
          key={form.id}
          {...props}
          form={form}
          onDismiss={() => {
            const next = new Set(dismissed).add(form.id);
            setDismissed(next);
            try {
              sessionStorage.setItem(dismissKey, JSON.stringify([...next]));
            } catch {
              /* The current page can still dismiss when browser storage is unavailable. */
            }
          }}
        />
      )}
    </>
  );
}
