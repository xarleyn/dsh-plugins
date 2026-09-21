/**
 * The account-scoped page of the QA settings dialog.
 *
 * This is the surface a signed-in user reaches on a QA deployment. The Host's
 * own "Plugin configuration" card cannot be it: those cards are discovered from
 * the Host settings directory, which a browser reaching the deployment over the
 * network never gets, and the QA overlay does not render the native settings
 * tree at all. The dialog is part of the QA surface itself, so it is reachable
 * exactly where the memory is shared.
 *
 * Everything here is per account. The switches narrow the deployment's own
 * plan; they can turn automatic context off for one account and never on for
 * an account whose deployment disabled it.
 */

import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { QaUserSettingsSectionProps } from "@yadsh/dsh-qa-surface/client/settings";
import { useCallback, useEffect, useState } from "react";

import type {
  QaUserMemorySettingsPatch,
  QaUserMemorySettingsView,
} from "../types.js";

/** The Remote surface this page calls; the token authenticates the caller. */
export interface MemoryClientRemote {
  userMemorySettings(
    token: string,
  ): Promise<RemoteResult<QaUserMemorySettingsView>>;
  setUserMemorySettings(
    token: string,
    patch: QaUserMemorySettingsPatch,
  ): Promise<RemoteResult<QaUserMemorySettingsView>>;
  resetUserMemorySettings(
    token: string,
  ): Promise<RemoteResult<QaUserMemorySettingsView>>;
}

/** Which switch a click is changing. */
type SettingKey = "autoInject" | "profile" | "recall";

/** The section id and title QA Surface registers this page under. */
export const QA_MEMORY_SECTION_ID = "openviking-memory";
export const QA_MEMORY_SECTION_TITLE = "Память";

/**
 * Section stylesheet, built only from `--dsw-alias-*` tokens so the page
 * follows the dialog's light, dark, and system themes.
 */
export const qaSettingsStyles: string = `
.ovm-qa,.ovm-qa *{box-sizing:border-box}
.ovm-qa{display:grid;gap:14px;color:var(--dsw-alias-label-primary);font-size:13px}
.ovm-qa__lead{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.5}
.ovm-qa__rows{display:grid;gap:8px}
.ovm-qa__row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 13px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.ovm-qa__copy{display:grid;gap:3px;text-align:left;min-width:0}
.ovm-qa__copy strong{font-size:13px;font-weight:600}
.ovm-qa__copy span{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.45}
.ovm-qa__side{display:flex;align-items:center;gap:8px;flex:none}
.ovm-qa__toggle{appearance:none;width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-label-dimmed);position:relative;cursor:pointer;transition:.18s;flex:none;border:0}
.ovm-qa__toggle:after{content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);transition:.18s}
.ovm-qa__toggle:checked{background:var(--dsw-alias-brand-primary)}
.ovm-qa__toggle:checked:after{transform:translateX(16px)}
.ovm-qa__toggle:disabled{cursor:default;opacity:.45}
.ovm-qa__badge{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-module-platform);border-radius:999px;padding:2px 8px;white-space:nowrap}
.ovm-qa__notice{margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}
.ovm-qa__notice strong{color:var(--dsw-alias-label-primary)}
.ovm-qa__error{margin:0;padding:10px 12px;border-radius:9px;background:var(--dsw-alias-bg-error);color:var(--dsw-alias-label-error);font-size:11px;line-height:1.5}
.ovm-qa__footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ovm-qa__btn{height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:0 12px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.ovm-qa__btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}
.ovm-qa__btn:disabled{cursor:default;opacity:.45}
.ovm-qa__muted{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}
`;

/** The message a refused Remote call shows; the wire carries no detail. */
const GENERIC_FAILURE =
  "Не удалось изменить настройки памяти. Обновите страницу и попробуйте снова.";

/**
 * What is actually going to happen, spelled out. The switches above say what
 * this account asked for; this line says what the deployment's plan leaves of
 * it, which is the only place a narrowing master switch becomes visible.
 */
function describeEffective(view: QaUserMemorySettingsView): string {
  const parts = [
    view.effective.startupProfile ? "профиль" : "без профиля",
    view.effective.recall
      ? "автоматический поиск"
      : "без автоматического поиска",
  ];
  return `Сейчас: ${parts.join(", ")}.`;
}

function failureMessage(result: RemoteResult<unknown>): string {
  if (!result.ok && typeof result.error?.message === "string") {
    return result.error.message;
  }
  return GENERIC_FAILURE;
}

