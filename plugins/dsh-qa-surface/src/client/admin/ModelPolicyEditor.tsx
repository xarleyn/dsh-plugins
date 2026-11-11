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
  readonly allowedModels?: readonly QaModelPair[];
  readonly onAllowedModelsChange?: (
    value: readonly QaModelPair[] | undefined,
  ) => void;
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
      <FilterField label="Модель по умолчанию" testId={`${props.testId}-field`}>
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
        Новый чат начинается с этой модели. Пользователь может сменить её на
        одну из разрешённых альтернатив. Выбор сохраняется в текущем чате.
      </p>
      {props.onAllowedModelsChange === undefined ? null : (
        <fieldset
          className="dsh-qa-model-policy__alternatives"
          disabled={props.disabled}
          data-testid={`${props.testId}-alternatives`}
        >
          <legend>Альтернативные модели для пользователя</legend>
          <label>
            <input
              type="checkbox"
              data-testid={`${props.testId}-inherit-models`}
              checked={props.allowedModels === undefined}
              onChange={(event) =>
                props.onAllowedModelsChange?.(
                  event.currentTarget.checked ? undefined : [],
                )
              }
            />
            Наследовать доступные модели
          </label>
          <p className="dsh-qa-admin__empty">
            Аккаунт наследует список роли. Для роли наследование оставляет
            только модель по умолчанию.
          </p>
          {props.allowedModels === undefined
            ? null
            : [
                ...new Map([
                  ...catalog.map(
                    (entry) =>
                      [
                        entryKey(entry),
                        {
                          pair: {
                            provider: entry.provider,
                            model: entry.model,
                          } as QaModelPair,
                          label: `${entry.provider} / ${entry.label}`,
                        },
                      ] as const,
                  ),
                  ...props.allowedModels
                    .filter(
                      (pair) => !byKey.has(pairKey(pair.provider, pair.model)),
                    )
                    .map(
                      (pair) =>
                        [
                          pairKey(pair.provider, pair.model),
                          {
                            pair,
                            label: `${pair.provider} / ${pair.model} (нет в каталоге)`,
                          },
                        ] as const,
                    ),
                ]).entries(),
              ].map(([key, entry]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    data-testid={`${props.testId}-alternative`}
                    checked={
                      props.allowedModels?.some(
                        (pair) => pairKey(pair.provider, pair.model) === key,
                      ) ?? false
                    }
                    onChange={(event) =>
                      props.onAllowedModelsChange?.(
                        event.currentTarget.checked
                          ? [...(props.allowedModels ?? []), entry.pair]
                          : (props.allowedModels?.filter(
                              (pair) =>
                                pairKey(pair.provider, pair.model) !== key,
                            ) ?? []),
                      )
                    }
                  />
                  {entry.label}
                </label>
              ))}
        </fieldset>
      )}
    </div>
  );
}
