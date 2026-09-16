import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { QaUserSettingsSectionProps } from "@yadsh/dsh-qa-surface/client/settings";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IntegrationCapability,
  IntegrationSummary,
  PolicyPatch,
} from "../types.js";
import { dateTime, failureCopy } from "./copy.js";

/**
 * The skeleton the three provider cards share: the failure banner, the status
 * head, the connected summary, the save/test/patch/disconnect flows, the
 * capability switches and the replace/disconnect confirmations. A provider
 * only supplies its copy, its load sequence and its credential form.
 */
export interface ProviderCardState<Extra> {
  readonly token: string;
  readonly busy: boolean;
  readonly summary: IntegrationSummary | undefined;
  readonly connected: boolean;
  readonly showCredential: boolean;
  readonly credential: string;
  readonly extra: Extra;
  setCredential(value: string): void;
  /** Clear the form and leave replace mode. */
  cancelCredential(): void;
  save(): void;
  test(): void;
  patch(capability: IntegrationCapability, allowed: boolean): void;
  setConfirmDisconnect(value: boolean): void;
  disconnect(): void;
  fail(cause: unknown): void;
  accept(result: RemoteResult<IntegrationSummary>): boolean;
}

/** Everything a provider's load sequence may touch. */
export interface ProviderCardLoad<Extra> {
  readonly token: string;
  readonly extra: Extra;
  accept(result: RemoteResult<IntegrationSummary>): boolean;
  fail(cause: unknown): void;
}

