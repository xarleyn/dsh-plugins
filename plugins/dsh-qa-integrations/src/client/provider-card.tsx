import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";
import type { QaUserSettingsSectionProps } from "@yadsh/dsh-qa-surface/client/settings";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CapabilityServiceState,
  CredentialSource,
  IntegrationCapability,
  IntegrationServiceBoundary,
  IntegrationSummary,
  PolicyPatch,
} from "../types.js";
import { dateTime, failureCopy } from "./copy.js";

/**
 * What every provider card receives: the account token, plus the credential help
 * this deployment declared for the provider. The help is metadata — a card
 * renders it or renders nothing, and the credential field behaves the same
 * either way.
 */
export interface ProviderCardProps extends QaUserSettingsSectionProps {
  readonly help?: CredentialHelp | null;
}

/**
 * The skeleton the provider cards share: the failure banner, the status head,
 * the connected summary, the save/test/patch/disconnect flows, the managed
 * credential block, the capability switches and the replace/disconnect
 * confirmations. A provider supplies its copy, its load sequence, its credential
 * form and how its instances map to a deployment credential.
 */
export interface ProviderCardState<Extra> {
  readonly token: string;
  readonly busy: boolean;
  readonly summary: IntegrationSummary | undefined;
  readonly connected: boolean;
  readonly showCredential: boolean;
  readonly credential: string;
  readonly extra: Extra;
  /** Managed credential offered by the selected instance, or null. */
  readonly service: { readonly label: string } | null;
  /** Whether the connect form asks for that credential instead of a token. */
  readonly useService: boolean;
  setUseService(value: boolean): void;
  setCredential(value: string): void;
  /** Clear the form and leave replace mode. */
  cancelCredential(): void;
  save(): void;
  test(): void;
  patch(capability: IntegrationCapability, allowed: boolean): void;
  /** Move the connected binding onto the other credential source. */
  switchSource(source: CredentialSource): void;
  /** Store what this binding narrows the profile's allowlist to. */
  saveBoundary(selection: IntegrationServiceBoundary | null): void;
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
    options: { readonly useServiceCredential: boolean },
  ): Promise<RemoteResult<IntegrationSummary>>;
  test(token: string): Promise<RemoteResult<IntegrationSummary>>;
  patch(
    token: string,
    patch: PolicyPatch,
  ): Promise<RemoteResult<IntegrationSummary>>;
  disconnect(token: string): Promise<RemoteResult<boolean>>;
  /** Present on the providers a deployment may manage a credential for. */
  setSource?(
    token: string,
    source: CredentialSource,
  ): Promise<RemoteResult<IntegrationSummary>>;
  setBoundary?(
    token: string,
    selection: IntegrationServiceBoundary | null,
  ): Promise<RemoteResult<IntegrationSummary>>;
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
  credentialSection(
    state: ProviderCardState<Extra>,
    help: CredentialHelp | null,
  ): ReactNode;
  /** Muted note under the head, or null when this provider shows none. */
  readonly notConfiguredHint?: (
    state: ProviderCardState<Extra>,
  ) => ReactNode | null;
  /** Managed credential of the instance the form currently selects. */
  readonly serviceBinding?: (extra: Extra) => { readonly label: string } | null;
  /**
   * Whether a new connection starts on the managed credential. Read from the
   * deployment, so the default the form shows is the one the host will apply.
   */
  readonly serviceDefault?: (token: string) => Promise<boolean>;
}

/** Why a capability row is unavailable while a managed credential is in use. */
const SERVICE_REASON: Readonly<Record<CapabilityServiceState, string>> =
  Object.freeze({
    available: "Доступно",
    sensitive: "Требуется личный аккаунт",
    unavailable: "Недоступно с сервисным токеном",
  });

/**
 * The managed-credential block of a connect form: one checkbox, plus what the
 * mode does and does not give. Rendered by the providers a deployment may
 * manage a credential for, using the instance the form selected.
 */
export function serviceConnectOption<Extra>(
  state: ProviderCardState<Extra>,
): ReactNode {
  if (state.service === null) return null;
  return (
    <div className="dsh-qa-integrations__section">
      <label className="dsh-qa-integrations__check">
        <input
          type="checkbox"
          checked={state.useService}
          disabled={state.busy}
          onChange={(event) => state.setUseService(event.currentTarget.checked)}
        />
        Использовать сервисный токен
      </label>
      <p className="dsh-qa-integrations__hint">
        {state.useService
          ? `Сервисный аккаунт: ${state.service.label}. Токен создавать не нужно; сервисный режим даёт только безопасное чтение — изменения, секреты и чувствительные данные недоступны.`
          : "Подключение под вашим личным аккаунтом: доступны все возможности, которые разрешает ваш токен."}
      </p>
    </div>
  );
}

