/**
 * The QA Surface settings card.
 *
 * Two sources meet here: the `qa-surface` settings namespace, which is the
 * page's configuration source on the Host, and the `qaSurface/describe`
 * Remote, which reports the configuration the running Host actually resolved.
 * Everything the user changes is written immediately as a path-addressed
 * mutation; the status view re-reads the Remote while the card is visible, so
 * a saved change is confirmed against the Host rather than against the form.
 */

import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import {
  bindSettingsExternalStore,
  startVisibilityAwarePolling,
} from "@yadsh/dsh-plugin-kit/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../../types.js";
import type { ConfigEntry } from "./fields.js";
import {
  isOverridden,
  mutationLanded,
  overriddenKeys,
  pluralRu,
} from "./format.js";
import {
  AccessSection,
  AttachmentsSection,
  AccountsSection,
  BrandingSection,
  DocsSection,
  EmbeddingSection,
  InterfaceSection,
  LockdownSection,
  NotesSection,
  SessionSection,
  SlashSection,
  SourcesSection,
  StatusSection,
  type ConfigProps,
} from "./sections.js";

const REFRESH_INTERVAL_MS = 5_000;

/** Shown when a settled mutation left the configuration unchanged. */
const REFUSED_MESSAGE =
  "Хост отклонил изменение: значение не сохранилось. Обычно так отвечает несовместимая комбинация полей — проверьте связанные значения этого раздела. Точную причину хост пишет в свой журнал.";

/**
 * The one-liner of this row, carried by the `summary` view the Plugins page asks
 * this seat for. Kept equal to the `description` field of `package.json`, which
 * is where the host reads the row's sentence from: the two answers reach the same
 * paragraph, so a drift makes one row read two ways. Pinned by a test that reads
 * the manifest rather than repeating this literal (AGENTS.md card-shell contract,
 * `docs/DSH-0.1.7-MIGRATION.md` §4.2).
 */
const ROW_SUMMARY =
  "A focused end-user QA surface backed by native DeepSeek Harness sessions";

/**
 * The face the row seat injects into this card.
 *
 * The live form is named `settingsForm`, not `form`: the seat hands its
 * registrant a `form` of its own — the page's `ConfigPageForm`, which is only
 * `{ state, mutate }` (`formFor` in
 * `@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js` snapshots the same
 * namespace's form and forwards `mutate` and nothing else), so it can neither be
 * subscribed to nor written field by field, and which the page leaves
 * `undefined` for a Config declaring no volatile field — and the renderer
 * spreads that owner prop after this face. The card therefore keeps resolving
 * the full `ConfigForm` of its own namespace through `ctx.configForms` and takes
 * no copy of the page's view.
 */
export interface QaSettingsCardFace {
  readonly settingsForm: ConfigForm<QaSurfaceConfig>;
  describe(): Promise<RemoteResult<ResolvedQaSurfaceConfig>>;
}

type CardProps = PropsRuntime<"plugins.row.config"> &
  InjectFace<QaSettingsCardFace>;

/** Mutation operations as the bound form declares them. */
type ScopeOps = Parameters<ConfigForm<QaSurfaceConfig>["mutate"]>[0];

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Хост отклонил изменение настроек помощника.";
}

