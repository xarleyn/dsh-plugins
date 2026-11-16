import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import { bindSettingsExternalStore } from "@yadsh/dsh-plugin-kit/client";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";

import type { LightRagConfig } from "../config.js";
import { QUERY_MODES } from "../settings.js";
import {
  draftMutations,
  NUMBER_FIELDS,
  toDraft,
  validateDraft,
  type Draft,
} from "./draft.js";

export interface LightRagCardFace {
  readonly settingsForm: ConfigForm<LightRagConfig>;
}
export type LightRagCardProps = PropsRuntime<"plugins.row.config"> &
  InjectFace<LightRagCardFace>;

export function LightRagCard({
  settingsForm,
}: LightRagCardProps): ReactElement {
  const store = useMemo(
    () => bindSettingsExternalStore(settingsForm),
    [settingsForm],
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [base, setBase] = useState(() => ({
    draft: toDraft(snapshot.value),
    revision: snapshot.revision,
  }));
  const [draft, setDraft] = useState(base.draft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const dirty = JSON.stringify(base.draft) !== JSON.stringify(draft);
  const writable = snapshot.status === "ready" && snapshot.writable;
  const disabled = !writable || saving;
  const validation = validateDraft(draft);

  useEffect(() => {
    if (dirty || saving) return;
    const next = toDraft(snapshot.value);
    setBase({ draft: next, revision: snapshot.revision });
    setDraft(next);
  }, [snapshot.value, snapshot.revision, dirty, saving]);

  function edit<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
    setFailed(false);
  }

  async function save(): Promise<void> {
    if (disabled || validation !== undefined || !dirty) return;
    setSaving(true);
    setMessage("");
    try {
      const accepted = await settingsForm.mutate(
        draftMutations(base.draft, draft),
        base.revision,
      );
      if (!accepted) {
        setFailed(true);
        setMessage(
          "Настройки не сохранены. Проверьте доступ или нажмите «Отменить», чтобы загрузить актуальные значения.",
        );
        return;
      }
      const current = settingsForm.getSnapshot();
      const next = toDraft(current.value);
      setBase({ draft: next, revision: current.revision });
      setDraft(next);
      setFailed(false);
      setMessage("Настройки сохранены и применены к новым вызовам.");
    } catch {
      setFailed(true);
      setMessage(
        "Не удалось сохранить настройки. Проверьте подключение и повторите попытку.",
      );
    } finally {
      setSaving(false);
    }
  }

  const field = (
    label: string,
    hint: string,
    control: ReactNode,
  ): ReactElement => (
    <label className="dsh-lightrag-field">
      <span>{label}</span>
      {control}
      <span className="dsh-lightrag-hint">{hint}</span>
    </label>
  );
  const numberField = (
    key: (typeof NUMBER_FIELDS)[number]["key"],
  ): ReactElement => {
    const spec = NUMBER_FIELDS.find((entry) => entry.key === key)!;
    const testId = `lightrag-${key.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
    return field(
      spec.label,
      `${spec.hint} От ${spec.min} до ${spec.max}. Пустое поле возвращает значение из конфигурации развёртывания.`,
      <input
        type="number"
        className="dsh-lightrag-control"
        data-testid={testId}
        value={draft[key]}
        min={spec.min}
        max={spec.max}
        step={1}
        disabled={disabled}
        onChange={(event) => edit(key, event.target.value)}
      />,
    );
  };
  const toggle = (
    key: "enabled" | "writesEnabled",
    label: string,
    hint: string,
  ): ReactElement => (
    <label className="dsh-lightrag-toggle-row">
      <span className="dsh-lightrag-toggle-copy">
        <strong>{label}</strong>
        <span>{hint}</span>
      </span>
      <input
        type="checkbox"
        className="dsh-lightrag-toggle"
        checked={draft[key]}
        disabled={disabled}
        data-testid={
          key === "enabled" ? "lightrag-enabled" : "lightrag-writes-enabled"
        }
        onChange={(event) => edit(key, event.target.checked)}
      />
    </label>
  );

  if (snapshot.status !== "ready") {
    return (
      <p className="dsh-lightrag-notice" role="status">
        {snapshot.status === "unavailable"
          ? "Настройки LightRAG недоступны в этом профиле."
          : "Загрузка настроек LightRAG…"}
      </p>
    );
  }
  return (
    <form
      className="dsh-lightrag-body"
      data-testid="lightrag-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {!writable && (
        <p className="dsh-lightrag-notice" role="status">
          Настройки доступны только для чтения. Для изменения нужен доступ
          оператора.
        </p>
      )}
      <section className="dsh-lightrag-section">
        <h3>Подключение</h3>
        {toggle(
          "enabled",
          "Инструменты LightRAG",
          "Разрешить агентам поиск, просмотр документов и проверку состояния базы знаний.",
        )}
        {field(
          "Адрес сервера",
          "Адрес доступен с машины, где запущен Harness. Только http(s), хост и порт, без /query и других путей.",
          <input
            type="text"
            className="dsh-lightrag-control"
            data-testid="lightrag-endpoint"
            autoComplete="url"
            value={draft.endpoint}
            placeholder="http://127.0.0.1:9621"
            disabled={disabled}
            onChange={(event) => edit("endpoint", event.target.value)}
          />,
        )}
        <div className="dsh-lightrag-grid">
          {field(
            "API-ключ",
            "Передаётся как X-API-Key. Пустое значение использует LIGHTRAG_API_KEY на сервере.",
            <input
              type="password"
              className="dsh-lightrag-control"
              data-testid="lightrag-api-key"
              autoComplete="new-password"
              value={draft.apiKey}
              disabled={disabled}
              onChange={(event) => edit("apiKey", event.target.value)}
            />,
          )}
          {numberField("timeoutMs")}
        </div>
      </section>
      <section className="dsh-lightrag-section">
        <h3>Поиск и документы</h3>
        <div className="dsh-lightrag-grid">
          {field(
            "Режим поиска",
            "local: сущности; global: связи; hybrid: оба; naive: векторы; mix: граф и векторы; bypass: ответ модели без поиска.",
            <select
              className="dsh-lightrag-control"
              data-testid="lightrag-query-mode"
              value={draft.mode}
              disabled={disabled}
              onChange={(event) => edit("mode", event.target.value)}
            >
              {QUERY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>,
          )}
          {numberField("topK")}
          {numberField("maxAnswerBytes")}
          {numberField("maxListed")}
        </div>
      </section>
      <section className="dsh-lightrag-section">
        <h3>Запись в базу знаний</h3>
        {toggle(
          "writesEnabled",
          "Разрешить запись",
          "Добавляет инструменты вставки текста, сканирования и удаления документов. По умолчанию выключено.",
        )}
        <p className="dsh-lightrag-hint">
          Удаление изменяет общую базу знаний. Доступ к инструментам также
          должен быть разрешён политикой развёртывания.
        </p>
        {numberField("maxTextBytes")}
      </section>
      {dirty && validation && (
        <p className="dsh-lightrag-notice" role="alert">
          {validation}
        </p>
      )}
      {message && (
        <p className="dsh-lightrag-notice" role={failed ? "alert" : "status"}>
          {message}
        </p>
      )}
      <div className="dsh-lightrag-actions">
        <button
          type="submit"
          className="dsh-lightrag-btn"
          data-testid="lightrag-save"
          disabled={disabled || !dirty || validation !== undefined}
        >
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        <button
          type="button"
          className="dsh-lightrag-btn"
          data-testid="lightrag-cancel"
          disabled={saving || !dirty}
          onClick={() => {
            const next = toDraft(snapshot.value);
            setBase({ draft: next, revision: snapshot.revision });
            setDraft(next);
            setMessage("");
            setFailed(false);
          }}
        >
          Отменить
        </button>
        <span className="dsh-lightrag-hint">
          {dirty
            ? "Есть несохранённые изменения"
            : "Изменения применяются после сохранения"}
        </span>
      </div>
    </form>
  );
}
