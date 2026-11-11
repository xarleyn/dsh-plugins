import { useEffect, useRef, useState } from "react";
import type { QaModelOptions, QaModelPair } from "../../types.js";
import type { QaAccessApi } from "../types.js";

const keyOf = (pair: QaModelPair): string =>
  JSON.stringify([pair.provider, pair.model]);

/** The server filters choices and persists selection on the native session. */
export function QaModelSelector(props: {
  readonly api: NonNullable<QaAccessApi["userModels"]>;
  readonly token: string;
  readonly sessionId: string | null;
  readonly subroleId: string | null;
  readonly preview: boolean;
  readonly disabled: boolean;
  readonly onSelect: (pair: QaModelPair) => Promise<string>;
}) {
  const [options, setOptions] = useState<QaModelOptions>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const revision = ++generation.current;
    setOptions(undefined);
    setError(undefined);
    void props
      .api(props.token, props.sessionId, props.subroleId, props.preview)
      .then((result) => {
        if (generation.current !== revision) return;
        if (result.ok) setOptions(result.value);
        else setError("Не удалось загрузить доступные модели.");
      })
      .catch(() => {
        if (generation.current === revision)
          setError("Не удалось загрузить доступные модели.");
      });
    return () => {
      generation.current++;
    };
  }, [
    props.api,
    props.token,
    props.sessionId,
    props.subroleId,
    props.preview,
    retry,
  ]);

  // No picker for a fixed single model; failures remain visible and retryable.
  if (
    options !== undefined &&
    options.models.length <= 1 &&
    error === undefined
  )
    return null;
  const selectedKey =
    options?.selected === undefined ? "" : keyOf(options.selected);
  const selectedEntry = options?.models.find(
    (entry) => keyOf(entry) === selectedKey,
  );
  const disabled = props.disabled || busy || options === undefined;
  const change = async (key: string) => {
    const pair = options?.choices.find((entry) => keyOf(entry) === key);
    if (pair === undefined || key === selectedKey) return;
    setBusy(true);
    setError(undefined);
    try {
      const id = await props.onSelect(pair);
      const revision = ++generation.current;
      const result = await props.api(
        props.token,
        id,
        props.subroleId,
        props.preview,
      );
      if (revision !== generation.current) return;
      if (!result.ok) throw new Error("Не удалось обновить выбранную модель.");
      setOptions(result.value);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Не удалось сменить модель.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="dsh-qa-model-selector"
      data-testid="qa-model-selector"
      aria-busy={busy || (options === undefined && error === undefined)}
    >
      <label
        className="dsh-qa-model-selector__control"
        data-disabled={disabled}
        title="Выбрать модель чата"
      >
        <span
          className="dsh-qa-model-selector__name"
          aria-hidden="true"
          data-testid="qa-model-selector-name"
        >
          {selectedEntry?.label ??
            (options === undefined ? "Загрузка…" : "Выбрать модель")}
        </span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
        <select
          aria-label="Модель чата"
          data-testid="qa-model-selector-input"
          value={selectedKey}
          disabled={disabled}
          onChange={(event) => void change(event.currentTarget.value)}
        >
          {!options?.models.some((entry) => keyOf(entry) === selectedKey) ? (
            <option value={selectedKey}>
              {options === undefined
                ? "Загружаю модели…"
                : "Текущая модель недоступна"}
            </option>
          ) : null}
          {options?.models.map((entry) => (
            <option key={keyOf(entry)} value={keyOf(entry)}>
              {entry.label}
              {options.models.some(
                (other) => other !== entry && other.label === entry.label,
              )
                ? ` (${entry.provider})`
                : ""}
              {options.defaultModel !== undefined &&
              keyOf(entry) === keyOf(options.defaultModel)
                ? " · по умолчанию"
                : ""}
            </option>
          ))}
        </select>
      </label>
      {busy ? (
        <span className="dsh-qa-sr-only" role="status">
          Меняю модель…
        </span>
      ) : null}
      {error === undefined ? null : (
        <div className="dsh-qa-model-selector__error">
          <span role="alert" data-testid="qa-model-selector-error">
            {error}
          </span>
          <button
            type="button"
            data-testid="qa-model-selector-retry"
            disabled={busy || props.disabled}
            onClick={() => setRetry((value) => value + 1)}
          >
            Обновить модели
          </button>
        </div>
      )}
    </div>
  );
}
