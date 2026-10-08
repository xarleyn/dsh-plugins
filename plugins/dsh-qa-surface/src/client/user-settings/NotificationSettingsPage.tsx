import { useEffect, useState, type FormEvent } from "react";
import type {
  QaAccountNotifications,
  QaAccountNotificationsInput,
  ResolvedQaSurfaceConfig,
} from "../../types.js";
import {
  readNotificationPermission,
  requestNotificationPermission,
  type QaNotificationPermission,
} from "../notifications/notification-dispatcher.js";
import {
  QaSettingsActions,
  QaSettingsButton,
  QaSettingsNotice,
  QaSettingsToggle,
} from "./fields.js";

const FORM_ID = "dsh-qa-settings-notifications-form";

export interface QaNotificationSettingsPageProps {
  /** The channels this account has chosen. */
  readonly notifications: QaAccountNotifications;
  /** `config.notifications`: what the stand allows whatever the reader picks. */
  readonly switches: ResolvedQaSurfaceConfig["notifications"];
  /** Persist the edited pair; resolves to refusal copy, or null. */
  readonly onSave: (
    input: QaAccountNotificationsInput,
  ) => Promise<string | null>;
}

export const QA_NOTIFICATION_SETTINGS_COPY = Object.freeze({
  title: "Уведомления",
  lead: "Напоминание о завершённом ходе доходит до вас, даже когда вы читаете другой чат.",
  inApp: "Строка «Ход завершён» на странице",
  inAppHint:
    "Появляется, когда ход закончился в чате, который вы сейчас не читаете; клик открывает его.",
  desktop: "Системные уведомления",
  desktopHint:
    "Приходят, когда эта вкладка свёрнута или закрыта другим окном. В самом чате, который открыт перед вами, ничего не появляется.",
  offOnStand:
    "Уведомления о завершённых ходах выключены на этом стенде администратором.",
  desktopOffOnStand:
    "Системные уведомления выключены на этом стенде: строка на странице остаётся.",
  unsupported:
    "Браузер этого устройства не умеет системные уведомления: напоминание останется на странице.",
  denied:
    "Браузер запретил уведомления для этого адреса. Разрешите их в его собственных настройках — до этого напоминание останется только на странице.",
  askAction: "Разрешить в браузере",
  askHint:
    "Браузер спросит разрешение один раз, по этому нажатию; больше вопрос не вернётся.",
  granted: "Браузер разрешил уведомления для этого адреса.",
  saved: "Настройки уведомлений сохранены.",
});

/**
 * The signed-in reader's own answer about the channels a finished turn may use.
 *
 * Two switches, because that is how many the feature has: the line inside the
 * page and the notice the page hands to the operating system. What the stand
 * allows is a third voice over each of them and is shown rather than hidden —
 * a control that silently does nothing reads as a bug, and the reader is the
 * one person who should not have to guess whose decision it was.
 *
 * Same full-replace contract as the starters form: the pair is seeded from the
 * stored record whenever that record changes, so a write from another tab never
 * leaves a stale edit on screen.
 */