/** One switch row: label, description, and the switch itself. */
function SettingRow(props: {
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly overridden: boolean;
  readonly disabled: boolean;
  readonly onToggle: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="ovm-qa__row">
      <span className="ovm-qa__copy">
        <strong>{props.label}</strong>
        <span>{props.hint}</span>
      </span>
      <span className="ovm-qa__side">
        {props.overridden ? (
          <span className="ovm-qa__badge">своя настройка</span>
        ) : null}
        <input
          type="checkbox"
          className="ovm-qa__toggle"
          checked={props.checked}
          disabled={props.disabled}
          aria-label={props.label}
          onChange={(event) => {
            props.onToggle(event.target.checked);
          }}
        />
      </span>
    </div>
  );
}

/**
 * Build the page component around one mounted Remote namespace. The token
 * arrives from the dialog as transport authentication; it is never stored.
 */
export function createMemorySettingsSection(remote: MemoryClientRemote) {
  return function MemorySettingsSection({
    token,
  }: QaUserSettingsSectionProps): React.JSX.Element {
    const [view, setView] = useState<QaUserMemorySettingsView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
      const result = await remote.userMemorySettings(token);
      if (result.ok) {
        setView(result.value);
        setError(null);
      } else {
        setView(null);
        setError(failureMessage(result));
      }
    }, [remote, token]);

    useEffect(() => {
      void load();
    }, [load]);

    const write = useCallback(
      (run: () => Promise<RemoteResult<QaUserMemorySettingsView>>) => {
        setBusy(true);
        void run()
          .then((result) => {
            if (result.ok) {
              setView(result.value);
              setError(null);
            } else {
              setError(failureMessage(result));
            }
          })
          .catch(() => {
            setError(GENERIC_FAILURE);
          })
          .finally(() => {
            setBusy(false);
          });
      },
      [],
    );

    const toggle = useCallback(
      (key: SettingKey) => (checked: boolean) => {
        write(() => remote.setUserMemorySettings(token, { [key]: checked }));
      },
      [remote, token, write],
    );

    const overridden =
      view !== null &&
      (view.autoInject !== null ||
        view.profile !== null ||
        view.recall !== null);

    return (
      <section className="ovm-qa" aria-label="Память OpenViking">
        <p className="ovm-qa__lead">
          Память помощника хранится отдельно для каждой учётной записи QA. Эти
          переключатели действуют только на ваш аккаунт.
        </p>

        {error !== null ? <p className="ovm-qa__error">{error}</p> : null}

        {view === null ? (
          <p className="ovm-qa__muted">
            {error === null ? "Загружаю настройки памяти…" : null}
          </p>
        ) : (
          <>
            <div className="ovm-qa__rows">
              <SettingRow
                label="Автоматическая память"
                hint="Главный выключатель: выключает и профиль, и автоматический поиск. Память при этом продолжает записываться, а инструменты поиска остаются доступны."
                // The row shows the master switch itself, not "is anything
                // still on": the two rows below say what each path does, and a
                // derived value here would look stuck when they are both off.
                checked={view.autoInject !== false}
                overridden={view.autoInject !== null}
                disabled={busy}
                onToggle={toggle("autoInject")}
              />
              <SettingRow
                label="Профиль в начале разговора"
                hint="Подставлять сохранённый профиль в начало сессии. Действует, пока включена автоматическая память."
                // Each row shows its own switch, exactly like the deployment's
                // card: a derived "is it effective" value reads as a stuck
                // checkbox the moment the master switch is off.
                checked={view.profile !== false}
                overridden={view.profile !== null}
                disabled={busy}
                onToggle={toggle("profile")}
              />
              <SettingRow
                label="Автоматический поиск по памяти"
                hint="Искать подходящее в памяти перед каждым шагом. Действует, пока включена автоматическая память."
                checked={view.recall !== false}
                overridden={view.recall !== null}
                disabled={busy}
                onToggle={toggle("recall")}
              />
            </div>

            <p className="ovm-qa__muted">{describeEffective(view)}</p>

            {view.scoped ? null : (
              <p className="ovm-qa__notice">
                Разделение памяти по пользователям в этом развёртывании
                выключено: все аккаунты пользуются одной памятью.
              </p>
            )}

            <p className="ovm-qa__notice">
              Выключение затрагивает только <strong>автоматическую</strong>
              подстановку. Разговоры по-прежнему записываются в память вашего
              аккаунта, и помощник может искать по ней по своей инициативе.
            </p>

            <div className="ovm-qa__footer">
              <p className="ovm-qa__muted">
                {view.scoped
                  ? "Память разделена по учётным записям QA."
                  : "Разделение по учётным записям выключено."}
              </p>
              {overridden ? (
                <button
                  type="button"
                  className="ovm-qa__btn"
                  disabled={busy}
                  onClick={() => {
                    write(() => remote.resetUserMemorySettings(token));
                  }}
                >
                  Вернуть как в развёртывании
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    );
  };
}
