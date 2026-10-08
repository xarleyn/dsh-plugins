import type { QaAccessApi } from "../types.js";
import type { QaModelCatalogEntry, QaModelPair } from "../../types.js";
import { FilterField, useAdminResource } from "./shared.js";

/** Identity of a pair, as the value of one `<option>`. */
function pairKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

function entryKey(entry: QaModelCatalogEntry): string {
  return pairKey(entry.provider, entry.model);
}

/**
 * The provider and model one policy fixes, written by picking a pair this Host
 * actually serves.
 *
 * Free text was the trap: a pair nobody can serve does not fail when it is
 * saved, it fails on the first question of every chat that policy opens, in
 * words that name neither the pair nor the role that asked for it. So the
 * operator chooses from the harness catalog, and a pair already stored but no
 * longer offered stays in the list, marked as such — an editor that cannot see
 * it would otherwise drop it while the operator was changing something else.
 */
export function ModelPolicyEditor(props: {
  readonly api: QaAccessApi;
  readonly token: string;
  readonly value: QaModelPair | undefined;
  readonly disabled: boolean;
  /** Prefix of the test ids, so one component serves both editors. */
  readonly testId: string;
  readonly onChange: (value: QaModelPair | undefined) => void;
}) {
  const models = useAdminResource(
    () => props.api.modelCatalog(props.token),
    [props.api, props.token],
  );
  const catalog = models.data ?? [];
  const value = props.value;
  const storedKey =
    value === undefined ? "" : pairKey(value.provider, value.model);
  const byKey = new Map(catalog.map((entry) => [entryKey(entry), entry]));
  const selected = byKey.get(storedKey);
  const efforts = selected?.reasoningEfforts ?? [];

  if (catalog.length === 0) {
    return models.loading ? (
      <p
        className="dsh-qa-admin__empty"
        data-testid={`${props.testId}-loading`}
      >
        Загружаю каталог моделей…
      </p>
    ) : (
      <p className="dsh-qa-admin__error" data-testid={`${props.testId}-failed`}>
        Хост не отдал каталог моделей, поэтому пару выбрать нельзя.{" "}
        {value === undefined
          ? "Действует политика развёртывания."
          : `Действует пара ${storedKey}.`}
      </p>
    );
  }
  return (
    <div data-testid={props.testId}>
      <FilterField
        label="Модель этого профиля"
        testId={`${props.testId}-field`}
      >
        <select
          data-testid={`${props.testId}-pair`}
          disabled={props.disabled}
          value={storedKey}
          onChange={(event) => {
            const next = byKey.get(event.currentTarget.value);
            props.onChange(
              next === undefined
                ? undefined
                : { provider: next.provider, model: next.model },
            );
          }}
        >
          <option value="">Как в настройках стенда</option>
          {value !== undefined && selected === undefined ? (
            <option value={storedKey}>
              {storedKey} — нет в каталоге хоста
            </option>
          ) : null}
          {catalog.map((entry) => (
            <option key={entryKey(entry)} value={entryKey(entry)}>
              {entry.provider} / {entry.label}
            </option>
          ))}
        </select>
      </FilterField>
      {efforts.length === 0 ? null : (
        <FilterField
          label="Усилие рассуждений"
          testId={`${props.testId}-effort-field`}
        >
          <select
            data-testid={`${props.testId}-effort`}
            disabled={props.disabled}
            value={value?.reasoningEffort ?? ""}
            onChange={(event) => {
              if (value === undefined) return;
              const effort = event.currentTarget.value;
              props.onChange(
                effort === ""
                  ? { provider: value.provider, model: value.model }
                  : {
                      provider: value.provider,
                      model: value.model,
                      reasoningEffort: effort,
                    },
              );
            }}
          >
            <option value="">Как решает пресет</option>
            {efforts.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </FilterField>
      )}
      <p className="dsh-qa-admin__empty" data-testid={`${props.testId}-hint`}>
        Пара задаётся до запуска: ей открывается каждый новый чат этого профиля,
        а не выбор пользователя в интерфейсе.
      </p>
    </div>
  );
}
