/**
 * The Integrations operator card.
 *
 * One source meets here: the `qa-integrations` settings namespace, which is
 * the plugin's configuration source on the Host — the card edits it through
 * path-addressed mutations and the running service re-applies on each commit.
 * Every deployment knob the resolvers accept is reachable from this card; the
 * connection store and its key are the exception, because connections and
 * wrapped secrets belong to the boot path and re-open on a Host restart.
 *
 * What this file owns is the namespace plumbing and the order of the sections;
 * the sections themselves are provider files under `operator-sections/`, and
 * a new provider adds one of those instead of copying this card's form.
 */

import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import {
  CardShell,
  bindSettingsExternalStore,
} from "@yadsh/dsh-plugin-kit/client";
import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import type { QaIntegrationsConfig } from "../config.js";
import { Toggle, type ControlProps } from "./operator-controls.js";
import { Bitrix24Section } from "./operator-sections/bitrix24.js";
import { ConfluenceSection } from "./operator-sections/confluence.js";
import { CredentialHelpSection } from "./operator-sections/credential-help.js";
import { GeneralSection } from "./operator-sections/general.js";
import { GitlabSection } from "./operator-sections/gitlab.js";
import { JiraSection } from "./operator-sections/jira.js";
import {
  displayError,
  isOverridden,
  overriddenKeys,
  PROVIDER_IDS,
  rawObject,
  Section,
  type OperatorForm,
} from "./operator-sections/shared.js";
import { TeamcitySection } from "./operator-sections/teamcity.js";
import { TestitSection } from "./operator-sections/testit.js";
import { WeblateSection } from "./operator-sections/weblate.js";
import { ServiceAccessSection } from "./operator-sections/service-profiles.js";

/** The face the slot entry injects into this card. */
export interface OperatorCardFace {
  readonly form: ConfigForm<QaIntegrationsConfig>;
}

type CardProps = PropsRuntime<"settings.plugins.tab"> &
  InjectFace<OperatorCardFace>;

/** Mutation operations as the bound form declares them. */
type ScopeOps = Parameters<ConfigForm<QaIntegrationsConfig>["mutate"]>[0];

/**
 * The card as the Host's Plugins settings render it: one entry of
 * `settings.plugins.tab`, whose `<li>` shell therefore sits in a list this
 * plugin owns. The panel supplies no list of its own, and a bare `<li>` under
 * a `<div>` is what the shell contract on the account tab already avoids.
 */
export function OperatorCardTab(props: CardProps): ReactElement | null {
  return (
    <ul className="dsh-qa-integrations__host-tab">
      <OperatorCard {...props} />
    </ul>
  );
}

export function OperatorCard({ form }: CardProps): ReactElement | null {
  const store = useMemo(() => bindSettingsExternalStore(form), [form]);
  const settings = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const config = rawObject(settings.value);
  const writable = settings.status === "ready" && settings.writable;

  const write = useCallback(
    (path: readonly string[], value: unknown) => {
      const ops = [
        { op: "set", path: [...path], value },
      ] as unknown as ScopeOps;
      form.mutate(ops).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [form],
  );
  const unset = useCallback(
    (path: readonly string[]) => {
      const ops = [{ op: "unset", path: [...path] }] as unknown as ScopeOps;
      form.mutate(ops).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [form],
  );
  const overridden = useCallback(
    (path: readonly string[]) => isOverridden(settings.user, path),
    [settings.user],
  );
  const keys = overriddenKeys(settings.user);
  const resetAll = useCallback(() => {
    const ops = keys.map((key) => ({
      op: "unset",
      path: [key],
    })) as unknown as ScopeOps;
    form.mutate(ops).catch((cause: unknown) => {
      setError(displayError(cause));
    });
  }, [form, keys]);

  if (settings.status === "unavailable") return null;

  const control: ControlProps = {
    disabled: !writable,
    write,
    unset,
    overridden,
  };
  /** Capability toggle: reads default on, deny-listed switches default off. */
  const toggle = (
    label: string,
    path: readonly string[],
    value: boolean,
    hint?: string,
  ): ReactElement => (
    <Toggle
      key={path.join(".")}
      label={label}
      hint={hint}
      path={path}
      value={value}
      disabled={!writable}
      write={write}
      overridden={overridden(path)}
    />
  );
  const sections: OperatorForm = { config, control, toggle };

  return (
    <CardShell
      title="Интеграции — конфигурация"
      description="Операторские настройки подключений: провайдеры, адреса, возможности и сервисные доступы. Правка применяется к запущенному сервису сразу."
      badge={
        <span
          className="dsh-plugin-card__badge"
          data-testid="qa-integrations-override-badge"
        >
          {keys.length === 0
            ? "по умолчанию"
            : `переопределено: ${keys.length}`}
        </span>
      }
      label={(open) =>
        open
          ? "Свернуть конфигурацию интеграций"
          : "Развернуть конфигурацию интеграций"
      }
      bodyClassName="qai-op__body"
    >
      {settings.status === "loading" ? (
        <p className="qai-op__muted" data-testid="qa-integrations-loading">
          Загружаем конфигурацию интеграций…
        </p>
      ) : (
        <>
          {error !== null ? (
            <div
              className="qai-op__error"
              data-testid="qa-integrations-write-error"
            >
              {error}
            </div>
          ) : null}
          {!writable ? (
            <p
              className="qai-op__muted"
              data-testid="qa-integrations-read-only"
            >
              Хост не принимает правки из этого браузера — значения показаны
              только для чтения.
            </p>
          ) : null}
          <div
            className="qai-op__toolbar"
            data-testid="qa-integrations-toolbar"
          >
            <span className="qai-op__hint">
              Слой правок поверх конфигурации профиля: очищенная настройка
              возвращается к значению из yaml.
            </span>
            <button
              type="button"
              className="qai-op__button"
              data-testid="qa-integrations-reset-overrides"
              disabled={!writable || keys.length === 0}
              onClick={resetAll}
            >
              Сбросить переопределения ({keys.length})
            </button>
          </div>

          <GeneralSection form={sections} />
          <Bitrix24Section form={sections} />
          <ConfluenceSection form={sections} />
          <GitlabSection form={sections} />
          <TeamcitySection form={sections} />
          <JiraSection form={sections} />
          <TestitSection form={sections} />
          <WeblateSection form={sections} />
          <ServiceAccessSection form={sections} />

          <Section
            title="Подсказки получения доступа"
            hint="замена встроенных ссылок провайдеров своими"
          >
            {PROVIDER_IDS.map((provider) => (
              <CredentialHelpSection
                key={provider}
                provider={provider}
                override={rawObject(rawObject(config.credentialHelp)[provider])}
                disabled={!writable}
                write={write}
                unset={unset}
                overridden={overridden}
              />
            ))}
          </Section>
        </>
      )}
    </CardShell>
  );
}
