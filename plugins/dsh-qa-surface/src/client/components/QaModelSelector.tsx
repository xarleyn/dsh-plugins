import {
  useQaModelSelection,
  qaModelKey as keyOf,
  type QaModelSelectionProps,
} from "../use-model-selection.js";

/** The server filters choices and persists selection on the native session. */
export function QaModelSelector(props: QaModelSelectionProps) {
  const {
    options,
    busy,
    error,
    selectedKey,
    selected: selectedEntry,
    disabled,
    select: change,
    reload,
  } = useQaModelSelection(props);

  // No picker for a fixed single model; failures remain visible and retryable.
  if (
    options !== undefined &&
    options.models.length <= 1 &&
    error === undefined
  )
    return null;
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
            onClick={reload}
          >
            Обновить модели
          </button>
        </div>
      )}
    </div>
  );
}
