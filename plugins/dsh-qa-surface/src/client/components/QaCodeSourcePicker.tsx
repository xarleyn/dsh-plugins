import type { QaChatCodeSources } from "../../types/code-sources.js";

export function QaCodeSourcePicker(props: {
  readonly value: QaChatCodeSources;
  readonly pending: boolean;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly onSelect: (source: string | null) => Promise<void>;
}) {
  if (props.value.entries.length === 0 && !props.value.unavailable) return null;
  return (
    <div className="dsh-qa-code-source" data-testid="qa-code-source-picker">
      <label>
        <span>Версия кода</span>
        <select
          aria-label="Версия кода"
          value={props.value.selectedSource ?? ""}
          disabled={props.disabled || props.pending || !props.value.writable}
          onChange={(event) => {
            void props.onSelect(event.currentTarget.value || null);
          }}
        >
          <option value="">
            По умолчанию
            {props.value.selectedSource === null &&
            props.value.effectiveSource !== null
              ? `: ${props.value.entries.find((entry) => entry.id === props.value.effectiveSource)?.label ?? props.value.effectiveSource}`
              : ""}
          </option>
          {props.value.unavailable && props.value.selectedSource !== null ? (
            <option value={props.value.selectedSource} disabled>
              Недоступна: {props.value.selectedSource}
            </option>
          ) : null}
          {props.value.entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <span role="status" aria-live="polite">
        {props.pending
          ? "Обновляю выбор…"
          : props.value.unavailable
            ? "Источник удалён из настроек. Выберите другую версию."
            : props.value.effectiveSource === null
              ? "Выберите версию перед отправкой."
              : ""}
      </span>
      {props.error === null ? null : <span role="alert">{props.error}</span>}
    </div>
  );
}
