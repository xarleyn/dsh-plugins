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
import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import {
  CardShell,
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
  badgeText,
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
  EmbeddingSection,
  InterfaceSection,
  LockdownSection,
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

/** The face the slot entry injects into this card. */
export interface QaSettingsCardFace {
  readonly scope: SettingsScope<QaSurfaceConfig>;
  describe(): Promise<RemoteResult<ResolvedQaSurfaceConfig>>;
}

type CardProps = PropsRuntime<"settings.plugin.item"> &
  InjectFace<QaSettingsCardFace>;

/** Mutation operations as the bound scope declares them. */
type ScopeOps = Parameters<SettingsScope<QaSurfaceConfig>["mutate"]>[0];

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Хост отклонил изменение настроек помощника.";
}

export function QaSettingsCard({ scope, describe }: CardProps) {
  const store = useMemo(() => bindSettingsExternalStore(scope), [scope]);
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
    const stopPolling = startVisibilityAwarePolling(
      refresh,
      REFRESH_INTERVAL_MS,
    );
    return () => {
      stopPolling();
      activeRequest.current += 1;
    };
  }, [refresh]);

  /**
   * Path-addressed writes into the namespace. The scope's mutation operations
   * are typed for the wire's JSON values, which a control's value satisfies by
   * construction; the cast keeps that boundary in one place.
   *
   * A write the Host refuses does not reject the scope's promise: the scope
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
      const before = scope.getSnapshot().revision;
      const ops = [
        ...entries.map((entry) => ({
          op: "set" as const,
          path: [...entry.path],
          value: entry.value,
        })),
        ...cleared.map((path) => ({ op: "unset" as const, path: [...path] })),
      ] as unknown as ScopeOps;
      try {
        await scope.mutate(ops);
      } catch (cause) {
        setWriteError(displayError(cause));
        return;
      }
      const after = scope.getSnapshot();
      const landed =
        after.revision !== before || mutationLanded(entries, cleared, after);
      // Held until a later write lands: the message names what to look at, and
      // a timer that clears it would only hide the problem.
      setWriteError(landed ? null : REFUSED_MESSAGE);
    },
    [scope],
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

  if (settings.status === "unavailable") return null;

  const enabled = effective?.enabled ?? config?.enabled ?? true;
  const routePath = effective?.route.path ?? config?.route?.path;

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
    <CardShell
      title="Помощник QA"
      description="Страница вопросов и ответов на сессиях DeepSeek Harness: маршрут, оформление, сессия, политика запуска, аккаунты и источники."
      badge={
        <span className="dsh-plugin-card__badge">
          {badgeText(enabled, routePath)}
        </span>
      }
      label={(open) => `${open ? "Скрыть" : "Показать"} настройки: Помощник QA`}
      bodyClassName="qa-card-body"
    >
      {settings.status === "loading" ? (
        <p className="qa-card-muted">Загружаю настройки помощника…</p>
      ) : (
        <>
          {writeError !== null ? (
            <div className="qa-card-error">{writeError}</div>
          ) : null}
          {hostError !== null ? (
            <div className="qa-card-error">{hostError}</div>
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
    </CardShell>
  );
}
