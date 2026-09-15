import { QaSettingsSection } from "./fields.js";

export interface QaGeneralSettingsPageProps {
  readonly email: string;
  readonly role: string;
  readonly chatCount: number;
}

/**
 * Placeholder with a purpose: the section exists so the dialog has a home for
 * the user-scoped preferences that follow (notifications, privacy), and so the
 * thing it must not become is written down — deployment and chat policy live in
 * the Host settings, not here. It shows the account facts a user can act on
 * today and nothing invented, and it names only what is still missing: a
 * preference that already has its own tab does not belong on this list.
 */
export function QaGeneralSettingsPage(props: QaGeneralSettingsPageProps) {
  return (
    <div className="dsh-qa-settings__page">
      <h3 className="dsh-qa-settings__page-title">Общие</h3>
      <p className="dsh-qa-settings__lead">
        Ваши личные настройки. Настройки самого стенда — состав инструментов,
        модель и правила доступа — задаёт администратор.
      </p>
      <QaSettingsSection title="Аккаунт">
        <dl className="dsh-qa-settings__facts">
          <div className="dsh-qa-settings__fact">
            <dt>Email</dt>
            <dd>{props.email}</dd>
          </div>
          <div className="dsh-qa-settings__fact">
            <dt>Роль</dt>
            <dd>{props.role}</dd>
          </div>
          <div className="dsh-qa-settings__fact">
            <dt>Ваши чаты</dt>
            <dd>{props.chatCount}</dd>
          </div>
        </dl>
      </QaSettingsSection>
      <QaSettingsSection title="Скоро здесь">
        <ul className="dsh-qa-settings__list">
          <li>Настройки уведомлений</li>
          <li>Приватность и хранение данных</li>
        </ul>
      </QaSettingsSection>
    </div>
  );
}