export function createProviderCard<Extra>(spec: ProviderCardSpec<Extra>) {
  return function ProviderCard({ token, help }: ProviderCardProps) {
    const [summary, setSummary] = useState<IntegrationSummary>();
    const [credential, setCredential] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [replace, setReplace] = useState(false);
    const [confirmDisconnect, setConfirmDisconnect] = useState(false);
    // Tri-state: the deployment default applies until the user says otherwise,
    // so clearing the checkbox really returns to the personal form on a
    // deployment whose default is the managed credential.
    const [serviceChoice, setServiceChoice] = useState<boolean | null>(null);
    const [serviceDefault, setServiceDefault] = useState(false);
    const [editingBoundary, setEditingBoundary] =
      useState<IntegrationServiceBoundary | null>(null);
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
        if (spec.serviceDefault !== undefined) {
          try {
            setServiceDefault(await spec.serviceDefault(token));
          } catch {
            // A deployment that cannot report the flag simply offers personal
            // mode; the checkbox stays available and off.
            setServiceDefault(false);
          }
        }
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

    const service = spec.serviceBinding?.(extra) ?? null;
    // The checkbox follows the deployment default until the user touches it, and
    // it never survives an instance whose deployment manages no credential.
    const serviceOffered = service !== null;
    // Until the user chooses, the checkbox follows the deployment default for a
    // new connection and the connection's current source when a token is being
    // replaced: opening "replace" must not offer to move a personal binding onto
    // the shared account as if that were the default.
    const fallback = replace
      ? summary?.credentialSource === "service"
      : serviceDefault;
    const wantsService = serviceOffered && (serviceChoice ?? fallback);

    const save = async () => {
      setBusy(true);
      try {
        const saved = accept(
          await spec.calls.save(token, credential, extraRef.current, {
            useServiceCredential: wantsService,
          }),
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

    const switchSource = async (source: CredentialSource) => {
      const call = spec.calls.setSource;
      if (call === undefined) return;
      setBusy(true);
      try {
        accept(await call(token, source));
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    };

    const saveBoundary = async (
      selection: IntegrationServiceBoundary | null,
    ) => {
      const call = spec.calls.setBoundary;
      if (call === undefined) return;
      setBusy(true);
      try {
        if (accept(await call(token, selection))) setEditingBoundary(null);
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
      service,
      useService: wantsService,
      setUseService: (value: boolean) => setServiceChoice(value),
      setCredential,
      cancelCredential: () => {
        setCredential("");
        setReplace(false);
      },
      save: () => void save(),
      test: () => void test(),
      patch: (capability, allowed) => void patch(capability, allowed),
      switchSource: (source) => void switchSource(source),
      saveBoundary: (selection) => void saveBoundary(selection),
      setConfirmDisconnect,
      disconnect: () => void disconnect(),
      fail,
      accept,
    };

    const serviceMode = summary?.credentialSource === "service";
    const serviceState = summary?.service;

    const capabilityNote = (capability: IntegrationCapability): string => {
      if (serviceMode && serviceState !== null && serviceState !== undefined) {
        const state = serviceState.capabilities[capability];
        if (state !== undefined && state !== "available") {
          return SERVICE_REASON[state];
        }
      }
      return summary?.capabilities.includes(capability) === true
        ? "Доступно"
        : spec.notGrantedText;
    };

    const capabilityAllowedInService = (
      capability: IntegrationCapability,
    ): boolean =>
      serviceState?.capabilities[capability] === "available" ||
      serviceState?.capabilities[capability] === undefined;

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
              {serviceMode
                ? "Сервисный аккаунт · управляется администратором"
                : `Токен настроен · обновлён ${dateTime(summary.credentialUpdatedAt)}`}
            </span>
            {summary.errorCode === "ServiceCredentialUnsafeScope" ? (
              <span className="dsh-qa-integrations__muted">
                Сервисный токен шире, чем read-only: доступ всё равно ограничен
                потолком режима, но токен стоит сузить.
              </span>
            ) : null}
          </div>
        ) : null}

        {showCredential ? spec.credentialSection(state, help ?? null) : null}

        {spec.notConfiguredHint?.(state) ?? null}

        {connected && !showCredential ? (
          <>
            {serviceMode ? (
              <div className="dsh-qa-integrations__section">
                <h4>Режим доступа</h4>
                <span className="dsh-qa-integrations__muted">
                  Только безопасное чтение: изменения, управление правами и
                  секреты недоступны, даже если сервисный токен их позволяет.
                </span>
                {serviceState?.resources == null ? null : (
                  <BoundarySummary
                    resources={serviceState.resources}
                    selection={serviceState.selection}
                  />
                )}
                {editingBoundary === null ? null : (
                  <BoundaryEditor
                    resources={serviceState?.resources ?? {}}
                    selection={
                      editingBoundary ?? serviceState?.selection ?? null
                    }
                    busy={busy}
                    onChange={setEditingBoundary}
                    onCancel={() => setEditingBoundary(null)}
                    onSave={() => void saveBoundary(editingBoundary)}
                  />
                )}
                <div className="dsh-qa-integrations__actions">
                  {spec.calls.setBoundary === undefined ||
                  serviceState?.resources == null ? null : (
                    <button
                      className="dsh-qa-integrations__button"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setEditingBoundary(
                          editingBoundary ?? serviceState.selection ?? {},
                        )
                      }
                    >
                      Изменить доступ
                    </button>
                  )}
                  {spec.calls.setSource === undefined ? null : (
                    <button
                      className="dsh-qa-integrations__button"
                      type="button"
                      disabled={busy}
                      onClick={() => void switchSource("personal")}
                    >
                      Использовать личный аккаунт
                    </button>
                  )}
                </div>
              </div>
            ) : serviceState?.available === true &&
              spec.calls.setSource !== undefined ? (
              <div className="dsh-qa-integrations__section">
                <span className="dsh-qa-integrations__muted">
                  Этому подключению доступен сервисный токен организации —{" "}
                  {serviceState.label ?? "сервисный аккаунт"}.
                </span>
                <div className="dsh-qa-integrations__actions">
                  <button
                    className="dsh-qa-integrations__button"
                    type="button"
                    disabled={busy}
                    onClick={() => void switchSource("service")}
                  >
                    Использовать сервисный токен
                  </button>
                </div>
              </div>
            ) : null}

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
                          disabled={
                            busy ||
                            !granted ||
                            (serviceMode &&
                              !capabilityAllowedInService(capability))
                          }
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
                        {capabilityNote(capability)}
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

/** How many resources of each kind this connection may read. */
function BoundarySummary({
  resources,
  selection,
}: {
  readonly resources: IntegrationServiceBoundary;
  readonly selection: IntegrationServiceBoundary | null;
}) {
  return (
    <div className="dsh-qa-integrations__section">
      {Object.entries(resources).map(([kind, allowed]) => {
        const chosen = selection?.[kind] ?? allowed;
        return (
          <span className="dsh-qa-integrations__muted" key={kind}>
            {kind}: {chosen.length} из {allowed.length} доступно этому рабочему
            пространству
          </span>
        );
      })}
    </div>
  );
}

/**
 * The user's own narrowing of the deployment's allowlist. Only entries the
 * administrator listed are offered, and unchecking one stores a smaller list —
 * the host refuses anything that would grow.
 */
function BoundaryEditor({
  resources,
  selection,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  readonly resources: IntegrationServiceBoundary;
  readonly selection: IntegrationServiceBoundary | null;
  readonly busy: boolean;
  onChange(selection: IntegrationServiceBoundary): void;
  onCancel(): void;
  onSave(): void;
}) {
  return (
    <div className="dsh-qa-integrations__notice">
      {Object.entries(resources).map(([kind, allowed]) => {
        const chosen = new Set(selection?.[kind] ?? allowed);
        return (
          <div key={kind}>
            <h4>{kind}</h4>
            {allowed.map((ref) => (
              <label className="dsh-qa-integrations__check" key={ref}>
                <input
                  type="checkbox"
                  checked={chosen.has(ref)}
                  disabled={busy}
                  onChange={(event) => {
                    const next = new Set(chosen);
                    if (event.currentTarget.checked) next.add(ref);
                    else next.delete(ref);
                    onChange({
                      ...(selection ?? resources),
                      [kind]: allowed.filter((entry) => next.has(entry)),
                    });
                  }}
                />
                {ref}
              </label>
            ))}
          </div>
        );
      })}
      <div className="dsh-qa-integrations__actions">
        <button
          className="dsh-qa-integrations__button dsh-qa-integrations__button--primary"
          type="button"
          disabled={busy}
          onClick={onSave}
        >
          Сохранить доступ
        </button>
        <button
          className="dsh-qa-integrations__button"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