export function QaNotificationSettingsPage(
  props: QaNotificationSettingsPageProps,
) {
  const { switches } = props;
  const [choices, setChoices] = useState<QaAccountNotificationsInput>(() => ({
    inApp: props.notifications.inApp,
    desktop: props.notifications.desktop,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // The browser's own answer, re-read every render of the dialog: granting a
  // permission happens outside this page, and the hint has to tell the truth
  // about it the moment the reader comes back.
  const [permission, setPermission] = useState<QaNotificationPermission>(() =>
    readNotificationPermission(),
  );
  useEffect(() => {
    setChoices({
      inApp: props.notifications.inApp,
      desktop: props.notifications.desktop,
    });
    setBusy(false);
    setError(null);
    setSaved(false);
  }, [props.notifications]);

  const desktopAllowed = switches.enabled && switches.allowOs;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    void props.onSave(choices).then((refusal) => {
      setBusy(false);
      if (refusal !== null) {
        setError(refusal);
        return;
      }
      setSaved(true);
    });
  };

  // With the master switch off, one notice says everything both controls need:
  // a per-control hint would repeat it and could only contradict itself.
  const desktopHint = !switches.enabled
    ? undefined
    : !switches.allowOs
      ? QA_NOTIFICATION_SETTINGS_COPY.desktopOffOnStand
      : permission === "unsupported"
        ? QA_NOTIFICATION_SETTINGS_COPY.unsupported
        : permission === "denied"
          ? QA_NOTIFICATION_SETTINGS_COPY.denied
          : permission === "granted"
            ? QA_NOTIFICATION_SETTINGS_COPY.granted
            : QA_NOTIFICATION_SETTINGS_COPY.askHint;
  // A denied permission is not locked: it is the reader's own answer about a
  // channel this browser happens to refuse today, and the same account may be
  // signed in on a browser that will honor it tomorrow.
  const desktopLocked =
    !switches.enabled || !switches.allowOs || permission === "unsupported";

  return (
    <form
      id={FORM_ID}
      className="dsh-qa-settings__page"
      data-testid="qa-settings-notifications"
      onSubmit={submit}
    >
      <h3
        className="dsh-qa-settings__page-title"
        data-testid="qa-settings-notifications-title"
      >
        {QA_NOTIFICATION_SETTINGS_COPY.title}
      </h3>
      <p
        className="dsh-qa-settings__lead"
        data-testid="qa-settings-notifications-lead"
      >
        {QA_NOTIFICATION_SETTINGS_COPY.lead}
      </p>
      <QaSettingsToggle
        testId="qa-settings-notifications-in-app"
        checked={choices.inApp}
        disabled={!switches.enabled}
        label={QA_NOTIFICATION_SETTINGS_COPY.inApp}
        hint={QA_NOTIFICATION_SETTINGS_COPY.inAppHint}
        onChange={(inApp) => {
          setChoices((current) => ({ ...current, inApp }));
          setSaved(false);
        }}
      />
      <QaSettingsToggle
        testId="qa-settings-notifications-desktop"
        checked={choices.desktop}
        disabled={desktopLocked}
        label={QA_NOTIFICATION_SETTINGS_COPY.desktop}
        hint={desktopHint}
        onChange={(desktop) => {
          setChoices((current) => ({ ...current, desktop }));
          setSaved(false);
        }}
      />
      {desktopAllowed && permission === "default" ? (
        // The prompt is a click and nothing else: a page that asks on load
        // spends the permission on the wrong moment, and a notice that asks on
        // every finished turn asks a question the reader already answered.
        <div>
          <QaSettingsButton
            testId="qa-settings-notifications-ask"
            label={QA_NOTIFICATION_SETTINGS_COPY.askAction}
            onClick={() => {
              void requestNotificationPermission().then((answer) => {
                setPermission(answer);
                if (answer === "granted") {
                  setChoices((current) => ({ ...current, desktop: true }));
                  setSaved(false);
                }
              });
            }}
          />
        </div>
      ) : null}
      {!switches.enabled ? (
        <QaSettingsNotice
          testId="qa-settings-notifications-off-on-stand"
          tone="warn"
        >
          {QA_NOTIFICATION_SETTINGS_COPY.offOnStand}
        </QaSettingsNotice>
      ) : null}
      {error === null ? null : (
        <QaSettingsNotice testId="qa-settings-notifications-error" tone="error">
          {error}
        </QaSettingsNotice>
      )}
      {saved && error === null ? (
        <QaSettingsNotice testId="qa-settings-notifications-saved" tone="info">
          {QA_NOTIFICATION_SETTINGS_COPY.saved}
        </QaSettingsNotice>
      ) : null}
      <QaSettingsActions>
        <QaSettingsButton
          testId="qa-settings-notifications-save"
          type="submit"
          tone="primary"
          disabled={busy || !switches.enabled}
          label={busy ? "Сохранение…" : "Сохранить"}
        />
      </QaSettingsActions>
    </form>
  );
}
