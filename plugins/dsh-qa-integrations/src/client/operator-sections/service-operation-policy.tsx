import type { ReactElement } from "react";
import type { ServicePolicyOperation } from "../../types.js";
import { serviceOperationAccess } from "../../service-credentials/operation-policy.js";

/** One profile's decisions, stored together with its credential and boundary. */
export function ServiceOperationPolicyField(props: {
  readonly provider: string;
  readonly operations: readonly ServicePolicyOperation[];
  readonly entries: ReadonlyArray<readonly [string, string]>;
  readonly disabled: boolean;
  readonly testId: string;
  readonly onChange: (
    entries: ReadonlyArray<readonly [string, string]>,
  ) => void;
}): ReactElement {
  const operations = props.operations;
  const known = new Set(operations.map((entry) => entry.operation));
  const policy = Object.fromEntries(props.entries) as Record<
    string,
    "allow" | "deny"
  >;
  const change = (key: string, value: string) => {
    const next = props.entries.filter(([name]) => name !== key);
    props.onChange(value === "" ? next : [...next, [key, value]]);
  };
  const inherited = props.entries.filter(([key]) => !known.has(key));
  return (
    <details className="qai-op__field" data-testid={props.testId}>
      <summary className="qai-op__label">
        Операции сервисного аккаунта · настроено {props.entries.length}
      </summary>
      <span className="qai-op__hint">
        Разрешения действуют для всех пользователей этого профиля, в пределах
        его ресурсов. Запрет имеет приоритет. Изменения и секреты через
        сервисный аккаунт недоступны.
      </span>
      <ul className="qai-op__rows">
        {operations.map((entry) => {
          const grantable =
            entry.security.effect === "read" &&
            entry.security.sensitivity !== "secret" &&
            entry.security.serviceOverrideAllowed !== false;
          const access = serviceOperationAccess(entry.security, {
            provider: props.provider,
            operation: entry.operation,
            capability: entry.capability,
            policy,
          });
          return (
            <li className="qai-op__row" key={entry.operation}>
              <span className="qai-op__row-key" title={entry.operation}>
                {entry.label} · {entry.operation}
              </span>
              <select
                className="qai-op__input"
                aria-label={`${entry.label} (${entry.operation})`}
                value={policy[entry.operation] ?? ""}
                disabled={props.disabled}
                onChange={(event) =>
                  change(entry.operation, event.currentTarget.value)
                }
              >
                <option value="">По умолчанию / по правилу раздела</option>
                <option value="allow" disabled={!grantable}>
                  Разрешить
                </option>
                <option value="deny">Запретить</option>
              </select>
              <span className="qai-op__hint">
                {entry.security.serviceOverrideAllowed === false
                  ? "Нужен личный аккаунт: ресурс нельзя проверить"
                  : access === "allow"
                    ? "Разрешено"
                    : "Запрещено"}
              </span>
            </li>
          );
        })}
        {inherited.map(([key, value]) => (
          <li className="qai-op__row" key={key}>
            <span className="qai-op__row-key">
              Правило раздела или операция: {key}
            </span>
            <select
              className="qai-op__input"
              aria-label={`Правило ${key}`}
              value={value}
              disabled={props.disabled}
              onChange={(event) => change(key, event.currentTarget.value)}
            >
              <option value="">Убрать правило</option>
              <option value="allow">Разрешить</option>
              <option value="deny">Запретить</option>
            </select>
          </li>
        ))}
      </ul>
    </details>
  );
}
