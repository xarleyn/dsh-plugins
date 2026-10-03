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

import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import { bindSettingsExternalStore } from "@yadsh/dsh-plugin-kit/client";
import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import type { QaIntegrationsConfig } from "../config.js";
import { Toggle, type ControlProps } from "./operator-controls.js";
import { serviceReachNoteForPath } from "./operator-service-reach.js";
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
  rawBool,
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
  /**
   * The live Config of this plugin's namespace.
   *
   * Named `settingsForm`, not `form`: the row seat hands its registrant a `form`
   * of its own — the Plugins page's `ConfigPageForm`, which is only
   * `{ state, mutate }` and so can neither be subscribed to nor written field by
   * field. This card's `ConfigForm` therefore arrives through the injected face,
   * where the owner prop cannot shadow it.
   */
  readonly settingsForm: ConfigForm<QaIntegrationsConfig>;
}

type CardProps = PropsRuntime<"plugins.row.config"> &
  InjectFace<OperatorCardFace>;

/** Mutation operations as the bound form declares them. */
type ScopeOps = Parameters<ConfigForm<QaIntegrationsConfig>["mutate"]>[0];

/**
 * The one-liner the Plugins page asks this row's entry for.
 *
 * The seat is keyed `@yadsh/dsh-qa-integrations#qa-integrations` and the page
 * dispatches that one entry under two views: `view: 'page'` is the form with its
 * own save control, `view: 'summary'` is the row's description line. The
 * contract the installed `@deepseek-ai/dsh-client-ui-plugin-manager` ships makes
 * the second a fallback — `lib/types/client/slot-contract.d.ts` admits `summary`
 * "for an official card's one-liner or a row's missing-description fallback" and
 * closes the `plugins.row.config` entry with "An absent description falls back to
 * the entry's `view: 'summary'`".
 *
 * Whether a live page reaches that fallback is not this bundle's to know, and it
 * is not `cordis.patch.yml` that decides it: the row's detail renders
 * `description ?? renderSlot("plugins.row.config", { view: "summary" })`, and
 * that `description` comes from `rowText(row)` over the Host-supplied `row.meta`
 * localized text — measured on the installed `rc.2` client, where the patch's own
 * rows carry no description field at all. A published bundle normally does
 * resolve to package text, so this sentence is what the entry answers with when
 * it does not, and it has to stay a sentence in that case either way: the page
 * mounts whatever it returns inside its own description paragraph, where a body
 * would be a page of controls inside a line of text.
 *
 * It is therefore kept equal to the `description` field of `package.json`, which
 * is what the Host reads the row's sentence from (`docs/DSH-0.1.7-MIGRATION.md`
 * §4.2, and `dsh-plugin-log-ui` #651 does the same): the same row then reads one
 * way whether the line comes from the manifest or from this entry. A test derives
 * the value from the manifest rather than restating it, so an edit to either side
 * that breaks the equality fails the suite.
 * `scripts/verify-package.mjs` pins what this artifact can prove — the branch and
 * the sentence ship — and not the reachability the Host decides.
 */
export const QA_INTEGRATIONS_ROW_SUMMARY =
  "Principal-scoped, encrypted user integrations for DSH QA Surface";

/**
 * The card as the Plugins page renders this bundle's row: `view: 'page'` mounts
 * the body below, and the `summary` fallback is answered with the sentence rather
 * than with a second render of it.
 */
export function OperatorCardEntry(props: CardProps): ReactElement | string {
  if (props.view === "summary") return QA_INTEGRATIONS_ROW_SUMMARY;
  return <OperatorCard {...props} />;
}

export function OperatorCard({ settingsForm }: CardProps): ReactElement {
  const store = useMemo(
    () => bindSettingsExternalStore(settingsForm),
    [settingsForm],
  );
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
      settingsForm.mutate(ops).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [settingsForm],
  );
  const unset = useCallback(
    (path: readonly string[]) => {
      const ops = [{ op: "unset", path: [...path] }] as unknown as ScopeOps;
      settingsForm.mutate(ops).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [settingsForm],
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
    settingsForm.mutate(ops).catch((cause: unknown) => {
      setError(displayError(cause));
    });
  }, [settingsForm, keys]);

  if (settings.status === "unavailable") {
    /**
     * The namespace left the Host's `describe()` view after this seat mounted —
     * a Config with no `.volatile()` field, or a Host that dropped the entry. A
     * card that owns its shell could render nothing here; this one sits inside
     * the page's own card, so rendering nothing would leave the reader in an
     * opened row with an empty section and no reason. The sentence is the answer,
     * and the row's own `Configure` control — drawn from the inventory, not from
     * this entry — stays clickable.
     */
    return (
      <div className="qai-op__body">
        <p className="qai-op__muted" data-testid="qa-integrations-unavailable">
          Настройки интеграций в этом сеансе недоступны, поэтому здесь нечего
          читать и нечего менять. Запущенный сервис сохраняет конфигурацию,
          которую принял последней.
        </p>
      </div>
    );
  }

  const control: ControlProps = {
    disabled: !writable,
    write,
    unset,
    overridden,
  };
  const serviceSlice = rawObject(config.managedServiceCredentials);
  /**
   * Capability toggle: reads default on, deny-listed switches default off. The
   * managed service credential never reaches some of these readings, and a
   * switch it does not reach says so in its own hint slot: one annotation point
   * for every toggle the sections render, so a section can neither forget nor
   * mistype the switch it annotates — and its own hint cannot bury the note.
   */
  const toggle = (
    label: string,
    path: readonly string[],
    value: boolean,
    hint?: string,
  ): ReactElement => {
    const ceiling = serviceReachNoteForPath(
      path,
      rawBool(serviceSlice.enabled, false),
    );
    let note = hint;
    if (ceiling !== undefined) {
      note = note === undefined ? ceiling : `${note}; ${ceiling}`;
    }
    return (
      <Toggle
        key={path.join(".")}
        label={label}
        hint={note}
        path={path}
        value={value}
        disabled={!writable}
        write={write}
        overridden={overridden(path)}
      />
    );
  };
  const sections: OperatorForm = { config, control, toggle };

  return (
    // The Plugins page draws this card's frame, its title and its expand control,
    // so the bundle renders the body and nothing around it (AGENTS.md). The
    // override marker is the body's own: it states what this section holds, which
    // the page's chrome does not know.
    <div className="qai-op__body">
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
            <span
              className="qai-op__override-state"
              data-testid="qa-integrations-override-badge"
            >
              {keys.length === 0
                ? "по умолчанию"
                : `переопределено: ${keys.length}`}
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
    </div>
  );
}