export function QaSettingsCard({ settingsForm, describe }: CardProps) {
  const store = useMemo(
    () => bindSettingsExternalStore(settingsForm),
    [settingsForm],
  );
  const settings = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const config = settings.value;
  const writable = settings.status === "ready" && settings.writable;

  const [effective, setEffective] = useState<ResolvedQaSurfaceConfig | null>(
    null,
  );
  // Two channels on purpose: a healthy status poll must not erase what a write
  // reported, or an operator would watch a refusal flash and vanish while the
  // value stayed unsaved.
  const [hostError, setHostError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | undefined>(undefined);
  const activeRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++activeRequest.current;
    setRefreshing(true);
    try {
      const result = await describe();
      if (request !== activeRequest.current) return;
      if (result.ok) {
        setEffective(result.value);
        setHostError(null);
      } else {
        // A Host that stopped answering must not leave a stale configuration
        // on screen looking like the running one.
        setEffective(null);
        setHostError(displayError(result.error));
      }
    } catch (cause) {
      if (request === activeRequest.current) {
        setEffective(null);
        setHostError(displayError(cause));
      }
    } finally {
      if (request === activeRequest.current) {
        setRefreshing(false);
        setRefreshedAt(Date.now());
      }
    }
  }, [describe]);

  useEffect(() => {
    // An unreachable namespace has no status section to feed, so the poll stays
    // off until a snapshot serves values again.
    if (settings.status === "unavailable") return;
    const stopPolling = startVisibilityAwarePolling(
      refresh,
      REFRESH_INTERVAL_MS,
    );
    return () => {
      stopPolling();
      activeRequest.current += 1;
    };
  }, [refresh, settings.status]);

  /**
   * Path-addressed writes into the namespace. The form's mutation operations
   * are typed for the wire's JSON values, which a control's value satisfies by
   * construction; the cast keeps that boundary in one place.
   *
   * A write the Host refuses does not reject the form's promise: the form
   * reloads Host state and settles normally. Acceptance is therefore confirmed
   * against the namespace — the revision advances on every committed change,
   * and a write that changed nothing is answered by the section itself —
   * because a refusal the operator cannot see is a control that silently does
   * nothing.
   */
  const applyMutation = useCallback(
    async (
      entries: readonly ConfigEntry[],
      cleared: readonly (readonly string[])[],
    ) => {
      const before = settingsForm.getSnapshot().revision;
      const ops = [
        ...entries.map((entry) => ({
          op: "set" as const,
          path: [...entry.path],
          value: entry.value,
        })),
        ...cleared.map((path) => ({ op: "unset" as const, path: [...path] })),
      ] as unknown as ScopeOps;
      try {
        await settingsForm.mutate(ops);
      } catch (cause) {
        setWriteError(displayError(cause));
        return;
      }
      const after = settingsForm.getSnapshot();
      const landed =
        after.revision !== before || mutationLanded(entries, cleared, after);
      // Held until a later write lands: the message names what to look at, and
      // a timer that clears it would only hide the problem.
      setWriteError(landed ? null : REFUSED_MESSAGE);
    },
    [settingsForm],
  );

  const write = useCallback(
    (path: readonly string[], value: unknown) => {
      void applyMutation([{ path, value }], []);
    },
    [applyMutation],
  );

  const writeMany = useCallback(
    (entries: readonly ConfigEntry[]) => {
      void applyMutation(entries, []);
    },
    [applyMutation],
  );

  const unset = useCallback(
    (path: readonly string[]) => {
      void applyMutation([], [path]);
    },
    [applyMutation],
  );

  const overridden = useCallback(
    (path: readonly string[]) => isOverridden(settings.user, path),
    [settings.user],
  );

  const overrides = overriddenKeys(settings.user);
  const resetAll = useCallback(() => {
    void applyMutation(
      [],
      overrides.map((key) => [key]),
    );
  }, [applyMutation, overrides]);

  // The row's page draws its heading and its expand control whatever the
  // namespace answers, so an unavailable one says why rather than leaving the
  // column the operator just opened empty. The Plugins panel is not the settings
  // directory: a browser on another machine sees the namespace as unavailable
  // and still has the row, so hiding the body would hide the reason (AGENTS.md).
  // A namespace that serves values but refuses writes is the other case: the
  // body renders and disables its controls on `writable` instead of hiding.
  if (settings.status === "unavailable") {
    return (
      <p className="qa-card-muted" data-testid="qa-settings-unavailable">
        Хост не отдаёт этому браузеру пространство настроек плагина — они
        читаются только с машины, где поднят стенд. Редактировать здесь нечего,
        работа ассистента при этом идёт по сохранённым значениям.
      </p>
    );
  }

  const sectionProps: ConfigProps = {
    config,
    effective,
    writable,
    write,
    writeMany,
    unset,
    overridden,
  };

  return (
    // The Plugins page draws this card's frame, its heading and its expand
    // control, so the bundle renders the body and nothing around it (AGENTS.md).
    <div className="qa-card-body">
      {settings.status === "loading" ? (
        <p className="qa-card-muted" data-testid="qa-settings-loading">
          Загружаю настройки помощника…
        </p>
      ) : (
        <>
          {writeError !== null ? (
            <div
              className="qa-card-error"
              data-testid="qa-settings-write-error"
            >
              {writeError}
            </div>
          ) : null}
          {hostError !== null ? (
            <div className="qa-card-error" data-testid="qa-settings-host-error">
              {hostError}
            </div>
          ) : null}
          <StatusSection
            effective={effective}
            config={config}
            refreshing={refreshing}
            refreshedAt={refreshedAt}
            overrides={overrides.length}
            onRefresh={() => {
              void refresh();
            }}
          />
          <AccessSection {...sectionProps} />
          <BrandingSection {...sectionProps} />
          <SessionSection {...sectionProps} />
          <InterfaceSection {...sectionProps} />
          <LockdownSection {...sectionProps} />
          <SlashSection {...sectionProps} />
          <AccountsSection {...sectionProps} />
          <SourcesSection {...sectionProps} />
          <DocsSection {...sectionProps} />
          <NotesSection {...sectionProps} />
          <AttachmentsSection {...sectionProps} />
          <EmbeddingSection {...sectionProps} />
          <div className="qa-card-footer">
            <p className="qa-card-footer-note">
              Изменения уходят на работающий Host сразу: маршрут
              перерегистрируется, политика применяется при следующем
              подтверждении сессии. Правки ложатся пользовательским слоем поверх
              конфигурации развёртывания, поэтому их можно сбросить — но не
              отменить поведение, зашитое в самом развёртывании.
            </p>
            {overrides.length > 0 ? (
              <button
                type="button"
                className="qa-card-btn"
                data-testid="qa-settings-reset-all"
                disabled={!writable}
                onClick={resetAll}
              >
                Сбросить{" "}
                {pluralRu(overrides.length, [
                  "переопределение",
                  "переопределения",
                  "переопределений",
                ])}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The entry this plugin registers in the row's configuration seat.
 *
 * `RowDetail` in `@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js` can
 * ask this seat for two shapes of the same entry: `view: 'summary'` as the row's
 * one-liner and `view: 'page'` in the configuration column under the row's
 * heading. Which of the two it asks for is the page's decision and §4.2 of
 * `docs/DSH-0.1.7-MIGRATION.md` is where that is measured and stated — the row's
 * description comes from the installed manifest, and the summary seat is the
 * fallback for a row that declares none — so this bundle answers both without
 * claiming either call is its own. The summary lands inside a line of the page's
 * text, so it stays a sentence: a card seated there would draw a page within a
 * line and start a second poll of the `qaSurface/describe` Remote. The page view
 * is the body alone — the row's page already draws the card surface, the heading
 * and the expand control, so a shell of ours would be a second frame inside the
 * first (AGENTS.md, card-shell contract).
 */
export function QaSettingsCardEntry(props: CardProps) {
  if (props.view === "summary") return ROW_SUMMARY;
  return <QaSettingsCard {...props} />;
}
