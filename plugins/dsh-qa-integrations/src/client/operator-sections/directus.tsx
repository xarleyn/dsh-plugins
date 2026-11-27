import { useState, type ReactElement } from "react";
import {
  resolveDirectusConfig,
  type DirectusConfig,
} from "../../providers/directus/config.js";
import { testIdOf, type ControlProps } from "../operator-controls.js";
import {
  displayError,
  Group,
  plural,
  rawArray,
  rawObject,
  rawString,
  Section,
  type OperatorForm,
} from "./shared.js";

const PATH = ["directus", "instances"] as const;
const FIELD_ID = testIdOf(PATH);
const NO_SERVERS = "Серверы Directus ещё не настроены.";

function InstanceEditor({
  value,
  control,
}: {
  readonly value: string;
  readonly control: ControlProps;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save(): void {
    if (draft === null || control.disabled) return;
    let next: DirectusConfig["instances"];
    try {
      const parsed: unknown = JSON.parse(draft);
      if (!Array.isArray(parsed)) {
        setError("Укажите массив серверов в формате JSON.");
        return;
      }
      next = resolveDirectusConfig({
        instances: parsed as DirectusConfig["instances"],
      }).instances;
    } catch (cause) {
      setError(
        cause instanceof SyntaxError
          ? "Проверьте синтаксис JSON."
          : displayError(cause),
      );
      return;
    }
    setError(null);
    control.write(PATH, next);
  }

  if (draft === null) {
    return (
      <div>
        <button
          type="button"
          className="qai-op__button"
          disabled={control.disabled}
          onClick={() => setDraft(value)}
        >
          Редактировать серверы
        </button>
      </div>
    );
  }

  return (
    <div className="qai-op__field">
      <label className="qai-op__field-label" htmlFor={FIELD_ID}>
        Конфигурация серверов (JSON)
      </label>
      <textarea
        id={FIELD_ID}
        data-testid={FIELD_ID}
        className="qai-op__input qai-op__directus-json"
        value={draft}
        rows={9}
        disabled={control.disabled}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : `${FIELD_ID}-error`}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setError(null);
        }}
      />
      {error === null ? null : (
        <p id={`${FIELD_ID}-error`} className="qai-op__error" role="alert">
          {error}
        </p>
      )}
      <div className="qai-op__row-add">
        <button
          type="button"
          className="qai-op__button"
          disabled={control.disabled || value === draft}
          onClick={save}
        >
          Применить
        </button>
        <button
          type="button"
          className="qai-op__button"
          onClick={() => {
            setDraft(null);
            setError(null);
          }}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

export function DirectusSection({
  form,
}: {
  readonly form: OperatorForm;
}): ReactElement {
  const instances = rawArray(rawObject(form.config.directus).instances);
  const stored = JSON.stringify(instances, null, 2);
  return (
    <Section
      title="Directus"
      testId="qa-integrations-directus"
      state={plural(instances.length, ["сервер", "сервера", "серверов"])}
    >
      <Group title="Серверы" wide>
        {instances.length === 0 ? (
          <p className="qai-op__muted">{NO_SERVERS}</p>
        ) : (
          <ul className="qai-op__instances">
            {instances.map((value) => {
              const instance = rawObject(value);
              const id = rawString(instance.id);
              return (
                <li className="qai-op__profile" key={id}>
                  <strong>{rawString(instance.label) || id}</strong>
                  <span className="qai-op__muted">
                    {id} · {rawString(instance.baseUrl)}
                  </span>
                  <span className="qai-op__hint">
                    {plural(rawArray(instance.collections).length, [
                      "коллекция",
                      "коллекции",
                      "коллекций",
                    ])}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <InstanceEditor key={stored} value={stored} control={form.control} />
        {form.control.overridden(PATH) ? (
          <div>
            <button
              type="button"
              className="qai-op__button"
              disabled={form.control.disabled}
              onClick={() => form.control.unset(PATH)}
            >
              Восстановить серверы из профиля
            </button>
          </div>
        ) : null}
      </Group>
    </Section>
  );
}