/** The remote calls every provider card makes on the shared skeleton. */
export interface ProviderCardCalls<Extra> {
  save(
    token: string,
    credential: string,
    extra: Extra,
  ): Promise<RemoteResult<IntegrationSummary>>;
  test(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patch(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnect(token: string): Promise<RemoteResult<boolean>>;
}

export interface ProviderCardSpec<Extra> {
  readonly title: string;
  /** Portal line while nothing is connected. */
  readonly portalFallback: string;
  /** Connected-account line when upstream reports no name. */
  readonly accountFallback: string;
  readonly errorCopy: Readonly<Record<string, string>>;
  /** Muted per-capability note when the token lacks the scope. */
  readonly notGrantedText: string;
  /** Disabled capability rows the provider does not offer yet. */
  readonly futurePermissions: readonly string[];
  useExtra(): Extra;
  load(load: ProviderCardLoad<Extra>): Promise<void>;
  readonly calls: ProviderCardCalls<Extra>;
  credentialSection(state: ProviderCardState<Extra>): ReactNode;
  /** Muted note under the head, or null when this provider shows none. */
  readonly notConfiguredHint?: (
    state: ProviderCardState<Extra>,
  ) => ReactNode | null;
}

export function createProviderCard<Extra>(spec: ProviderCardSpec<Extra>) {
  return function ProviderCard({ token }: QaUserSettingsSectionProps) {
    const [summary, setSummary] = useState<IntegrationSummary>();
    const [credential, setCredential] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [replace, setReplace] = useState(false);
    const [confirmDisconnect, setConfirmDisconnect] = useState(false);
    const extra = spec.useExtra();

    const fail = useCallback((cause: unknown) => {
      setError(failureCopy(spec.errorCopy, cause));
    }, []);

    const accept = useCallback(
      (result: RemoteResult<IntegrationSummary>) => {
        if (result.ok) {
          setSummary(result.value);
          setError(null);
          return true;
        }
        fail(result.error);
        return false;
      },
      [fail],
    );

    // The load sequence reads provider-specific setters, which keep a stable
    // identity, but the object around them changes every render — route the
    // sequence through a ref so the effect below fires once per token.
    const extraRef = useRef(extra);
    extraRef.current = extra;

    const load = useCallback(async () => {
      try {
        await spec.load({
          token,
          extra: extraRef.current,
          accept,
          fail,
        });
      } catch (cause) {
        fail(cause);
      }
    }, [accept, fail, token]);

    useEffect(() => {
      void load();
    }, [load]);

    const save = async () => {
      setBusy(true);
      try {
        const saved = accept(
          await spec.calls.save(token, credential, extraRef.current),
        );
        if (saved) {
          setCredential("");
          setReplace(false);
        }
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    };

    const test = async () => {
      setBusy(true);
      try {
        accept(await spec.calls.test(token));
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    };

    const patch = async (
      capability: IntegrationCapability,
      allowed: boolean,
    ) => {
      setBusy(true);
      try {
        accept(
          await spec.calls.patch(token, {
            operation: capability,
            mode: allowed ? "allow" : "deny",
          }),
        );
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    };

    const disconnect = async () => {
      setBusy(true);
      try {
        const result = await spec.calls.disconnect(token);
        if (result.ok) {
          setSummary(undefined);
          setConfirmDisconnect(false);
          await load();
        } else {
          fail(result.error);
        }
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    };

    const connected =
      summary !== undefined && summary.status !== "not_connected";
    const showCredential = !connected || replace;
    const state: ProviderCardState<Extra> = {
      token,
      busy,
      summary,
      connected,
      showCredential,
      credential,
      extra,
      setCredential,
      cancelCredential: () => {
        setCredential("");
        setReplace(false);
      },
      save: () => void save(),
      test: () => void test(),
      patch: (capability, allowed) => void patch(capability, allowed),
      setConfirmDisconnect,
      disconnect: () => void disconnect(),
      fail,
      accept,
    };

    return (
      <article className="dsh-qa-integrations__card">
        {error === null ? null : (
          <div className="dsh-qa-integrations__error" role="alert">
            {error}
          </div>
        )}
        <div className="dsh-qa-integrations__card-head">
          <div>
            <h3 className="dsh-qa-integrations__provider">{spec.title}</h3>
            <p className="dsh-qa-integrations__portal">
              {summary?.portal ?? spec.portalFallback}
            </p>
          </div>
          <span
            className={`dsh-qa-integrations__status${summary?.status === "connected" ? " dsh-qa-integrations__status--ok" : ""}`}
          >
            {summary?.status === "connected"
              ? "Подключено"
              : summary?.status === "error"
                ? "Нужна проверка"
                : "Не подключено"}
          </span>
        </div>

        {connected ? (
          <div className="dsh-qa-integrations__section">
            <strong>
              {summary.externalAccountName ?? spec.accountFallback}
            </strong>
            <span className="dsh-qa-integrations__muted">
              Последняя успешная проверка: {dateTime(summary.lastValidatedAt)}
            </span>
            <span className="dsh-qa-integrations__muted">
              Токен настроен · обновлён {dateTime(summary.credentialUpdatedAt)}
            </span>
          </div>
        ) : null}

        {showCredential ? spec.credentialSection(state) : null}

        {spec.notConfiguredHint?.(state) ?? null}

        {connected && !showCredential ? (
          <>
            <div className="dsh-qa-integrations__section">
              <h4>Доступ агента</h4>
              {Object.entries(summary.capabilityInfo).map(
                ([capability, info]) => {
                  const granted = summary.capabilities.includes(capability);
                  const mode = summary.policy.find(
                    (entry) => entry.capability === capability,
                  )?.mode;
                  return (
                    <div
                      className="dsh-qa-integrations__permission"
                      key={capability}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={mode === "allow"}
                          disabled={busy || !granted}
                          onChange={(event) =>
                            state.patch(capability, event.currentTarget.checked)
                          }
                        />
                        {info.label}
                      </label>
                      <span
                        className="dsh-qa-integrations__muted"
                        title={info.hint}
                      >
                        {granted ? "Доступно" : spec.notGrantedText}
                      </span>
                    </div>
                  );
                },
              )}
              {spec.futurePermissions.map((label) => (
                <div className="dsh-qa-integrations__permission" key={label}>
                  <label>
                    <input type="checkbox" disabled /> {label}
                  </label>
                  <span className="dsh-qa-integrations__muted">
                    Появится позже
                  </span>
                </div>
              ))}
            </div>
            <div className="dsh-qa-integrations__actions">
              <button
                className="dsh-qa-integrations__button"
                type="button"
                disabled={busy}
                onClick={state.test}
              >
                Проверить
              </button>
              <button
                className="dsh-qa-integrations__button"
                type="button"
                disabled={busy}
                onClick={() => setReplace(true)}
              >
                Заменить токен
              </button>
              <button
                className="dsh-qa-integrations__button dsh-qa-integrations__button--danger"
                type="button"
                disabled={busy}
                onClick={() => setConfirmDisconnect(true)}
              >
                Отключить
              </button>
            </div>
            {confirmDisconnect ? (
              <div
                className="dsh-qa-integrations__notice"
                role="alertdialog"
                aria-label={`Подтверждение отключения ${spec.title}`}
              >
                Отключить {spec.title} и удалить сохранённый токен?
                <div className="dsh-qa-integrations__actions">
                  <button
                    className="dsh-qa-integrations__button dsh-qa-integrations__button--danger"
                    type="button"
                    disabled={busy}
                    onClick={state.disconnect}
                  >
                    Да, отключить
                  </button>
                  <button
                    className="dsh-qa-integrations__button"
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDisconnect(false)}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </article>
    );
  };
}
